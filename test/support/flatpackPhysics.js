// The flatpack's box base, as src/scene/flatpack.ts registers it, without Three: one heavy
// dynamic body of the box-local slabs, standing where the box placement puts it.
import { BOX } from '../../src/constants.js';
import { baseRest, boxSlabs } from '../../src/game/boxLayout.js';

const stubMesh = () => ({ position: { set() {} }, quaternion: { set() {} } });

export function createFlatpack(physics) {
  return physics.register(stubMesh(), {
    colliders: boxSlabs().map(({ size, offset }) => ({ halfExtents: size.map((d) => d / 2), offset })),
    mass: BOX.mass,
    friction: BOX.friction,
    ...baseRest(),
  });
}
