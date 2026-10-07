import * as THREE from 'three';
import { COLORS } from '../constants.js';
import { PACKING, PART_TYPES } from '../game/item.js';
import { boxPlacement, lidRest } from '../game/packedLayout.js';
import { createPartMesh } from '../game/partMesh.js';

/**
 * The flatpack the game opens on: an open-topped cardboard box lying on the floor — bottom
 * and four thin walls, each a static physics slab, so a panel slid out of it scrapes over
 * the wall the way a real one does — and its lid, a normal physics part (`{ id, type,
 * mesh, body }`) closed on top, for the gesture router to grab like any other. Builds once;
 * the poses are src/game/packedLayout.js's.
 */
export function createFlatpack(physics) {
  const { position, rotation } = boxPlacement();
  const quaternion = new THREE.Quaternion(...rotation);
  const box = new THREE.Group();
  box.name = 'flatpack';
  box.position.set(...position);
  box.quaternion.copy(quaternion);

  const [width, height, length] = PACKING.boxInner;
  const { wall, floor } = PACKING;
  const outerW = width + 2 * wall;
  const slabs = [
    { size: [outerW, floor, length + 2 * wall], at: [0, floor / 2, 0] },
    { size: [wall, height, length], at: [-(width + wall) / 2, floor + height / 2, 0] },
    { size: [wall, height, length], at: [(width + wall) / 2, floor + height / 2, 0] },
    { size: [outerW, height, wall], at: [0, floor + height / 2, -(length + wall) / 2] },
    { size: [outerW, height, wall], at: [0, floor + height / 2, (length + wall) / 2] },
  ];
  const material = new THREE.MeshStandardMaterial({ color: COLORS.cardboard });
  const world = new THREE.Vector3();
  for (const { size, at } of slabs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    box.add(mesh);
    world.set(...at).applyQuaternion(quaternion).add(new THREE.Vector3(...position));
    physics.addStatic({ halfExtents: size.map((d) => d / 2), position: world.toArray(), rotation });
  }

  const type = PART_TYPES.boxLid;
  const mesh = createPartMesh(type);
  const rest = lidRest();
  const body = physics.register(mesh, {
    halfExtents: type.size.map((d) => d / 2),
    mass: type.mass,
    position: rest.position,
    rotation: rest.rotation,
  });

  return { object: box, lid: { id: 'boxLid-1', type: 'boxLid', mesh, body } };
}
