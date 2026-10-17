import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, INK } from '../constants.js';

// Two faces count as one plane above this cosine; the mitre's solve is kept invertible by this much identity.
const PLANE_SAME = 0.9999;
const PLANE_EPSILON = 1e-6;

/**
 * The game's ink: one colour, drawn two ways. The inverted hull goes on every part — one silhouette
 * round a round and round a panel alike, the same weight on a bolt as on a shelf; the crease pass
 * (sharp edges only) goes on the room, the box and the panels, never on a faceted round. The hull's
 * width is metres in world space; the line's is CSS pixels.
 */
export interface Ink {
  lines: LineMaterial;
  hull: THREE.MeshBasicMaterial;
}

/** The line and hull materials, made once from the one ink colour. */
export function createInk(): Ink {
  return {
    lines: new LineMaterial({ color: COLORS.ink, linewidth: INK.lineWidth }),
    hull: new THREE.MeshBasicMaterial({ color: COLORS.ink, side: THREE.BackSide, toneMapped: false }),
  };
}

/** The raw sharp edges of a geometry: those meeting at more than `crease` degrees. */
export function edgesOf(geometry: THREE.BufferGeometry, crease: number = INK.boxCrease): THREE.EdgesGeometry {
  return new THREE.EdgesGeometry(geometry, crease);
}

/** A geometry's sharp edges as one fat line object. */
export function inkEdges(geometry: THREE.BufferGeometry, lines: LineMaterial, crease: number = INK.boxCrease): LineSegments2 {
  const edges = edgesOf(geometry, crease);
  const object = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(edges), lines);
  edges.dispose();
  object.name = 'inkEdges';
  return object;
}

/** The unit normal of each distinct plane meeting at every vertex of an indexed geometry. */
function planesAt(geometry: THREE.BufferGeometry): THREE.Vector3[][] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const planes: THREE.Vector3[][] = Array.from({ length: position.count }, () => []);
  const [a, b, c, normal] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    a.fromBufferAttribute(position, corners[0]!);
    b.fromBufferAttribute(position, corners[1]!).sub(a);
    c.fromBufferAttribute(position, corners[2]!).sub(a);
    if (normal.crossVectors(b, c).lengthSq() === 0) continue;
    normal.normalize();
    for (const corner of corners) {
      const seen = planes[corner]!;
      if (!seen.some((plane) => plane.dot(normal) > PLANE_SAME)) seen.push(normal.clone());
    }
  }
  return planes;
}

/**
 * The offset that moves every plane in `planes` out by `width` at once (a mitre): the least-squares
 * solution of n·v = width over the planes, capped at `INK.hullMiter` widths.
 */
function mitre(planes: readonly THREE.Vector3[], width: number, out: THREE.Vector3): THREE.Vector3 {
  const gram = new THREE.Matrix3().set(PLANE_EPSILON, 0, 0, 0, PLANE_EPSILON, 0, 0, 0, PLANE_EPSILON);
  const sum = new THREE.Vector3();
  for (const { x, y, z } of planes) {
    const m = gram.elements;
    // Column-major: add n nᵀ.
    m[0]! += x * x; m[3]! += x * y; m[6]! += x * z;
    m[1]! += y * x; m[4]! += y * y; m[7]! += y * z;
    m[2]! += z * x; m[5]! += z * y; m[8]! += z * z;
    sum.add(out.set(x, y, z));
  }
  out.copy(sum).multiplyScalar(width).applyMatrix3(gram.invert());
  return out.length() > width * INK.hullMiter ? out.setLength(width * INK.hullMiter) : out;
}

/**
 * A welded, position-only copy of a geometry with every vertex pushed out so each face is `width`
 * metres thicker (a mitre, so a thin panel's narrow sides grow as much as its big faces). Position-only
 * so tone seams and facet splits weld: the hull is closed at corners.
 */
export function hullGeometry(geometry: THREE.BufferGeometry, width: number = INK.hullWidth): THREE.BufferGeometry {
  const bare = new THREE.BufferGeometry();
  bare.setAttribute('position', geometry.getAttribute('position').clone());
  const index = geometry.getIndex();
  if (index) bare.setIndex(index.clone());
  const hull = mergeVertices(bare);
  bare.dispose();
  const position = hull.getAttribute('position');
  const planes = planesAt(hull);
  const offset = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    mitre(planes[i]!, width, offset);
    position.setXYZ(i, position.getX(i) + offset.x, position.getY(i) + offset.y, position.getZ(i) + offset.z);
  }
  hull.computeBoundingBox();
  hull.computeBoundingSphere();
  return hull;
}

/** A geometry's back-face silhouette: its hull, drawn in the ink behind the part. */
export function inkHull(geometry: THREE.BufferGeometry, hull: THREE.MeshBasicMaterial, width: number = INK.hullWidth): THREE.Mesh {
  const mesh = new THREE.Mesh(hullGeometry(geometry, width), hull);
  mesh.name = 'inkHull';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
