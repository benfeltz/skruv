// How a loose-parts page (pose 'parts') lays out its panels: each lying on its largest face,
// its long side across the page (x), the panels side by side down the page (z) with a gap
// between. Pure — sizes in, rotations and offsets out — so Vitest checks it headlessly;
// src/scene/bookletPages.ts draws with it.

import { multiplyQuaternions, rotateVector } from '../../tools/validate/lib/geometry.js';
import type { Quat, Size } from '../../tools/validate/lib/geometry.js';

const QUARTER_TURN = Math.SQRT1_2;
// The quarter turn that brings a panel's thinnest axis (x, y or z) up.
const LAY_FLAT: readonly Quat[] = [
  [0, 0, QUARTER_TURN, QUARTER_TURN],
  [0, 0, 0, 1],
  [-QUARTER_TURN, 0, 0, QUARTER_TURN],
];
// A further quarter turn about y swaps a flat panel's x and z.
const TURN_Y: Quat = [0, QUARTER_TURN, 0, QUARTER_TURN];

/** The panel's world extent along `axis` once turned by `rotation`. */
const extent = (size: Size, rotation: Quat, axis: number) =>
  [0, 1, 2].reduce((sum, i) => sum + Math.abs(rotateVector(rotation, [0, 1, 2].map((k) => (k === i ? size[i] : 0)) as Size)[axis]), 0);

/** A panel's rotation in the fan — from its own frame — and its centre's offset down the page. */
export interface FanPlace {
  rotation: Quat;
  offset: number;
}

/**
 * Where each panel of `sizes` lies in the fan: on its largest face, long side across, each
 * starting `gap` past the last one's edge. A panel whose length lies down the page once flat
 * (a bed's side rail, built running front to back) is turned a quarter about y first, so
 * panels never stack along their length.
 */
export function fanLayout(sizes: Size[], gap: number): FanPlace[] {
  let edge = 0;
  return sizes.map((size, i) => {
    const flat = LAY_FLAT[size.indexOf(Math.min(...size))];
    const rotation = extent(size, flat, 2) > extent(size, flat, 0) ? multiplyQuaternions(TURN_Y, flat) : flat;
    const depth = extent(size, rotation, 2);
    if (i > 0) edge += gap;
    const offset = edge + depth / 2;
    edge += depth;
    return { rotation, offset };
  });
}
