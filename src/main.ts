import { CATALOG, LAYER, RENDER, TUNE } from './constants.js';
import { catalogEntries, createCatalog } from './game/catalogModel.js';
import { pickableSet } from './game/pickable.js';
import { ANY, createBus, fpsEvent, sessionEvent, tuneEvent } from './game/events.js';
import { createHaptics, cueFor, patternFor } from './game/haptics.js';
import { ITEM_ID, ITEM_IDS, setItem } from './game/item.js';
import { createItemSlot } from './game/itemSlot.js';
import { createSessionBuffer } from './game/sessionBuffer.js';
import { createTunables, LIVE_KNOBS } from './game/tunables.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { clampPixelRatio } from './scene/clamp.js';
import { createFpsGuard } from './scene/fpsGuard.js';
import { createItemWorld } from './scene/itemWorld.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';
import { createBookletPages } from './scene/bookletPages.js';
import { createCatalogPages } from './scene/catalogPages.js';
import { createCatalogSheet } from './ui/catalogSheet.js';
import { createControlCluster } from './ui/controlCluster.js';
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
const room = createRoom();
scene.add(room.group);
// The room sits on its own layer, which the detail inset's camera leaves out (src/scene/inset.ts).
camera.layers.enable(LAYER.room);
// And the rotate gizmo's rings, which the inset leaves out as it leaves out every control.
camera.layers.enable(LAYER.gizmo);
// Shadows are drawn once a frame, by the main render (below), and the inset's pass reuses them.
renderer.shadowMap.autoUpdate = false;

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

// The camera pivots about the first part along the middle of the screen as a gesture
// starts — the item world's parts, never the overlays (src/scene/itemWorld.ts); before the
// first pick there are none, and it pivots about the floor.
const cameraControls = createCameraControls(camera, renderer.domElement, {
  pickDistance: (origin, direction) => items.current?.pickDistance(origin, direction) ?? null,
});

// Rotation is free by default; the toggle turns 90° detents on. It is mounted in the control
// cluster below, after Repack.
const snapRotate = createToggleButton({ label: 'Snap rotate' });

// Haptics: every moment buzzes a named cue through the buzzer slot. The web's buzzer plays
// HAPTICS patterns through navigator.vibrate (absent on iOS Safari; a 0 ms knob is silent); a
// native shell plugs its own in with haptics.setBuzzer.
const haptics = createHaptics({
  buzzer: (cue) => {
    const pattern = patternFor(cue);
    if (pattern !== null) navigator.vibrate?.(pattern);
  },
});
events.on(ANY, (event) => {
  const cue = cueFor(event);
  if (cue) haptics.cue(cue);
});

// The item in the room — its flatpack, booklet and everything that works them
// (src/scene/itemWorld.ts) — none until the first pick. A pick swaps it in-scene as one
// transaction (src/game/itemSlot.ts): the old world disposed while the door still names it,
// the door turned, the new world built; a build that throws turns the door back and leaves
// the room empty, the catalog still in hand. Picking the item already in the room keeps it,
// progress and all.
const items = createItemSlot({
  // The door is item.ts itself: ITEM_ID is a live binding, read at each pick.
  door: { knows: (id) => ITEM_IDS.includes(id), selected: () => ITEM_ID, select: setItem },
  // An old world's teardown that throws is its bug, not the pick's: logged, and the swap goes on.
  report: (error) => console.error(error),
  build: () =>
    createItemWorld({
      scene,
      camera,
      domElement: renderer.domElement,
      physics,
      cameraControls,
      events,
      haptics,
      isFree: () => !snapRotate.pressed,
      ink: room.ink,
      // Its controls page shows the device in hand: a coarse pointer is a touch screen.
      pages: () => createBookletPages(renderer, { scheme: matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop' }),
    }),
});

// The catalog is the splash: the game boots with it open on its cover, and it outlives
// item worlds, so it is the room's — mounted before any manual. BUILD IT goes straight into
// the room: the item is built, the catalog put down into the upper-left corner and the new
// manual docked as the strip along the bottom. Until the first pick there is no room to go
// back to, so nothing puts it down.
const catalogPages = createCatalogPages(renderer, createCatalog(catalogEntries(), pickableSet(CATALOG.pickable, ITEM_IDS)));
const catalog = createCatalogSheet({
  pages: catalogPages,
  open: true,
  canClose: () => items.current !== null,
  onPick: (id) => {
    const world = items.pick(id);
    catalog.setOpen(false);
    // Focus goes to the item's manual — its strip's centre page — not back to the catalog thumb.
    world.booklet.focus();
  },
});
document.body.append(catalog.scrim, catalog.thumb, catalog.element);
catalogPages.prerender();
// The real sheet now covers index.html's stand-in; it goes in the frame that first paints it.
requestAnimationFrame(() => document.getElementById('pre-splash')?.remove());

// The upper-right column: Repack in the corner, Snap rotate under it, the ?tune gear last.
const cluster = createControlCluster();
cluster.add(createResetButton({ onReset: () => items.current?.repack() }).element);
cluster.add(snapRotate.element);
document.body.append(cluster.element);

// Under sustained load the room renders every other frame; everything else runs every frame.
const fps = createFpsGuard();

createLoop((delta, rawDelta) => {
  cameraControls.update(delta);
  room.update(camera.position, renderer, delta);
  items.current?.update(delta);
  // Measured on the true delta: the clamped one would floor every slow device at 15 fps.
  const { render, sample } = fps.frame(rawDelta);
  if (sample) events.emit(fpsEvent(Math.round(sample.fps * 10) / 10, sample.skipping));
  if (render) {
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    // The detail inset's one extra pass, over the room just drawn.
    items.current?.render(renderer, scene);
  }
}).start();

// Dev server only: the dev stream — events out, knob sets and screenshots in. The guard is
// compile-time, so a build drops the import and src/dev with it.
if (import.meta.env.DEV) {
  import('./dev/wsClient.js').then(({ connectDevStream }) =>
    connectDevStream({
      events,
      tunables,
      screenshot: () => {
        renderer.shadowMap.needsUpdate = true;
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
  cluster.add(panel.tab);
  document.body.append(panel.element);
}
