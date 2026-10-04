import * as THREE from 'three';
import { COLORS } from '../constants.js';

/** Box mesh for a catalog part type, sized and coloured from its catalog entry. */
export function createPartMesh({ size, color }) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color: COLORS[color] }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
