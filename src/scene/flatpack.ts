import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOX, COLORS } from '../constants.js';
import { PART_TYPES } from '../game/item.js';
import { baseRest, boxSlabs, lidRest } from '../game/boxLayout.js';
import { createPartMesh } from '../game/partMesh.js';
import { inkEdges } from './ink.js';
import type { Ink } from './ink.js';
import type { Part } from '../game/partMesh.js';
import type { PhysicsWorld } from '../physics/world.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

/**
 * The flatpack the game opens on: an open-topped cardboard box lying on the floor — bottom
 * and four thin walls glued into one heavy dynamic body, so a panel slid out of it scrapes
 * over the wall the way a real one does and the empty box can be dragged aside — and its
 * lid closed on top. Both are normal physics parts (`{ id, type, mesh, body }`) for the
 * gesture router to grab like any other. The box and lid take the edge pass, like the room, for
 * their creases and folds; the parts take the hull. Builds once; the poses are src/game/boxLayout.ts's.
 */
export function createFlatpack(physics: PhysicsWorld, ink: Ink): { base: Part; lid: Part } {
  const slabs = boxSlabs();
  const geometry = mergeGeometries(
    slabs.map(({ size, offset }) => new THREE.BoxGeometry(...size).translate(...offset)),
  );
  const box = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.cardboard }));
  box.name = 'flatpack';
  box.castShadow = true;
  box.receiveShadow = true;
  box.add(inkEdges(geometry, ink.lines));
  const rest = baseRest();
  // map keeps the length; TS widens a mapped tuple to number[].
  const boxBody = physics.register(box, {
    colliders: slabs.map(({ size, offset }) => ({ halfExtents: size.map((d) => d / 2) as Vec3, offset })),
    mass: BOX.mass,
    friction: BOX.friction,
    position: rest.position,
    rotation: rest.rotation,
  });

  const type = PART_TYPES.boxLid;
  const mesh = createPartMesh(type);
  mesh.add(inkEdges(mesh.geometry, ink.lines));
  const closed = lidRest();
  const body = physics.register(mesh, {
    halfExtents: type.size.map((d) => d / 2) as Vec3,
    // The lid has the pack's mass.
    mass: type.mass!,
    position: closed.position,
    rotation: closed.rotation,
  });

  return {
    base: { id: 'boxBase-1', type: 'boxBase', mesh: box, body: boxBody },
    lid: { id: 'boxLid-1', type: 'boxLid', mesh, body },
  };
}
