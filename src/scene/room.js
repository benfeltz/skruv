import * as THREE from 'three';
import { COLORS, ROOM } from '../constants.js';

/** Floor plus four inward-facing walls, centred on the origin, floor at y = 0. */
export function createRoom() {
  const room = new THREE.Group();
  room.name = 'room';

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.width, ROOM.depth),
    new THREE.MeshStandardMaterial({ color: COLORS.floor }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: COLORS.wall });
  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  const walls = [
    { length: ROOM.width, x: 0, z: -halfD, rotationY: 0 },
    { length: ROOM.width, x: 0, z: halfD, rotationY: Math.PI },
    { length: ROOM.depth, x: -halfW, z: 0, rotationY: Math.PI / 2 },
    { length: ROOM.depth, x: halfW, z: 0, rotationY: -Math.PI / 2 },
  ];
  for (const { length, x, z, rotationY } of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(length, ROOM.height), wallMaterial);
    wall.position.set(x, ROOM.height / 2, z);
    wall.rotation.y = rotationY;
    wall.receiveShadow = true;
    room.add(wall);
  }

  return room;
}
