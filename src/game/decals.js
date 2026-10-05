// Hole markings: where each socket on a part shows as a decal. Pure: catalog connector
// records in, plain placements out ([x, y, z] positions, [x, y, z, w] quaternions), so
// Vitest covers it headlessly; src/game/partMesh.js draws them. No CSG — a decal is a flat
// marking laid just proud of the face its hole opens on.

import { DECAL } from '../constants.js';
import { CONNECTOR } from './catalog.js';
import { rotationBetween } from './snapMath.js';

// Sockets that open on a part's surface. Fastener ends (tips, threads, bodies) and the
// sockets that ride on hardware (bolt heads, cam slots) get no decal.
const KIND_BY_SOCKET = Object.freeze({
  [CONNECTOR.DOWEL_HOLE]: 'hole',
  [CONNECTOR.CAM_BOLT_HOLE]: 'hole',
  [CONNECTOR.SHELF_PIN_HOLE]: 'hole',
  [CONNECTOR.NAIL_HOLE]: 'hole',
  [CONNECTOR.CAM_LOCK_RECESS]: 'recess',
});

// A decal's flat face is drawn facing +z before it is turned onto the hole's axis.
const DECAL_NORMAL = [0, 0, 1];

/**
 * One `{ index, kind, radius, position, rotation }` per socket connector, in the part's
 * local frame: `index` is the connector's index (the key a flash looks it up by), `kind` is
 * 'hole' or 'recess', and the decal sits `surfaceOffset` out along the hole's axis, turned
 * to face along it.
 */
export function decalPlacements(connectors, decal = DECAL) {
  return connectors.flatMap(({ type, position, axis }, index) => {
    const kind = KIND_BY_SOCKET[type];
    if (!kind) return [];
    return [
      {
        index,
        kind,
        radius: decal.radius[type],
        position: position.map((v, i) => v + axis[i] * decal.surfaceOffset),
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
export function socketUnder(point, sockets, reach) {
  let best = null;
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
