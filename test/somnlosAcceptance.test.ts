import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOX, RESET, ROOM } from '../src/constants.js';
import { boxPlacement, lidRest, packedBox } from '../src/game/boxLayout.js';
import { rotatedHalfExtents } from '../src/game/dragMath.js';
import { boxFootprintSize } from '../src/game/roomLayout.js';
import { PART_TYPES, setItem } from '../src/game/item.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

// 1.9.0.4 acceptance, against the plan's criteria. AC5, the part budget on a phone, is
// manual (stated in the PR body, never faked here).

const inRoom = ([x, , z]: number[], [hx, hz]: number[]) => Math.abs(x) + hx <= ROOM.width / 2 && Math.abs(z) + hz <= ROOM.depth / 2;

describe('AC3: the box, its opening and the respawn patch fit the stage', () => {
  beforeAll(() => setItem('somnlos'));
  afterAll(() => setItem('johnny'));

  it('stands the box, lid on or lifted straight off, inside the room where the room puts it', () => {
    const [sx, sz] = boxFootprintSize(packedBox());
    expect(inRoom(BOX.position, [sx / 2, sz / 2])).toBe(true);
    // The lid closes over the walls: its footprint is the box's.
    const lid = lidRest();
    const [hx, , hz] = rotatedHalfExtents(PART_TYPES.boxLid.size.map((d) => d / 2), lid.rotation);
    expect(inRoom(lid.position, [hx, hz])).toBe(true);
  });

  it("lays the respawn patch, on the box's first side, wholly inside the room", () => {
    const { inner, wall } = packedBox();
    const { offset, depth } = RESET.respawn;
    const near = inner[0] / 2 + wall + offset;
    const along = inner[2] / 2 + wall + offset;
    // The patch's four corners, box-local, carried into the room.
    const pose = boxPlacement();
    for (const [x, z] of [[near, -along], [near, along], [near + depth, -along], [near + depth, along]]) {
      const [wx, , wz] = rotateVector(pose.rotation, [x, 0, z] as Vec3).map((v, i) => v + pose.position[i]);
      expect(inRoom([wx, 0, wz], [0, 0]), `corner ${x}, ${z}`).toBe(true);
    }
  });
});
