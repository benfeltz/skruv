import { DISPLAY } from '../constants.js';
import { seatHome } from '../game/assembly.js';
import { createAssembledLayout, placeLayout } from '../game/assembledLayout.js';
import { PART_TYPES } from '../game/catalog.js';
import { createPartMesh } from '../game/partMesh.js';

/**
 * The display JOHNNY: a second set of parts at the assembled layout's poses, standing
 * against the back wall already built. Its parts are ordinary parts (`{ id, type, mesh,
 * body }`, ids prefixed with DISPLAY.idPrefix) for the caller to add to the registry, so
 * every gesture works on them exactly as on the player's own.
 *
 * `fasten(assembly)` seats every pair of the layout in the assembly graph and drives each
 * fastener home (`seatHome` → `assembly.drive`) — dowels, pins and back fittings pressed, bolts
 * screwed, cams locked on their bolts — the same events a player's taps and turns send.
 * The physics joints then come from the gesture router's own reconcile (`router.sync()`),
 * so there is no spawn-only joint path: what the graph made, the player's tools unmake.
 * Adjustable shelves just rest on their pins, as in a real one.
 */
export function createDisplayShelf(physics) {
  const layout = createAssembledLayout();
  const half = DISPLAY.yaw / 2;
  const posed = placeLayout(layout.parts, { position: DISPLAY.position, rotation: [0, Math.sin(half), 0, Math.cos(half)] });
  const idOf = (id) => (id === null ? null : `${DISPLAY.idPrefix}${id}`);

  const parts = posed.map(({ id, type, position, rotation }) => {
    const part = PART_TYPES[type];
    const mesh = createPartMesh(part);
    const body = physics.register(mesh, {
      halfExtents: part.size.map((d) => d / 2),
      mass: part.mass,
      position,
      rotation,
      asleep: true,
    });
    return { id: idOf(id), type, mesh, body };
  });

  function fasten(assembly) {
    seatHome(
      assembly,
      layout.joints.map((j) => ({
        partA: idOf(j.hardware),
        connectorA: j.hardwareConnector,
        partB: idOf(j.host),
        connectorB: j.hostConnector,
        mover: idOf(j.mover),
        ctx: { through: idOf(j.through), captured: idOf(j.captured) },
      })),
    );
  }

  return { parts, fasten };
}
