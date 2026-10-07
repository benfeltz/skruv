#!/usr/bin/env node
// Flatpack validator: `node tools/validate/index.js <item folder or flatpack.json>…`.
// Layer 1 is flatpack.schema.json (ajv); a pack that passes it goes on to layer 2, the
// semantic checks in lib/checks.js. Prints every error and exits non-zero on any. Input
// and output only — every rule lives in lib/.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Ajv from 'ajv';
import { checkPack } from './lib/checks.js';

const schema = JSON.parse(readFileSync(new URL('./flatpack.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true }).compile(schema);

function validate(target) {
  let file = target;
  let pack;
  try {
    if (statSync(target).isDirectory()) file = join(target, 'flatpack.json');
    pack = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    return { file, errors: [{ rule: 'json', path: '', message: cause.message }] };
  }
  const folder = dirname(file);
  if (!validateSchema(pack)) {
    return { file, errors: validateSchema.errors.map((e) => ({ rule: 'schema', path: e.instancePath || '/', message: e.message })) };
  }
  return { file, errors: checkPack(pack, { assetExists: (path) => existsSync(join(folder, path)) }) };
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: node tools/validate/index.js <item folder or flatpack.json>…');
  process.exit(2);
}
let failed = false;
for (const target of targets) {
  const { file, errors } = validate(resolve(target));
  if (errors.length === 0) {
    console.log(`ok  ${file}`);
    continue;
  }
  failed = true;
  console.error(`FAIL ${file} — ${errors.length} error${errors.length === 1 ? '' : 's'}`);
  for (const { rule, path, message } of errors) console.error(`  [${rule}] ${path}: ${message}`);
}
process.exit(failed ? 1 : 0);
