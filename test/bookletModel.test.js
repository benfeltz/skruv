import { describe, expect, it } from 'vitest';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { createAssembledLayout } from '../src/game/assembledLayout.js';
import { createBooklet as createTodaysBooklet } from '../src/game/buildSteps.js';
import { createBooklet, createBuildSteps } from '../src/game/bookletModel.js';
import { ASSEMBLED, MANIFEST, MANUAL, PART_TYPES, resolveConnector } from '../src/game/item.js';

// Page coverage: the booklet tells the whole build — every joint on exactly one page, every
// panel brought in once, hardware counts that add up to the box. A stale page (a fastener
// type renamed, a hole added) fails here rather than silently in the booklet.

const layout = ASSEMBLED;
const model = { layout, manifest: MANIFEST, partTypes: PART_TYPES, resolve: resolveConnector };
const steps = createBuildSteps(MANUAL.pages, model);
const SPARES = { dowel: 2, camLock: 2 };
const TOOLS = ['allenWrench', 'screwdriver'];
const MANIFEST_QUANTITIES = Object.fromEntries(Object.keys(PART_TYPES).filter((type) => MANIFEST.some((p) => p.type === type)).map((type) => [type, MANIFEST.filter((p) => p.type === type).length]));
const typeOf = (id) => layout.parts.find((p) => p.id === id).type;

