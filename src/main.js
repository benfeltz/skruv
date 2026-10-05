import { PICK, RENDER, RESET, ROOM, TUNE } from './constants.js';
import { createAssembly } from './game/assembly.js';
import { ANY, createBus, recoveryEvent, resetEvent, sessionEvent, tuneEvent } from './game/events.js';
import { createSessionBuffer } from './game/sessionBuffer.js';
import { createTunables, LIVE_KNOBS } from './game/tunables.js';
import { PART_TYPES } from './game/catalog.js';
import { createPartMesh } from './game/partMesh.js';
import { hasEscaped } from './game/dragMath.js';
import { createPackedWorldLayout, lidRest, respawnSpots } from './game/packedLayout.js';
import { isSmallPart } from './game/pickMath.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { clampPixelRatio } from './scene/clamp.js';
import { createGhost } from './scene/ghost.js';
import { createCompoundPhysics } from './scene/compoundPhysics.js';
import { createDisplayShelf } from './scene/displayShelf.js';
import { createDropGuide } from './scene/dropGuide.js';
import { createFlatpack } from './scene/flatpack.js';
import { createGestureRouter } from './scene/gestureRouter.js';
import { createGizmo } from './scene/gizmo.js';
import { createHighlight } from './scene/highlight.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';
import { createSprue } from './scene/sprue.js';
import { createBookletPages } from './scene/bookletPages.js';
import { createBookletSheet } from './ui/booklet.js';
import { createResetButton } from './ui/resetButton.js';
import { createToggleButton } from './ui/toggleButton.js';

// The session's event stream, and the buffer that keeps it for export. Observers only:
// nothing in the game reads it back.
const events = createBus({ now: () => performance.now() });
const session = createSessionBuffer({
  size: TUNE.sessionBufferSize,
  // randomUUID needs a secure context; a phone on the LAN dev server isn't one.
  session: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
  startedAt: new Date().toISOString(),
});
events.on(ANY, session.push);
if (import.meta.env.DEV) events.on(ANY, (event) => console.debug('[skruv]', event.type, event));
events.emit(sessionEvent('start'));
// Backgrounded and back: a session that ends hidden is an abandon.
document.addEventListener('visibilitychange', () => events.emit(sessionEvent(document.visibilityState)));

const { renderer, scene, camera } = createScene(document.getElementById('app'));
scene.add(createRoom());

const cameraControls = createCameraControls(camera, renderer.domElement);
const physics = await createPhysicsWorld();

// Live tuning: a knob set writes through to the constants every module reads; values baked
// into engine objects at creation are re-applied here.
const tunables = createTunables();
tunables.subscribe((key, value) => {
  events.emit(tuneEvent(key, value));
  const { group } = LIVE_KNOBS[key];
  if (group === 'physics' || group === 'joint') physics.retune();
  if (key === 'render.maxPixelRatio') renderer.setPixelRatio(clampPixelRatio(window.devicePixelRatio, RENDER.maxPixelRatio));
});

// The game opens on the closed flatpack: every part packed flat inside, settling at once
// and resting until the lid comes off and a hand disturbs it.
const flatpack = createFlatpack(physics);
scene.add(flatpack.object, flatpack.lid.mesh);

// One record per physical part — what gestures pick, drag and snap. The lid is one too.
const parts = [flatpack.lid];
const packed = createPackedWorldLayout();
for (const { id, type, position, rotation } of packed) {
  const part = PART_TYPES[type];
  const mesh = createPartMesh(part);
  const body = physics.register(mesh, {
    halfExtents: part.size.map((d) => d / 2),
    mass: part.mass,
    position,
    rotation,
  });
  scene.add(mesh);
  parts.push({ id, type, mesh, body });
}

// The display JOHNNY against the wall: already built, its parts ordinary parts.
const display = createDisplayShelf(physics);
for (const part of display.parts) scene.add(part.mesh);
parts.push(...display.parts);

