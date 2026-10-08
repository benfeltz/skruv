// Hole markings: where each socket on a part shows as a decal. Pure: catalog connector
// records in, plain placements out ([x, y, z] positions, [x, y, z, w] quaternions), so
// Vitest covers it headlessly; src/game/partMesh.ts draws them. No CSG — a decal is a flat
// marking laid just proud of the face its hole opens on.

import { DECAL } from '../constants.js';
import { CONNECTOR } from '../../tools/validate/lib/vocabulary.js';
import { rotationBetween } from '../../tools/validate/lib/geometry.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { Connector } from '../../tools/validate/lib/pack.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';

export type DecalKind = 'hole' | 'recess';

/** One socket's marking, part-local — see `decalPlacements`. */
export interface DecalPlacement {
  index: number;
  kind: DecalKind;
  radius: number;
  position: Vec3;
  rotation: Quat;
}

// Sockets that open on a part's surface. Fastener ends (tips, threads, bodies) and the
// sockets that ride on hardware (bolt heads, cam slots) get no decal.
const KIND_BY_SOCKET: Readonly<Partial<Record<ConnectorType, DecalKind>>> = Object.freeze({
  [CONNECTOR.DOWEL_HOLE]: 'hole',
  [CONNECTOR.CAM_BOLT_HOLE]: 'hole',
  [CONNECTOR.SHELF_PIN_HOLE]: 'hole',
  [CONNECTOR.BACK_FITTING_HOLE]: 'hole',
  [CONNECTOR.CAM_LOCK_RECESS]: 'recess',
});

// A decal's flat face is drawn facing +z before it is turned onto the hole's axis.
const DECAL_NORMAL: Vec3 = [0, 0, 1];

/**
 * One `{ index, kind, radius, position, rotation }` per socket connector, in the part's
 * local frame: `index` is the connector's index (the key a flash looks it up by), `kind` is
 * 'hole' or 'recess', and the decal sits `surfaceOffset` out along the hole's axis, turned
 * to face along it.
 */
export function decalPlacements(connectors: Pick<Connector, 'type' | 'position' | 'axis'>[], decal = DECAL): DecalPlacement[] {
  const radii: Partial<Record<ConnectorType, number>> = decal.radius;
  return connectors.flatMap(({ type, position, axis }, index) => {
    const kind = KIND_BY_SOCKET[type];
    if (!kind) return [];
    return [
      {
        index,
        kind,
        // Every socket type has a radius in DECAL.
        radius: radii[type]!,
        // map keeps the length; TS widens a mapped tuple to number[].
        position: position.map((v, i) => v + axis[i] * decal.surfaceOffset) as Vec3,
        rotation: rotationBetween(DECAL_NORMAL, axis),
      },
    ];
  });
}

/**
 * The socket a part let go of at `point` would drop onto: the nearest of `sockets`
 * (world-space records with a `position`, e.g. free holes that take the part) within
 * `reach` metres of where the drop line lands — or null when it lands on bare surface.
 */
export function socketUnder<T extends { position: number[] }>(point: number[], sockets: Iterable<T>, reach: number): T | null {
  let best: T | null = null;
  let bestDistance = reach;
  for (const socket of sockets) {
    const distance = Math.hypot(...socket.position.map((v, i) => v - point[i]));
    if (distance <= bestDistance) {
      best = socket;
      bestDistance = distance;
    }
  }
  return best;
}
