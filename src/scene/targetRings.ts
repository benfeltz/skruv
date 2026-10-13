import * as THREE from 'three';
import { COLORS, RING } from '../constants.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

const RING_SEGMENTS = 32;
// Lifted off the head or slot along its axis, so the ring never fights its face for depth.
const LIFT = RING.width / 4;

/** A ring to draw: on a target connector, facing along its axis, at a strength 0..1. */
export interface TargetRing {
  position: Vec3;
  axis: Vec3;
  strength: number;
}

/**
 * Target rings: while hardware is carried, a ring round each place it can go right now — a
 * free hole for a fastener, a fastener a tool can turn — brighter the nearer the finger. It renders only; which targets light, and how brightly,
 * is src/game/toolTargets.ts's call, driven from src/scene/gestureRouter.ts.
 */
export function createTargetRings() {
  const object = new THREE.Group();
  const geometry = new THREE.RingGeometry(RING.radius - RING.width, RING.radius, RING_SEGMENTS);
  const pool = Array.from({ length: RING.pool }, () => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: COLORS.targetRing, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.visible = false;
    object.add(mesh);
    return mesh;
  });
  // RingGeometry faces +z.
  const facing = new THREE.Vector3(0, 0, 1);
  const axis = new THREE.Vector3();

  return {
    object,
    /** One ring per entry, nearest first; any beyond the pool go undrawn. */
    show(rings: readonly TargetRing[]) {
      pool.forEach((mesh, i) => {
        const ring = rings[i];
        mesh.visible = !!ring;
        if (!ring) return;
        axis.fromArray(ring.axis);
        mesh.quaternion.setFromUnitVectors(facing, axis);
        mesh.position.fromArray(ring.position).addScaledVector(axis, LIFT);
        mesh.material.opacity = ring.strength * RING.opacity;
      });
    },
    hide() {
      for (const mesh of pool) mesh.visible = false;
    },
  };
}
