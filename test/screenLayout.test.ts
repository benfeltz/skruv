import { describe, expect, it } from 'vitest';
import { BOOKLET_UI, CLUSTER, LIFT_LINE, MENU } from '../src/constants.js';
import { fanBox, liftLineBox, overlaps } from '../src/game/screenLayout.js';
import type { Rect } from '../src/game/screenLayout.js';

// The screen's controls never lie over one another (Ben, 2026-10-18): the lift line placed from the
// control cluster and the manual's band, in portrait and landscape and with the notch on either
// side — checked here, headlessly, not on the phone.

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height });
const { hitWidth, knobRadius } = LIFT_LINE;
const gap = CLUSTER.gap;
// The band's thickness (the name row in it), the pocket at its end, and the catalog's thumb, roughly as on a phone.
const band = 142;
const across = 114;
const { pocket: pocketLength } = BOOKLET_UI.strip;
const thumb = { width: 64, height: 89 };

/** A screen's controls as laid out for a `width` x `height` viewport: the band along the bottom upright, else down the right edge, with a safe-area margin `inset` px on each side (Safari's, both sides; Chrome on iOS reports none). */
function screen(width: number, height: number, inset = 0) {
  const menu = MENU.size;
  if (height >= width) {
    // Portrait: the menu upper left (the lift line under it, for the left thumb), the catalog upper right,
    // the pocket the band's right end.
    const cluster = rect(CLUSTER.inset, CLUSTER.inset, menu, menu);
    const strip = rect(0, height - band, width, band);
    const pocket = rect(width - pocketLength, height - band, pocketLength, band);
    return { viewport: { width, height }, cluster, strip, pocket, band: 'bottom' as const, catalog: rect(width - CLUSTER.inset - thumb.width, CLUSTER.inset, thumb.width, thumb.height) };
  }
  // Landscape (Ben, 2026-10-18): the band always down the right, inside the right margin; the cluster
  // (menu over gear) always on the left, just inside the left margin; the catalog at the top beside the
  // band; the pocket the band's foot.
  const cluster = rect(inset + CLUSTER.inset, CLUSTER.inset, menu, 2 * menu + CLUSTER.gap);
  const strip = rect(width - inset - across, 0, across, height);
  const pocket = rect(strip.left, height - pocketLength, across, pocketLength);
  const catalog = rect(strip.left - 12 - thumb.width, CLUSTER.inset, thumb.width, thumb.height);
  return { viewport: { width, height }, cluster, strip, pocket, band: 'right' as const, catalog };
}

/** The line's box widened by the knob, which overhangs both ends. */
const withKnob = (line: Rect): Rect => ({ ...line, top: line.top - knobRadius, bottom: line.bottom + knobRadius });

describe('the lift line', () => {
  const cases = [
    ['portrait', screen(390, 760)],
    ['landscape, a safe-area margin each side (Safari)', screen(932, 376, 59)],
    ['landscape, no margins reported (Chrome on iOS, a desktop window)', screen(814, 374)],
  ] as const;

  for (const [name, { viewport, cluster, strip, catalog }] of cases) {
    it(`${name}: overlaps none of the menu, the band or the catalog's thumb, knob and all`, () => {
      const line = liftLineBox({ viewport, cluster, strip, hitWidth, knobRadius, gap });
      expect(line).not.toBeNull();
      const reach = withKnob(line!);
      for (const other of [cluster, strip, catalog]) expect(overlaps(reach, other)).toBe(false);
      expect(reach.left).toBeGreaterThanOrEqual(0);
      expect(reach.right).toBeLessThanOrEqual(viewport.width);
      expect(reach.bottom).toBeLessThanOrEqual(viewport.height);
    });

    it(`${name}: hangs under the menu, on its side`, () => {
      const line = liftLineBox({ viewport, cluster, strip, hitWidth, knobRadius, gap })!;
      expect((line.left + line.right) / 2).toBeCloseTo((cluster.left + cluster.right) / 2);
      expect(line.top - knobRadius).toBeGreaterThanOrEqual(cluster.bottom + gap);
    });
  }

  it('portrait: ends above the manual\'s band, on the left for the left thumb', () => {
    const { viewport, cluster, strip } = screen(390, 760);
    const line = liftLineBox({ viewport, cluster, strip, hitWidth, knobRadius, gap })!;
    expect(line.bottom + knobRadius).toBeLessThanOrEqual(strip.top - gap);
    expect(line.right).toBeLessThan(viewport.width / 2);
  });

  it('gives no line when a band shares its column beside the menu', () => {
    const viewport = { width: 844, height: 390 };
    const cluster = rect(10, 16, MENU.size, MENU.size);
    expect(liftLineBox({ viewport, cluster, strip: rect(0, 0, 124, 390), hitWidth, knobRadius, gap })).toBeNull();
  });

  it('gives no line when there is no room for one', () => {
    const viewport = { width: 390, height: 120 };
    const cluster = rect(330, 16, MENU.size, MENU.size);
    expect(liftLineBox({ viewport, cluster, strip: rect(0, 90, 390, 30), hitWidth, knobRadius, gap })).toBeNull();
  });
});