describe('createBuildSteps (from the pack\'s manual pages)', () => {
  it('runs the adapted real order: twelve numbered steps', () => {
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('covers every joint of the assembled layout exactly once', () => {
    const seen = steps.flatMap((s) => s.joints);
    expect(seen).toHaveLength(layout.joints.length);
    expect(new Set(seen).size).toBe(layout.joints.length);
    expect([...seen].sort((a, b) => a - b)).toEqual(layout.joints.map((_, i) => i));
  });

  it('brings every panel in on exactly one page', () => {
    const panels = layout.parts.filter((p) => p.role !== 'hardware').map((p) => p.id);
    const brought = steps.flatMap((s) => s.parts);
    expect(brought).toHaveLength(panels.length);
    expect(new Set(brought)).toEqual(new Set(panels));
  });

  it('brings every panel in no later than the first joint that uses it', () => {
    const pageOf = new Map(steps.flatMap((s) => s.parts.map((id) => [id, s.number])));
    for (const step of steps) {
      for (const i of step.joints) {
        const { host } = layout.joints[i];
        if (pageOf.has(host)) expect(pageOf.get(host), `${host} on step ${step.number}`).toBeLessThanOrEqual(step.number);
      }
    }
  });

  it('turns every cam to lock on its own page or a later one, once', () => {
    const cams = layout.joints.flatMap((j, i) => (j.kind === KIND.CAM ? [i] : []));
    const turned = steps.flatMap((s) => s.turns);
    expect([...turned].sort((a, b) => a - b)).toEqual(cams);
    for (const step of steps) {
      for (const i of step.turns) {
        const seatedOn = steps.find((s) => s.joints.includes(i)).number;
        expect(seatedOn).toBeLessThanOrEqual(step.number);
      }
    }
  });

  it('counts hardware that sums to the manifest, minus the spares', () => {
    const totals = {};
    for (const { hardware } of steps) for (const { type, count } of hardware) totals[type] = (totals[type] ?? 0) + count;
    const hardwareTypes = Object.keys(MANIFEST_QUANTITIES).filter(
      (type) => !TOOLS.includes(type) && layout.parts.some((p) => p.type === type && p.role === 'hardware'),
    );
    expect(Object.keys(totals).sort()).toEqual(hardwareTypes.sort());
    for (const type of hardwareTypes) expect(totals[type], type).toBe(MANIFEST_QUANTITIES[type] - (SPARES[type] ?? 0));
  });

  it('counts each piece once, on the page it first goes in', () => {
    const page1 = steps[0];
    const dowels = new Set(page1.joints.map((i) => layout.joints[i].hardware));
    expect(page1.hardware).toEqual([{ type: 'dowel', count: dowels.size, partNumber: PART_TYPES.dowel.partNumber }]);
    // The sides go onto dowels already counted: no second bubble.
    expect(steps[2].hardware).toEqual([]);
    expect(steps[5].hardware).toEqual([]);
  });

  it('prints the fake part number of the counted type in every bubble', () => {
    for (const { hardware } of steps) for (const bubble of hardware) expect(bubble.partNumber).toBe(PART_TYPES[bubble.type].partNumber);
  });

  it('puts the right hardware on the right pages', () => {
    const kinds = steps.map((s) => [...new Set(s.joints.map((i) => layout.joints[i].kind))]);
    expect(kinds).toEqual([
      [KIND.DOWEL],
      [KIND.BOLT],
      [KIND.DOWEL],
      [KIND.CAM],
      [],
      [KIND.DOWEL],
      [KIND.CAM],
      [],
      [KIND.FITTING],
      [],
      [KIND.PIN],
      [],
    ]);
  });

  it('builds flat on the left side, backs it face down, tips at step 10, and fits out standing', () => {
    expect(steps.map((s) => s.pose)).toEqual(['parts', 'parts', ...Array(5).fill('lying'), 'faceDown', 'faceDown', 'upright', 'upright', 'upright']);
    expect(steps.filter((s) => s.tip).map((s) => s.number)).toEqual([10]);
    const left = layout.parts.find((p) => p.role === 'leftSide').id;
    expect(steps[2].joints.every((i) => layout.joints[i].host === left)).toBe(true);
    // The sides come in with their bolts, before either goes on.
    expect(steps[1].parts.map(typeOf)).toEqual(['sidePanel', 'sidePanel']);
  });

  it('hands the wrench for the bolts and the screwdriver for the cams', () => {
    expect(steps[1].tool).toBe('allenWrench');
    expect(steps[4].tool).toBe('screwdriver');
    expect(steps[6].tool).toBe('screwdriver');
    expect(steps.filter((s) => s.tool).length).toBe(3);
  });

  it('names the part types each page is about, for the highlight', () => {
    expect(steps.map((s) => [...s.types].sort())).toEqual([
      ['dowel', 'fixedShelf', 'plinth', 'topBottomPanel'],
      ['allenWrench', 'camLockBolt', 'sidePanel'],
      ['dowel', 'sidePanel'],
      ['camLock', 'fixedShelf', 'topBottomPanel'],
      ['camLock', 'fixedShelf', 'screwdriver', 'topBottomPanel'],
      ['dowel', 'sidePanel'],
      ['camLock', 'fixedShelf', 'screwdriver', 'topBottomPanel'],
      ['backPanel'],
      ['backFitting', 'backPanel'],
      [],
      ['shelfPin', 'sidePanel'],
      ['adjustableShelf'],
    ]);
  });

  // PR #12 review: the right side, fitted with bolts on loose-parts page 2, was drawn
  // already on the carcass from page 3 — before page 6 puts it on.
  it('draws a panel on the carcass only from the step that puts it there', () => {
    const left = layout.parts.find((p) => p.role === 'leftSide').id;
    const right = layout.parts.find((p) => p.role === 'rightSide').id;
    const back = layout.parts.find((p) => p.role === 'back').id;
    const horizontals = layout.parts.filter((p) => ['plinth', 'bottom', 'fixed', 'top'].includes(p.role)).map((p) => p.id);
    const shown = (n) => new Set(steps[n - 1].shown);
    for (const n of [3, 4, 5]) {
      expect(shown(n).has(left), `left on ${n}`).toBe(true);
      expect(shown(n).has(right), `right on ${n}`).toBe(false);
      for (const id of horizontals) expect(shown(n).has(id), `${id} on ${n}`).toBe(true);
    }
    for (const n of [6, 7, 8, 12]) expect(shown(n).has(right), `right on ${n}`).toBe(true);
    expect(shown(7).has(back)).toBe(false);
    expect(shown(8).has(back)).toBe(true);
  });

  it('draws hardware only with the panel it sits in, and everything by the last page', () => {
    const hostOf = new Map(layout.joints.map((j) => [j.hardware, j.host]));
    const right = layout.parts.find((p) => p.role === 'rightSide').id;
    const rightBolts = layout.joints.filter((j) => j.kind === KIND.BOLT && j.host === right).map((j) => j.hardware);
    for (const n of [3, 4, 5]) for (const bolt of rightBolts) expect(steps[n - 1].shown).not.toContain(bolt);
    for (const s of steps) for (const id of s.shown) if (hostOf.has(id) && !s.shown.includes(hostOf.get(id))) {
      // A dowel shows with either panel it joins; anything else needs its own host.
      expect(layout.joints.some((j) => j.hardware === id && s.shown.includes(j.host)), `${id} on ${s.number}`).toBe(true);
    }
    expect(new Set(steps.at(-1).shown)).toEqual(new Set(layout.parts.map((p) => p.id)));
  });

  it('only names part types the catalog knows', () => {
    for (const s of steps) for (const id of s.parts) expect(PART_TYPES).toHaveProperty(typeOf(id));
    for (const s of steps) for (const type of s.types) expect(PART_TYPES).toHaveProperty(type);
  });
});

describe('createBooklet', () => {
  const booklet = createBooklet(MANUAL.pages, model);

  it('runs cover, warnings, inventory, the twelve steps, back cover', () => {
    expect(booklet.map((p) => p.kind)).toEqual([
      'cover',
      'warning',
      'doDont',
      'doDont',
      'inventory',
      ...Array(12).fill('step'),
      'backCover',
    ]);
  });

  it('inventories the whole box, spares and tools included, with part numbers', () => {
    const { items } = booklet.find((p) => p.kind === 'inventory');
    expect(Object.fromEntries(items.map((i) => [i.type, i.count]))).toEqual(MANIFEST_QUANTITIES);
    for (const { type, partNumber } of items) expect(partNumber).toBe(PART_TYPES[type].partNumber);
  });
});

// Guard while buildSteps.js still exists: the pack's pages make exactly today's booklet.
describe('equivalence with today\'s booklet', () => {
  it('matches createBooklet page for page, field for field', () => {
    expect(createBooklet(MANUAL.pages, model)).toEqual(createTodaysBooklet(MANIFEST, createAssembledLayout()));
  });
});
