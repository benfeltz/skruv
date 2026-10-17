import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, DECAL } from '../constants.js';
import { decalPlacements } from './decals.js';
import { halfExtents, shapeOf } from './partShapes.js';
import type { Primitive, Tone } from './partShapes.js';
import type { GamePartType } from './item.js';
import type { PartId } from './assembly.js';
import type { Body } from '../physics/world.js';

/** A part's mesh: one geometry (a box, merged slabs, or a piece's merged shape) in a standard material. */
export type PartMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** A physics part, as the registry holds it: its instance id and type, mesh and body. */
export interface Part {
  id: PartId;
  type: string;
  mesh: PartMesh;
  body: Body;
}

// The second tones a shaped piece may carry; `body` is the part's own pack colour.
const TONES: Readonly<Record<Exclude<Tone, 'body'>, number>> = Object.freeze({
  metal: COLORS.partMetal,
  dark: COLORS.partRecess,
});

// A CylinderGeometry runs along y; these turn it onto x or z.
const TURN_ONTO: Readonly<Record<Primitive['axis'], THREE.Euler>> = Object.freeze({
  0: new THREE.Euler(0, 0, -Math.PI / 2),
  1: new THREE.Euler(),
  2: new THREE.Euler(Math.PI / 2, 0, 0),
});

// One primitive's geometry, placed part-local and painted its tone in a vertex colour.
function primitiveGeometry(primitive: Primitive, body: THREE.Color) {
  const [hx, hy, hz] = halfExtents(primitive);
  const geometry =
    primitive.shape === 'cylinder'
      ? new THREE.CylinderGeometry(primitive.radius, primitive.radius, primitive.length, primitive.sides).applyQuaternion(
          new THREE.Quaternion().setFromEuler(TURN_ONTO[primitive.axis]),
        )
      : new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz);
  geometry.translate(...primitive.position);
  const tone = primitive.tone === 'body' ? body : new THREE.Color(TONES[primitive.tone]);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) tone.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Mesh for a catalog part type, sized and coloured from its catalog entry, with a marking
 * on every socket (src/game/decals.ts). A universal piece (src/game/partShapes.ts) is drawn
 * as its shape — merged into one geometry, its tones in vertex colours on the one material,
 * so highlight's emissive and the ghost's shared geometry work as on a box; anything else is
 * its box. Either way it lies inside the pack box, which stays the collider.
 * `mesh.userData.shaped` says which (a panel is not shaped). `mesh.userData.decals` maps connector index → that socket's decal mesh, so a seat can
 * flash the hole it went into.
 */
export function createPartMesh({ size, color, connectors = [] }: Pick<GamePartType, 'size' | 'color'> & Partial<Pick<GamePartType, 'connectors'>>) {
  // A part's `color` names a COLORS key (the pack's palette).
  const body = COLORS[color as keyof typeof COLORS];
  const primitives = shapeOf({ size, connectors });
  const mesh = new THREE.Mesh(
    primitives ? mergeGeometries(primitives.map((p) => primitiveGeometry(p, new THREE.Color(body)))) : new THREE.BoxGeometry(...size),
    primitives ? new THREE.MeshStandardMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ color: body }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.decals = new Map();
  mesh.userData.shaped = primitives !== null;
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