describe('overlaps', () => {
  it('counts shared area, not touching edges', () => {
    expect(overlaps(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
    expect(overlaps(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toBe(false);
  });
});

describe("the manuals' row, out of the pocket (option B)", () => {
  const height = 78;
  const margin = CLUSTER.inset;
  const cases = [
    ['portrait', screen(390, 760)],
    ['landscape, a safe-area margin each side (Safari)', screen(932, 376, 59)],
    ['landscape, no margins reported', screen(814, 374)],
  ] as const;

  for (const [name, { viewport, cluster, catalog, strip, pocket, band: edge }] of cases) {
    it(`${name}: overlapping none of the menu, the catalog's thumb, the band or the lift line`, () => {
      const box = fanBox({ viewport, cluster, pocket, band: edge, height, gap, margin });
      expect(box.bottom - box.top).toBe(height);
      expect(box.right).toBeGreaterThan(box.left);
      for (const other of [cluster, catalog, strip]) expect(overlaps(box, other)).toBe(false);
      const line = liftLineBox({ viewport, cluster, strip, hitWidth, knobRadius, gap });
      if (line) expect(overlaps(box, withKnob(line))).toBe(false);
      expect(box.right).toBeLessThanOrEqual(viewport.width - margin);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height - margin);
    });
  }

  it('upright: stands right above the band, a gap clear, its end over the pocket', () => {
    const { viewport, cluster, pocket } = screen(390, 760);
    const box = fanBox({ viewport, cluster, pocket, band: 'bottom', height, gap, margin });
    expect(box.bottom).toBe(pocket.top - gap);
    expect(box.right).toBe(viewport.width - margin);
    expect(box.left).toBe(cluster.right + gap);
  });

  it("in landscape: runs leftward from the band's left edge, a gap clear, level with the pocket at the foot", () => {
    const { viewport, cluster, pocket } = screen(932, 376, 59);
    const box = fanBox({ viewport, cluster, pocket, band: 'right', height, gap, margin });
    expect(box.right).toBe(pocket.left - gap);
    expect(box.bottom).toBe(viewport.height - margin);
  });

  it("lies at the screen's lower right with no pocket measured", () => {
    const { viewport, cluster } = screen(390, 760);
    const box = fanBox({ viewport, cluster, pocket: null, band: 'bottom', height, gap, margin });
    expect([box.right, box.bottom]).toEqual([viewport.width - margin, viewport.height - margin]);
  });

  it('is empty, not inverted, when the band crowds the cluster', () => {
    const { viewport, cluster } = screen(932, 376, 59);
    const box = fanBox({ viewport, cluster, pocket: rect(cluster.right, 350, 100, 26), band: 'right', height, gap, margin });
    expect(box.right).toBe(box.left);
  });
});
