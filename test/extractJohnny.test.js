import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { extractPack, formatPack, OUTPUT } from '../scripts/extractJohnny.js';

// Guard while the generator and today's modules both exist: the committed pack is exactly
// what today's code produces, so nothing drifts before the modules are retired.
describe('items/johnny/flatpack.json', () => {
  const committed = readFileSync(OUTPUT, 'utf8');

  it('regenerates byte for byte from today\'s modules', () => {
    expect(formatPack(extractPack())).toBe(committed);
  });

  it('round-trips every number exactly', () => {
    expect(JSON.parse(committed)).toEqual(JSON.parse(JSON.stringify(extractPack())));
  });

  it('passes the Flatpack v1 schema', () => {
    const require = createRequire(new URL('../tools/validate/package.json', import.meta.url));
    const Ajv = require('ajv');
    const schema = JSON.parse(readFileSync(new URL('../tools/validate/flatpack.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv({ allErrors: true }).compile(schema);
    expect(validate(JSON.parse(committed)), JSON.stringify(validate.errors)).toBe(true);
  });
});
