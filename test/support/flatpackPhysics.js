// The flatpack's static slabs, as src/scene/flatpack.js adds them, without Three: the same
// box-local slabs carried into the room by the box placement.
import { rotateVector } from '../../tools/validate/lib/geometry.js';
import { boxPlacement, PACKED_BOX as BOX } from '../../src/game/boxLayout.js';

export function createFlatpack(physics) {
  const { position, rotation } = boxPlacement();
  const [width, height, length] = BOX.inner;
  const { wall, floor } = BOX;
  const outerW = width + 2 * wall;
  const slabs = [
    { size: [outerW, floor, length + 2 * wall], at: [0, floor / 2, 0] },
    { size: [wall, height, length], at: [-(width + wall) / 2, floor + height / 2, 0] },
    { size: [wall, height, length], at: [(width + wall) / 2, floor + height / 2, 0] },
    { size: [outerW, height, wall], at: [0, floor + height / 2, -(length + wall) / 2] },
    { size: [outerW, height, wall], at: [0, floor + height / 2, (length + wall) / 2] },
  ];
  for (const { size, at } of slabs) {
    physics.addStatic({ halfExtents: size.map((d) => d / 2), position: rotateVector(rotation, at).map((v, i) => v + position[i]), rotation });
  }
}
