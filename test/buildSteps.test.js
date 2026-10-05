import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAssembledLayout } from '../src/game/assembledLayout.js';
import { createBooklet, createBuildSteps } from '../src/game/buildSteps.js';
import { MANIFEST, MANIFEST_QUANTITIES, PART_TYPES } from '../src/game/catalog.js';
import { KIND } from '../src/game/fasteners.js';

// Page coverage: the booklet tells the whole build — every joint on exactly one page, every
// panel brought in once, hardware counts that add up to the box. A stale page (a fastener
// type renamed, a hole added) fails here rather than silently in the booklet.

const layout = createAssembledLayout();
const steps = createBuildSteps(layout);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SPARES = { dowel: 2, camLock: 2 };
const TOOLS = ['allenWrench', 'screwdriver'];
const typeOf = (id) => layout.parts.find((p) => p.id === id).type;

describe('createBuildSteps', () => {
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

  it('only names part types the catalog knows', () => {
    for (const s of steps) for (const id of s.parts) expect(PART_TYPES).toHaveProperty(typeOf(id));
    for (const s of steps) for (const type of s.types) expect(PART_TYPES).toHaveProperty(type);
  });
});

describe('createBooklet', () => {
  const booklet = createBooklet(MANIFEST, layout);

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

describe('no validation anywhere (Ben, 2026-10-04)', () => {
  it('keeps the booklet data out of the engine — pages are reference, never a gate', () => {
    for (const path of ['src/game/assembly.js', 'src/game/fasteners.js', 'src/scene/gestureRouter.js']) {
      expect(read(path)).not.toMatch(/buildSteps|assembledLayout|createBooklet/);
    }
  });
});
