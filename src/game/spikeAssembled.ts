// Engine spike 1.2 (branch-local): the `?spike=assembled` boot plan. Pure — the item's
// assembled layout and derived joints, placed in the room, as main.ts spawns and seats
// them; and the rest of the box (spares, tools) to lie loose. No Three, Rapier or DOM.

import { SPIKE } from '../constants.js';
import { ASSEMBLED, MANIFEST } from './item.js';
import { placeLayout } from '../../tools/validate/lib/geometry.js';
import type { ApplyContext, SeatPair } from './assembly.js';
import type { PackedPart } from './boxLayout.js';

/**
 * True when the page asks for the assembled spike: its query string (`location.search`)
 * says so, or it is served from the Capacitor shell's own scheme (`location.protocol`) —
 * which a browser never is, so the plain URL is untouched.
 */
export function isSpikeAssembled(search: string, protocol: string) {
  return protocol === SPIKE.shellProtocol || new URLSearchParams(search).get(SPIKE.queryParam) === SPIKE.assembledMode;
}

/**
 * The player's set as the spike boots it:
 *   assembled — every instance of the assembled layout, `{ id, type, position, rotation }`
 *               at SPIKE.assembledPosition/Yaw, ids the manifest's own
 *   loose     — every other manifest entry (`{ id, type }`): spares and tools
 *   pairs     — one seat pair per derived joint, as `seatHome` takes them, so the joints
 *               come from the same seat → drive → router.sync path a build runs
 */
export function spikeAssembledPlan() {
  const half = SPIKE.assembledYaw / 2;
  const assembled: PackedPart[] = placeLayout(ASSEMBLED.parts, {
    position: SPIKE.assembledPosition,
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
  }).map(({ id, type, position, rotation }) => ({ id, type, position, rotation }));
  const placed = new Set(assembled.map(({ id }) => id));
  const loose = MANIFEST.filter(({ id }) => !placed.has(id)).map(({ id, type }) => ({ id, type }));
  const pairs: (SeatPair & { ctx: ApplyContext })[] = ASSEMBLED.joints.map((j) => ({
    partA: j.hardware,
    connectorA: j.hardwareConnector,
    partB: j.host,
    connectorB: j.hostConnector,
    mover: j.mover,
    ctx: { through: j.through, captured: j.captured },
  }));
  return { assembled, loose, pairs };
}
