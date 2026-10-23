import { describe, expect, it } from 'vitest';
import { CLUSTER, LIFT_LINE, MENU } from '../src/constants.js';
import { fanBox, liftLineBox, overlaps } from '../src/game/screenLayout.js';
import type { Rect } from '../src/game/screenLayout.js';

// The screen's controls never lie over one another (Ben, 2026-10-18): the lift line placed from the
// control cluster and the manual's band, in portrait and landscape and with the notch on either
// side — checked here, headlessly, not on the phone.

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height });
const { hitWidth, knobRadius } = LIFT_LINE;
const gap = CLUSTER.gap;
// The band's thickness, and the catalog's thumb, roughly as on a phone.
const band = 124;
const thumb = { width: 72, height: 100 };

/** A screen's controls as laid out for a `width` x `height` viewport: the band along the bottom upright, else down the right edge, with a safe-area margin `inset` px on each side (Safari's, both sides; Chrome on iOS reports none). */
function screen(width: number, height: number, inset = 0) {
  const menu = MENU.size;
  if (height >= width) {
    // Portrait: the menu upper left (the lift line under it, for the left thumb), the catalog upper right.
    const cluster = rect(CLUSTER.inset, CLUSTER.inset, menu, menu);
    return { viewport: { width, height }, cluster, strip: rect(0, height - band, width, band), catalog: rect(width - CLUSTER.inset - thumb.width, CLUSTER.inset, thumb.width, thumb.height) };
  }
  // Landscape (Ben, 2026-10-18): the band always down the right, inside the right margin; the cluster
  // (menu over gear) always on the left, just inside the left margin; the catalog beside the band.
  const cluster = rect(inset + CLUSTER.inset, CLUSTER.inset, menu, 2 * menu + CLUSTER.gap);
  const strip = rect(width - inset - band, 0, band, height);
  const catalog = rect(width - inset - band - gap - thumb.width, CLUSTER.inset, thumb.width, thumb.height);
  return { viewport: { width, height }, cluster, strip, catalog };
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

describe('the manual fan', () => {
  const height = 80;
  const cases = [
    ['portrait', screen(390, 760)],
    ['landscape, a safe-area margin each side (Safari)', screen(932, 376, 59)],
    ['landscape, no margins reported', screen(814, 374)],
  ] as const;

  for (const [name, { viewport, cluster, catalog }] of cases) {
    it(`${name}: lies between the menu and the catalog's thumb, level with the menu, overlapping neither`, () => {
      const box = fanBox({ viewport, cluster, thumb: catalog, height, gap });
      expect(box.left).toBe(cluster.right + gap);
      expect(box.right).toBe(catalog.left - gap);
      expect(box.top).toBe(cluster.top);
      expect(box.bottom - box.top).toBe(height);
      expect(box.right).toBeGreaterThan(box.left);
      expect(overlaps(box, cluster)).toBe(false);
      expect(overlaps(box, catalog)).toBe(false);
    });
  }

  it('runs to the viewport\'s edge less the gap with no thumb measured', () => {
    const { viewport, cluster } = screen(390, 760);
    expect(fanBox({ viewport, cluster, thumb: null, height, gap }).right).toBe(viewport.width - gap);
  });

  it('is empty, not inverted, when the thumb crowds the cluster', () => {
    const { viewport, cluster } = screen(390, 760);
    const thumb = rect(cluster.right, 0, 40, 40);
    const box = fanBox({ viewport, cluster, thumb, height, gap });
    expect(box.right).toBe(box.left);
  });
});
