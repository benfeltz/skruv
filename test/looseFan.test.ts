import { describe, expect, it } from 'vitest';
import { BOOKLET } from '../src/constants.js';
import { createBooklet } from '../src/game/bookletModel.js';
import { ITEM_IDS, itemById } from '../src/game/item.js';
import { fanLayout } from '../src/game/looseFan.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import type { Quat, Size } from '../tools/validate/lib/geometry.js';

// The loose-parts page's fan (src/game/looseFan.ts): every panel flat, long side across the
// page, the panels side by side down it, never stacked along their length.

const extent = (size: Size, rotation: Quat, axis: number) =>
  [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(rotation, [0, 1, 2].map((k) => (k === i ? size[i] : 0)) as Size)[axis]), 0);

/** Each panel's [from, to] down the page, its height and its width across. */
const spans = (sizes: Size[]) =>
  fanLayout(sizes, BOOKLET.fanGap).map(({ rotation, offset }, i) => {
    const depth = extent(sizes[i], rotation, 2);
    return { from: offset - depth / 2, to: offset + depth / 2, height: extent(sizes[i], rotation, 1), across: extent(sizes[i], rotation, 0) };
  });

describe('fanLayout', () => {
  it('lays a panel on its largest face, its long side across the page', () => {
    for (const size of [[0.016, 2.02, 0.28], [0.768, 0.016, 0.28], [0.04, 0.38, 2.08], [0.016, 0.16, 0.3], [0.36, 0.16, 0.016]] as Size[]) {
      const [{ height, across, to, from }] = spans([size]);
      expect(height, `${size}`).toBeCloseTo(Math.min(...size), 9);
      expect(across, `${size}`).toBeGreaterThanOrEqual(to - from - 1e-9);
    }
  });

  it("lays SÖMNLÖS's two rails side by side, not one down the other's length", () => {
    const rail: Size = [0.04, 0.38, 2.08];
    const [a, b] = spans([rail, rail]);
    expect(a.to - a.from).toBeCloseTo(0.38, 9);
    expect(b.from - a.to).toBeCloseTo(BOOKLET.fanGap, 9);
    expect(a.across).toBeCloseTo(2.08, 9);
  });

  it('keeps the old fan for panels already long side across (JOHNNY\'s)', () => {
    const [side, top] = fanLayout([[0.016, 2.02, 0.28], [0.768, 0.016, 0.28]], BOOKLET.fanGap);
    expect(side.offset).toBeCloseTo(0.14, 9);
    expect(top.offset).toBeCloseTo(0.28 + BOOKLET.fanGap + 0.14, 9);
  });

  it("lays every panel of every item's loose-parts pages long side across, side by side a gap apart", () => {
    for (const id of ITEM_IDS) {
      const item = itemById(id);
      const steps = createBooklet(item.manual.pages, { layout: item.assembled, manifest: item.manifest, partTypes: item.partTypes, resolve: item.resolve, gamePages: [] })
        .flatMap((p) => (p.kind === 'step' && p.pose === 'parts' ? [p] : []));
      const typeOf = new Map(item.manifest.map((p) => [p.id, p.type]));
      for (const step of steps) {
        // The page's panels as bookletPages takes them: the joints' hosts, then the parts brought in.
        const panels = [...new Set([...step.joints.map((i) => item.assembled.joints[i].host), ...step.parts])];
        const placed = spans(panels.map((p) => item.partTypes[typeOf.get(p)!].size));
        for (const [i, { across, from, to }] of placed.entries()) expect(across, `${id} step ${step.number}, ${panels[i]}`).toBeGreaterThanOrEqual(to - from - 1e-9);
        placed.slice(1).forEach((b, i) => expect(b.from - placed[i].to, `${id} step ${step.number}`).toBeCloseTo(BOOKLET.fanGap, 9));
      }
    }
  });
});
