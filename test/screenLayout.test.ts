import { describe, expect, it } from 'vitest';
import { CLUSTER, LIFT_LINE, MENU } from '../src/constants.js';
import { liftLineBox, overlaps } from '../src/game/screenLayout.js';
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

/** A screen's controls as laid out for `viewport`, the band on `edge`, the notch's black column `notch` px wide on `notchAt`. */
function screen(width: number, height: number, edge: 'bottom' | 'left' | 'right', notch = 0) {
  const menu = MENU.size;
  if (edge === 'bottom') {
    const cluster = rect(width - CLUSTER.inset - menu, CLUSTER.inset, menu, menu);
    return { viewport: { width, height }, cluster, strip: rect(0, height - band, width, band), catalog: rect(CLUSTER.inset, CLUSTER.inset, thumb.width, thumb.height) };
  }
  // Landscape: the band down the side without the notch, the cluster (menu over gear) in the other side's column.
  const column = Math.max(notch, CLUSTER.inset * 2 + menu);
  const clusterLeft = edge === 'right' ? column / 2 - menu / 2 : width - column / 2 - menu / 2;
  const cluster = rect(clusterLeft, CLUSTER.inset, menu, 2 * menu + CLUSTER.gap);
  const strip = edge === 'right' ? rect(width - band, 0, band, height) : rect(0, 0, band, height);
  const catalogLeft = edge === 'right' ? width - band - gap - thumb.width : band + gap;
  return { viewport: { width, height }, cluster, strip, catalog: rect(catalogLeft, CLUSTER.inset, thumb.width, thumb.height) };
}

/** The line's box widened by the knob, which overhangs both ends. */
const withKnob = (line: Rect): Rect => ({ ...line, top: line.top - knobRadius, bottom: line.bottom + knobRadius });

describe('the lift line', () => {
  const cases = [
    ['portrait', screen(390, 760, 'bottom')],
    ['landscape, notch at the left', screen(844, 390, 'right', 59)],
    ['landscape, notch at the right', screen(844, 390, 'left', 59)],
    ['landscape, no notch', screen(844, 390, 'right')],
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

  it('portrait: ends above the manual\'s band', () => {
    const { viewport, cluster, strip } = screen(390, 760, 'bottom');
    const line = liftLineBox({ viewport, cluster, strip, hitWidth, knobRadius, gap })!;
    expect(line.bottom + knobRadius).toBeLessThanOrEqual(strip.top - gap);
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
