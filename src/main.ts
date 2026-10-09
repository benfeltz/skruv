import { HAPTICS, PICK, RENDER, RESET, ROOM, TUNE } from './constants.js';
import { createAssembly } from './game/assembly.js';
import { ANY, createBus, EVENT, fpsEvent, recoveryEvent, resetEvent, sessionEvent, tuneEvent } from './game/events.js';
import { KIND } from '../tools/validate/lib/vocabulary.js';
import { createSessionBuffer } from './game/sessionBuffer.js';
import { createTunables, LIVE_KNOBS } from './game/tunables.js';
import { PART_TYPES } from './game/item.js';
import { createPartMesh } from './game/partMesh.js';
import { hasEscaped } from './game/dragMath.js';
import { fractionOf, heightAt } from './game/liftLine.js';
import { baseRest, boxPlacement, boxPoseOf, createPackedWorldLayout, lidRest, respawnSpots } from './game/boxLayout.js';
import { isSmallPart } from './game/pickMath.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { clampPixelRatio } from './scene/clamp.js';
import { createGhost } from './scene/ghost.js';
import { createCompoundPhysics } from './scene/compoundPhysics.js';
import { createDisplayShelf } from './scene/displayShelf.js';
import { createDropGuide } from './scene/dropGuide.js';
import { createFpsGuard } from './scene/fpsGuard.js';
import { createFlatpack } from './scene/flatpack.js';
import { createGestureRouter } from './scene/gestureRouter.js';
import { createLiftHold, liftRangeOf } from './scene/liftHold.js';
import { createGizmo } from './scene/gizmo.js';
import { createHighlight } from './scene/highlight.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';
import { createSprue } from './scene/sprue.js';
import { createBookletPages } from './scene/bookletPages.js';
import { createBookletSheet } from './ui/booklet.js';
import { createLiftLine } from './ui/liftLine.js';
import type { PartId } from './game/assembly.js';
import type { Part } from './game/partMesh.js';
import type { Pose, Vec3 } from '../tools/validate/lib/geometry.js';
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

// index.html carries the #app mount.
const { renderer, scene, camera, startPose } = createScene(document.getElementById('app')!);
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
  if (key === 'camera.mobileStartScale') cameraControls.frame(startPose());
});

// The game opens on the closed flatpack: every part packed flat inside, settling at once
// and resting until the lid comes off and a hand disturbs it.
const flatpack = createFlatpack(physics);
scene.add(flatpack.base.mesh, flatpack.lid.mesh);

