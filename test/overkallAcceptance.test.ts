import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../tools/validate/lib/checks.js';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { itemById, ITEM_IDS } from '../src/game/item.js';
import { pickableSet } from '../src/game/pickable.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';

// 1.9.3.2 acceptance, against the plan's three criteria: the pack validates and ships in the
// catalog as the third item, buildable on every build; the carcass uses only JOHNNY's
// vocabulary and the drawer is a screwed box set into the cavity with no joint; the
// part-budget phone check is manual (stated in the PR body, never faked here).

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pack = (item: string): FlatpackFile => JSON.parse(read(`items/${item}/flatpack.json`));
const OVERKALL = pack('overkall');
const JOHNNY = pack('johnny');

describe('AC1: ÖVERKÄLL validates and ships in the catalog as the third item, buildable on every build', () => {
  it('passes the validator, and the shipped items still do', () => {
    for (const item of ['johnny', 'blank', 'overkall']) expect(checkPack(pack(item)), item).toEqual([]);
  });

  it('is the registry\'s third entry, after BLANK, JOHNNY first, and pickable under an empty flag', () => {
    expect([...ITEM_IDS]).toEqual(['johnny', 'blank', 'overkall']);
    expect(itemById('overkall').identity.product).toBe('ÖVERKÄLL');
    expect(pickableSet('', ITEM_IDS).has('overkall')).toBe(true);
  });

  it('is validated by CI and by deploy, on its own line after BLANK\'s, the earlier lines untouched', () => {
    for (const file of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const lines = read(file).split('\n').map((l) => l.trim());
      const at = (item: string) => lines.indexOf(`- run: npx tsx tools/validate/index.ts items/${item}`);
      expect(at('johnny'), file).toBeGreaterThan(-1);
      expect(at('blank'), file).toBe(at('johnny') + 1);
      expect(at('overkall'), file).toBe(at('blank') + 1);
    }
  });
});

describe('AC2: the carcass is JOHNNY\'s vocabulary; the drawer is built with screws and set into the cavity', () => {
  const item = itemById('overkall');
  const carcass = ['sidePanel', 'topBottomPanel', 'backPanel'];
  const typeOf = new Map(item.manifest.map((p) => [p.id, p.type]));

  it('uses only connector types JOHNNY\'s carcass uses on the carcass panels', () => {
    const used = (file: FlatpackFile) => new Set(carcass.flatMap((t) => file.parts[t].connectors.map((c) => c.type)));
    for (const type of used(OVERKALL)) expect(used(JOHNNY), type).toContain(type);
    for (const t of ['dowel', 'camLockBolt', 'camLock', 'backFitting']) {
      expect(OVERKALL.parts[t].connectors.map((c) => c.type), t).toEqual(JOHNNY.parts[t].connectors.map((c) => c.type));
    }
  });

  it('builds the drawer with dowels to line it up and 15 screws to fix it, and no other fastener', () => {
    const drawerJoints = item.assembled.joints.filter((j) => !carcass.includes(typeOf.get(j.host)!));
    expect(drawerJoints.every((j) => j.kind === KIND.SCREW || j.kind === KIND.DOWEL)).toBe(true);
    expect(drawerJoints.filter((j) => j.kind === KIND.SCREW)).toHaveLength(15);
    // 14 dowels, an end in each of two drawer parts.
    expect(drawerJoints.filter((j) => j.kind === KIND.DOWEL)).toHaveLength(28);
  });

  it('sets the drawer into the cavity with no joint between it and the carcass', () => {
    const drawer = (id: string) => ['drawerFront', 'drawerSide', 'drawerBack', 'drawerBottom', 'knob'].includes(typeOf.get(id)!);
    for (const j of item.assembled.joints) {
      const ids = [j.hardware, j.host, j.through].filter((id): id is string => id !== null);
      const sides = new Set(ids.filter((id) => !['dowel', 'camLockBolt', 'camLock', 'backFitting', 'screw'].includes(typeOf.get(id)!)).map(drawer));
      expect(sides.size, `${j.hardware} spans drawer and carcass`).toBeLessThanOrEqual(1);
    }
  });
});
