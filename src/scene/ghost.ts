import * as THREE from 'three';
import { COLORS, SNAP } from '../constants.js';
import type { Pose } from '../../tools/validate/lib/geometry.js';

/**
 * Translucent preview of where a dragged part will seat if released now — green when it is
 * where a panel goes, amber for any other seat. Shares the dragged mesh's geometry; one
 * mesh, re-pointed per drag.
 */
export function createGhost() {
  const object = new THREE.Mesh(
    undefined,
    new THREE.MeshBasicMaterial({
      color: COLORS.ghost,
      transparent: true,
      opacity: SNAP.ghostOpacity,
      depthWrite: false,
    }),
  );
  object.visible = false;
  const { material } = object;

  return {
    object,
    /** Shows `mesh`'s shape at `{ position, rotation }` ([x, y, z], [x, y, z, w]); `whereItGoes` turns it green. */
    show(mesh: THREE.Mesh, { position, rotation }: Pose, whereItGoes = false) {
      material.color.setHex(whereItGoes ? COLORS.whereItGoes : COLORS.ghost);
      object.geometry = mesh.geometry;
      object.position.set(...position);
      object.quaternion.set(...rotation);
      object.visible = true;
    },
    hide() {
      object.visible = false;
    },
  };
}
