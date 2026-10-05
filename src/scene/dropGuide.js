import * as THREE from 'three';
import { COLORS, DROP } from '../constants.js';

const RING_SEGMENTS = 32;

/**
 * Drop line: while a part is dragged, a thin line from its underside straight down to
 * where it would land if let go, and a flat ring there. It renders only; where it lands
 * (and which hole lights up) is src/scene/gestureRouter.js's raycast.
 */
export function createDropGuide() {
  const object = new THREE.Group();
  object.visible = false;
  const material = new THREE.LineBasicMaterial({ color: COLORS.dropGuide, transparent: true, opacity: DROP.opacity });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), material);
  line.frustumCulled = false;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(DROP.ringRadius - DROP.ringWidth, DROP.ringRadius, RING_SEGMENTS),
    new THREE.MeshBasicMaterial({ color: COLORS.dropGuide, transparent: true, opacity: DROP.opacity, depthWrite: false }),
  );
  // Lies flat, facing up.
  ring.rotation.x = -Math.PI / 2;
  object.add(line, ring);
  const ends = line.geometry.attributes.position;

  return {
    object,
    /** Line from `from` down to `to` ([x, y, z]), ring at `to`. */
    show(from, to) {
      ends.setXYZ(0, ...from);
      ends.setXYZ(1, ...to);
      ends.needsUpdate = true;
      ring.position.set(to[0], to[1] + DROP.ringWidth / 10, to[2]);
      object.visible = true;
    },
    hide() {
      object.visible = false;
    },
  };
}
