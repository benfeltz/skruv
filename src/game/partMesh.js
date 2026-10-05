import * as THREE from 'three';
import { COLORS, DECAL } from '../constants.js';
import { decalPlacements } from './decals.js';

/**
 * Box mesh for a catalog part type, sized and coloured from its catalog entry, with a
 * marking on every socket (src/game/decals.js). `mesh.userData.decals` maps connector
 * index → that socket's decal mesh, so a seat can flash the hole it went into.
 */
export function createPartMesh({ size, color, connectors = [] }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color: COLORS[color] }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.decals = new Map();
  for (const { index, kind, radius, position, rotation } of decalPlacements(connectors)) {
    const geometry =
      kind === 'recess'
        ? new THREE.RingGeometry(radius * DECAL.recessInner, radius, DECAL.segments)
        : new THREE.CircleGeometry(radius, DECAL.segments);
    // Own material per decal: the seat flash lights one hole, not all of them.
    const decal = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.decal, emissive: 0x000000 }));
    decal.position.set(...position);
    decal.quaternion.set(...rotation);
    decal.castShadow = false;
    decal.receiveShadow = true;
    mesh.add(decal);
    mesh.userData.decals.set(index, decal);
  }
  return mesh;
}
