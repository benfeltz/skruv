import * as THREE from 'three';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import type { PickDistance } from './cameraControls.js';

/**
 * The camera's pivot pick (cameraControls.ts `pickDistance`): how far along a ray the first
 * of `meshes` is, or null. Handed the part meshes and the flatpack's base and lid only —
 * never the ghost, rings, decals, sprue, turn ring or drop guide, which are no place to
 * orbit about. The raycaster is built once; a pick is only the cast.
 */
export function createPivotPick(meshes: readonly THREE.Object3D[]): PickDistance {
  const raycaster = new THREE.Raycaster();
  // Three takes a mutable list.
  const targets = [...meshes];
  return (origin: Vec3, direction: Vec3) => {
    raycaster.ray.origin.set(...origin);
    raycaster.ray.direction.set(...direction);
    const [first] = raycaster.intersectObjects(targets, false);
    return first ? first.distance : null;
  };
}