// One record per physical part — what gestures pick, drag and snap. The box and its lid
// are ones too.
const parts = [flatpack.base, flatpack.lid];
for (const { id, type, position, rotation } of createPackedWorldLayout()) {
  const part = PART_TYPES[type];
  const mesh = createPartMesh(part);
  const body = physics.register(mesh, {
    // map keeps the length; TS widens a mapped tuple to number[].
    halfExtents: part.size.map((d) => d / 2) as Vec3,
    // Every packed part is the pack's, with its mass.
    mass: part.mass!,
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
const assembly = createAssembly((id) => typeById.get(id)!);
// The display shelf goes in fastened, through the graph's own events.
display.fasten(assembly);
// Manipulation goes through these seams: a fastened compound moves as one, and while a
// finger is on the elevation line its part is held in mid-air at the line's height.
const hold = createLiftHold(createCompoundPhysics(physics, parts, assembly));
const manipulation = hold;

// Rotation is free by default; the toggle turns 90° detents on.
const snapRotate = createToggleButton({ label: 'Snap rotate' });
document.body.append(snapRotate.element);

const gizmo = createGizmo({
  camera,
  domElement: renderer.domElement,
  physics: manipulation,
  isFree: () => !snapRotate.pressed,
});
scene.add(gizmo.object);

// The booklet: pages drawn from the same models, flipped freely — reference, never a gate.
// The game opens with it in hand, on its cover; while it is open, a tap outside the sheet
// puts it down and does nothing else.
const bookletPages = createBookletPages(renderer);
const booklet = createBookletSheet({ pages: bookletPages });
document.body.append(booklet.scrim, booklet.thumb, booklet.element);
// The real sheet now covers index.html's stand-in; it goes in the frame that first paints it.
requestAnimationFrame(() => document.getElementById('pre-splash')?.remove());

// While the booklet is open, the open page's parts glow — the player's own set only, never
// the display shelf or the box and its lid.
const playerParts = parts.filter((part) => !display.parts.includes(part) && part !== flatpack.base && part !== flatpack.lid);
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

// The box drags but never takes the gizmo: tapping it is tapping the room. While the line
// holds a part, taps never change the selection.
function select(part: Part | null) {
  if (hold.held) return;
  if (!part || part === flatpack.base) {
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
  hold,
});
// The display shelf's physics joints, made by the same reconcile every tap and turn runs.
router.sync();

// Where the box sits now, as the level, in-room box frame the layout hangs off.
function boxPose() {
  const { x, y, z } = flatpack.base.body.translation();
  const r = flatpack.base.body.rotation();
  return boxPoseOf({ position: [x, y, z], rotation: [r.x, r.y, r.z, r.w] });
}

// Repack: the player's parts come apart by the normal teardown and go back into the box
// as packed, lid on — wherever the box has been dragged to, stood upright there first if
// it was left tilted. The display shelf is never touched.
function repack() {
  hold.end();
  events.emit(resetEvent());
  router.unseatAll(playerParts.map((part) => part.id));
  select(null);
  const box = boxPose();
  const upright = baseRest(box);
  physics.place(flatpack.base.body, upright.position, upright.rotation);
  const packedPose = new Map<PartId, Pose>([[flatpack.lid.id, lidRest(box)], ...createPackedWorldLayout(box).map((p): [PartId, Pose] => [p.id, p])]);
  for (const { id, body } of [...playerParts, flatpack.lid]) {
    const { position, rotation } = packedPose.get(id)!;
    physics.place(body, position, rotation);
  }
}
document.body.append(createResetButton({ onReset: repack }).element);

// The elevation line's part: the one being moved (never cranked or pulled, nor a compound,
// whose range is not one part's), else the selected one — never the box, nor a part
// sitting in a seat.
function liftablePart() {
  if (hold.held) return hold.held;
  const dragging = router.dragging;
  const part = dragging ? (dragging.mode === 'move' ? dragging.part : null) : gizmo.selected;
  if (!part || part === flatpack.base) return null;
  return dragging || assembly.jointsOf(part.id).length === 0 ? part : null;
}

const rangeOf = (part: Part) => liftRangeOf(part, part.mesh.quaternion.toArray());
const heightOf = (part: Part) => (hold.held === part ? hold.height : part.mesh.position.y);

// A finger on the line holds the part: a press on the line eases it toward the finger, one
// on the knob drags it 1:1 from where it is. Letting go hands it back to gravity — unless
// Shift still keeps it up.
let knobOffset: number | null = null;
function liftTo(fraction: number) {
  const part = hold.held;
  if (!part) return;
  if (knobOffset === null) hold.target(heightAt(fraction, rangeOf(part)));
  else hold.jump(heightAt(fraction + knobOffset, rangeOf(part)));
}
const liftLine = createLiftLine({
  onPress(fraction, onKnob) {
    const part = liftablePart();
    if (!part) return;
    hold.begin(part, 'line');
    knobOffset = onKnob ? fractionOf(heightOf(part), rangeOf(part)) - fraction : null;
    liftTo(fraction);
  },
  onMove: liftTo,
  onRelease: () => hold.end('line'),
});
document.body.append(liftLine.element);

// Shift is the desktop's finger on the line: while it is down, the part the line would lift
// stays where it is — the pointer free to turn it, drag it (a Shift-drag still lifts) or
// orbit — and letting go drops it. Window-level, so it counts wherever focus sits.
let shiftDown = false;
function onShift(event: KeyboardEvent) {
  if (event.key !== 'Shift') return;
  shiftDown = event.type === 'keydown';
  if (!shiftDown) hold.end('key');
}
window.addEventListener('keydown', onShift);
window.addEventListener('keyup', onShift);

// Per frame, so a part picked up or selected with Shift already down is held from then on.
function keepShiftHold() {
  const part = shiftDown && liftablePart();
  if (part) hold.begin(part, 'key');
}

function showLiftLine() {
  const part = liftablePart();
  if (part) liftLine.show(fractionOf(heightOf(part), rangeOf(part)));
  else liftLine.hide();
}

// The hold ends with the finger and Shift, and also when its part seats, on a repack, and
// whenever the app is backgrounded or loses focus — a Shift let go meanwhile never arrives.
function dropHold() {
  shiftDown = false;
  hold.end();
}
events.on(EVENT.SEAT, ({ hardware, host }) => {
  if (hold.held && (hardware === hold.held.id || host === hold.held.id)) hold.end();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') dropHold();
});
window.addEventListener('blur', dropHold);

// Recovery: a loose player part that has left the room (through a slab, off a wall) is set
// down again beside the box. Bonded parts go back only with a repack. The box itself goes
// back to where it last sat in the room — floor it held a moment ago, not the boot spot
// the player may have built on since.
let sweepIn = RESET.sweepInterval;
let lastBox = boxPlacement();
function sweep(delta: number) {
  sweepIn -= delta;
  if (sweepIn > 0) return;
  sweepIn = RESET.sweepInterval;
  const escaped = [...playerParts, flatpack.lid, flatpack.base].filter(({ id, body }) => {
    const { x, y, z } = body.translation();
    return hasEscaped([x, y, z], ROOM, RESET.escapeMargin) && assembly.compoundOf(id).size === 1;
  });
  if (!escaped.includes(flatpack.base)) lastBox = boxPose();
  if (escaped.length === 0) return;
  events.emit(recoveryEvent(escaped.map(({ id }) => id)));
  // The box goes back first, so the rest are set down beside it there.
  if (escaped.includes(flatpack.base)) {
    const back = baseRest(lastBox);
    physics.place(flatpack.base.body, back.position, back.rotation);
  }
  const loose = escaped.filter((part) => part !== flatpack.base);
  const spots = respawnSpots(loose.map((part) => part.type), boxPose());
  loose.forEach(({ body }, i) => physics.place(body, spots[i].position, spots[i].rotation));
}

// Android haptics, off the event stream: a tick on a seat, a double tick on a cam lock.
// navigator.vibrate is absent on iOS; a 0 ms knob turns one off.
const vibrate = (pattern: number | number[]) => navigator.vibrate?.(pattern);
events.on(EVENT.SEAT, () => {
  if (HAPTICS.seatMs > 0) vibrate(HAPTICS.seatMs);
});
events.on(EVENT.FASTEN, ({ kind }) => {
  if (kind === KIND.CAM && HAPTICS.lockMs > 0) vibrate([HAPTICS.lockMs, HAPTICS.lockGapMs, HAPTICS.lockMs]);
});

// Under sustained load the room renders every other frame; everything else runs every frame.
const fps = createFpsGuard();

createLoop((delta, rawDelta) => {
  cameraControls.update(delta);
  keepShiftHold();
  hold.update(delta);
  showLiftLine();
  physics.step(delta);
  sweep(delta);
  router.update(delta);
  gizmo.update();
  sprue.update();
  highlight.update(delta);
  // Measured on the true delta: the clamped one would floor every slow device at 15 fps.
  const { render, sample } = fps.frame(rawDelta);
  if (sample) events.emit(fpsEvent(Math.round(sample.fps * 10) / 10, sample.skipping));
  if (render) renderer.render(scene, camera);
}).start();
// The rest of the booklet draws in idle time, after the room is on screen.
bookletPages.prerender();

// Dev server only: the dev stream — events out, knob sets and screenshots in. The guard is
// compile-time, so a build drops the import and src/dev with it.
if (import.meta.env.DEV) {
  import('./dev/wsClient.js').then(({ connectDevStream }) =>
    connectDevStream({
      events,
      tunables,
      screenshot: () => {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      },
    }),
  );
}

// ?tune: the tuning drawer, on any build. Loaded only then — the plain URL never fetches it.
if (new URLSearchParams(location.search).has(TUNE.queryFlag)) {
  const { createTunePanel } = await import('./ui/tunePanel.js');
  const panel = createTunePanel({ tunables, exportSession: session.toExportJson });
  document.body.append(panel.tab, panel.element);
}