// What is seated on and fastened to what — every type-compatible pair, right or wrong.
const typeById = new Map(parts.map(({ id, type }) => [id, type]));
const assembly = createAssembly((id) => typeById.get(id));
// The display shelf goes in fastened, through the graph's own events.
display.fasten(assembly);
// Manipulation goes through this seam so a fastened compound moves as one.
const manipulation = createCompoundPhysics(physics, parts, assembly);

// 90° detents are the default; the toggle frees rotation.
const freeRotate = createToggleButton({ label: 'Free rotate' });
document.body.append(freeRotate.element);

const gizmo = createGizmo({
  camera,
  domElement: renderer.domElement,
  physics: manipulation,
  isFree: () => freeRotate.pressed,
});
scene.add(gizmo.object);

// The booklet: pages drawn from the same models, flipped freely — reference, never a gate.
const bookletPages = createBookletPages(renderer);
const booklet = createBookletSheet({ pages: bookletPages });
document.body.append(booklet.thumb, booklet.element);

// While the booklet is open, the open page's parts glow — the player's own set only, never
// the display shelf or the box lid.
const playerParts = parts.filter((part) => !display.parts.includes(part) && part !== flatpack.lid);
const highlight = createHighlight(playerParts);
booklet.onChange(({ page, expanded }) => {
  const shown = bookletPages.pages[page];
  highlight.show(expanded && shown.kind === 'step' ? shown.types : []);
});

const ghost = createGhost();
scene.add(ghost.object);

// While a part is dragged: where it would land, and the hole it would drop onto.
const dropGuide = createDropGuide();
scene.add(dropGuide.object);

// A model-kit handle on a selected fastener or tool, to drag millimetre hardware by.
const sprue = createSprue();
scene.add(sprue.object);

function select(part) {
  if (!part) {
    gizmo.hide();
    sprue.hide();
    return;
  }
  gizmo.show(part);
  if (isSmallPart(PART_TYPES[part.type].size, PICK)) sprue.show(part);
  else sprue.hide();
}

const router = createGestureRouter({
  domElement: renderer.domElement,
  camera,
  cameraControls,
  physics: manipulation,
  parts,
  assembly,
  rings: gizmo,
  // Tap a part to select it (unless the tap pushed a fastener home); tap empty space to
  // deselect.
  onTap: select,
  ghost,
  sprue,
  dropGuide,
  events,
});
// The display shelf's physics joints, made by the same reconcile every tap and turn runs.
router.sync();

// Repack: the player's parts come apart by the normal teardown and go back into the box
// as packed, lid on. The display shelf is never touched.
const packedPose = new Map([[flatpack.lid.id, lidRest()], ...packed.map((p) => [p.id, p])]);
function repack() {
  events.emit(resetEvent());
  router.unseatAll(playerParts.map((part) => part.id));
  select(null);
  for (const { id, body } of [...playerParts, flatpack.lid]) {
    const { position, rotation } = packedPose.get(id);
    physics.place(body, position, rotation);
  }
}
document.body.append(createResetButton({ onReset: repack }).element);

// Recovery: a loose player part that has left the room (through a slab, off a wall) is set
// down again beside the box. Bonded parts go back only with a repack.
let sweepIn = RESET.sweepInterval;
function sweep(delta) {
  sweepIn -= delta;
  if (sweepIn > 0) return;
  sweepIn = RESET.sweepInterval;
  const escaped = [...playerParts, flatpack.lid].filter(({ id, body }) => {
    const { x, y, z } = body.translation();
    return hasEscaped([x, y, z], ROOM, RESET.escapeMargin) && assembly.compoundOf(id).size === 1;
  });
  if (escaped.length === 0) return;
  events.emit(recoveryEvent(escaped.map(({ id }) => id)));
  const spots = respawnSpots(escaped.map((part) => part.type));
  escaped.forEach(({ body }, i) => physics.place(body, spots[i].position, spots[i].rotation));
}

createLoop((delta) => {
  cameraControls.update(delta);
  physics.step(delta);
  sweep(delta);
  router.update(delta);
  gizmo.update();
  sprue.update();
  highlight.update(delta);
  renderer.render(scene, camera);
}).start();
// The rest of the booklet draws in idle time, after the room is on screen.
bookletPages.prerender();
