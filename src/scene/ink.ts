import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, INK } from '../constants.js';

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

/**
 * A welded, position-only copy of a geometry with every vertex pushed `width` metres along its
 * smooth normal. Position-only so tone seams and facet splits weld: the hull is closed at corners.
 */
export function hullGeometry(geometry: THREE.BufferGeometry, width: number = INK.hullWidth): THREE.BufferGeometry {
  const bare = new THREE.BufferGeometry();
  bare.setAttribute('position', geometry.getAttribute('position').clone());
  const index = geometry.getIndex();
  if (index) bare.setIndex(index.clone());
  const hull = mergeVertices(bare);
  bare.dispose();
  hull.computeVertexNormals();
  const position = hull.getAttribute('position');
  const normal = hull.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) + normal.getX(i) * width,
      position.getY(i) + normal.getY(i) * width,
      position.getZ(i) + normal.getZ(i) * width,
    );
  }
  hull.deleteAttribute('normal');
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
