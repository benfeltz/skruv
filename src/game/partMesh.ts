import * as THREE from 'three';
import { COLORS, DECAL } from '../constants.js';
import { decalPlacements } from './decals.js';
import type { GamePartType } from './item.js';
import type { PartId } from './assembly.js';
import type { Body } from '../physics/world.js';

/** A part's mesh: one box (or the box base's merged slabs) in a standard material. */
export type PartMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** A physics part, as the registry holds it: its instance id and type, mesh and body. */
export interface Part {
  id: PartId;
  type: string;
  mesh: PartMesh;
  body: Body;
}

/**
 * Box mesh for a catalog part type, sized and coloured from its catalog entry, with a
 * marking on every socket (src/game/decals.ts). `mesh.userData.decals` maps connector
 * index → that socket's decal mesh, so a seat can flash the hole it went into.
 */
export function createPartMesh({ size, color, connectors = [] }: Pick<GamePartType, 'size' | 'color'> & Partial<Pick<GamePartType, 'connectors'>>) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    // A part's `color` names a COLORS key (the pack's palette).
    new THREE.MeshStandardMaterial({ color: COLORS[color as keyof typeof COLORS] }),
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
    const decal = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLORS.decal, emissive: COLORS.unlit }));
    decal.position.set(...position);
    decal.quaternion.set(...rotation);
    decal.castShadow = false;
    decal.receiveShadow = true;
    mesh.add(decal);
    mesh.userData.decals.set(index, decal);
  }
  return mesh;
}
