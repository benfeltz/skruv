import { CATALOG, LAYER, RENDER, SAVE, SHELL, STAGE, TUNE } from './constants.js';
import { catalogEntries, createCatalog } from './game/catalogModel.js';
import { pickableSet } from './game/pickable.js';
import { ANY, clearEvent, createBus, EVENT, fpsEvent, sessionEvent, tuneEvent } from './game/events.js';
import { createHaptics, cueFor, patternFor } from './game/haptics.js';
import { packedBox } from './game/boxLayout.js';
import { ITEM_ID, ITEM_IDS, itemById, setItem } from './game/item.js';
import { createItemSlot } from './game/itemSlot.js';
import { boxFootprintSize, framedAt, freeSpot, nearest } from './game/roomLayout.js';
import { planRestore } from './game/roomRestore.js';
import { ROOM_SAVE_FORMAT } from './game/roomSave.js';
import type { UnknownObject } from './game/roomSave.js';
import { createMemoryStore, createRoomSaver, createWebStore } from './game/roomStore.js';
import { createSessionBuffer } from './game/sessionBuffer.js';
import { createTunables, LIVE_KNOBS } from './game/tunables.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { clampPixelRatio } from './scene/clamp.js';
import { createFpsGuard } from './scene/fpsGuard.js';
import { createItemWorld } from './scene/itemWorld.js';
import type { ItemWorld } from './scene/itemWorld.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';
import { createStageLight } from './scene/stageLight.js';
import { createBookletPages } from './scene/bookletPages.js';
import { createCatalogPages } from './scene/catalogPages.js';
import { createCatalogSheet } from './ui/catalogSheet.js';
import { createControlCluster } from './ui/controlCluster.js';
import { createManualFan } from './ui/manualFan.js';
import { createMenuButton } from './ui/menuButton.js';
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
// The stage's light follows the sky's phase; without its group in the scene the room is dark.
const stageLight = createStageLight();
scene.add(stageLight.group);
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
// starts — any world's parts, never the overlays (src/scene/itemWorld.ts); the nearest hit over
// every world in the room. Before the first pick there are none, and it pivots about the floor.
const cameraControls = createCameraControls(camera, renderer.domElement, {
  pickDistance: (origin, direction) => nearest(items.all().map((w) => w.pickDistance(origin, direction))),
});

// Rotation is free by default; the toggle turns 90° detents on. It is mounted in the control
// menu below, after Repack.
const snapRotate = createToggleButton({ label: 'Snap rotate' });

// Haptics: every moment buzzes a named cue through the buzzer slot. The web's buzzer plays
// HAPTICS patterns through navigator.vibrate (absent on iOS Safari; a 0 ms knob is silent); a
// native shell plugs its own in with haptics.setBuzzer (src/shell/capacitorHaptics.ts).
const haptics = createHaptics({
  buzzer: (cue) => {
    const pattern = patternFor(cue);
    if (pattern !== null) navigator.vibrate?.(pattern);
  },
});
// Inside the Capacitor shell the web buzzer is silent (no navigator.vibrate on iOS): the
// shell's buzzer takes the slot. Loaded only there — the web never fetches the plugin.
if (location.protocol === SHELL.protocol) {
  import('./shell/capacitorHaptics.js').then(({ connectNativeHaptics }) => connectNativeHaptics(haptics));
}
events.on(ANY, (event) => {
  const cue = cueFor(event);
  if (cue) haptics.cue(cue);
});

// A page turn is a rest point like any other; the debounce absorbs the peeks. A world's turns are
// subscribed once, where it is built (its dispose drops them) — never again on a re-activation. A
// restore turns pages to the saved ones but is not a rest point: the save has nothing new to write.
let restoring = true;
const adopt = (world: ItemWorld) => world.booklet.onChange(() => restoring || saver.changed());

// The worlds in the room — each one item's flatpack, booklet and everything that works them
// (src/scene/itemWorld.ts) — none until the first pick. A pick adds a world beside the ones in
// the room, or makes the one already there active again (src/game/itemSlot.ts): the active
// world is deactivated while the door still names it, the door turned, the new world built on
// the room's first free spot and the camera framed onto it. A build that throws turns the door
// back and leaves the room as it was, the catalog still in hand. The door names the active
// world's item; a kept world runs nothing until picked again.
const items = createItemSlot({
  // The door is item.ts itself: ITEM_ID is a live binding, read at each pick.
  door: { knows: (id) => ITEM_IDS.includes(id), selected: () => ITEM_ID, select: setItem },
  // A world's teardown that throws is its bug, not the clear's: logged, and the rest are still torn down.
  report: (error) => console.error(error),
  build: () => {
    const at = freeSpot(items.all().map((w) => w.footprint()), boxFootprintSize(packedBox()));
    const world = createItemWorld({
      scene,
      camera,
      domElement: renderer.domElement,
      physics,
      cameraControls,
      events,
      haptics,
      isFree: () => !snapRotate.pressed,
      ink: room.ink,
      at,
      // Its controls page shows the device in hand: a coarse pointer is a touch screen.
      pages: () => createBookletPages(renderer, { scheme: matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop' }),
    });
    adopt(world);
    cameraControls.frame(framedAt(at, startPose()));
    return world;
  },
});

// The room's save (src/game/roomSave.ts): written after every rest point — a release, a seat or unseat, a
// fasten or unfasten, a repack, a recovery, a page turn, a pick — and at once when the page goes to
// the background. The restore below reads it back once at boot. localStorage can throw (a sandboxed
// frame): the save then lives in memory for the session.
const store = (() => {
  try {
    return createWebStore(localStorage, SAVE.key);
  } catch (error) {
    console.warn('room save: no localStorage, keeping it in memory', error);
    return createMemoryStore();
  }
})();
// Objects of a kind this build does not know, handed back by the restore: every save carries them on.
let carried: UnknownObject[] = [];
const saver = createRoomSaver({
  store,
  now: () => new Date().toISOString(),
  schedule: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
  snapshot: () => {
    const objects = [...items.all().map((world) => world.snapshot()), ...carried];
    return objects.length ? { format: ROOM_SAVE_FORMAT, savedAt: '', world: { sky: { phase: STAGE.sky.phase }, camera: cameraControls.pose() }, objects } : null;
  },
});
for (const type of [EVENT.RELEASE, EVENT.SEAT, EVENT.UNSEAT, EVENT.FASTEN, EVENT.UNFASTEN, EVENT.RESET, EVENT.RECOVERY]) events.on(type, saver.changed);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saver.flush();
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
  onPick: (id) => pickItem(id),
});
document.body.append(catalog.scrim, catalog.thumb, catalog.element);
catalogPages.prerender();

// The manuals are the switcher (1.9.9.3, option B): every world's manual in the pocket at the band's
// end, spread out of it as a row of covers on a tap. A tap on a cover is a pick like the catalog's;
// the pocket never touches a kept world, it draws the cover the world handed out. A hold on the open
// cover clears the open item (1.9.9.6), its parts dimmed while the hold runs — the open world's only.
const fan = createManualFan({ worlds: () => items.all(),
  nameOf: (id) => itemById(id).identity.product,
  onPick: (id) => pickItem(id),
  onClear: (id) => clearItem(id),
  onHold: (id, on) => {
    if (items.current?.id === id) items.current.dim(on);
  },
});
document.body.append(fan.element);
// An opening catalog never leaves the row spread under its scrim.
catalog.onChange(({ expanded }) => {
  if (expanded) fan.fold();
});

// One pick for the catalog and the fan: the slot's, then the catalog put down.
function pickItem(id: string) {
  const world = items.pick(id);
  catalog.setOpen(false);
  // Focus goes to the item's manual — its strip's centre page — not back to the catalog thumb.
  world.booklet.focus();
  saver.changed();
  fan.refresh();
}

// One clear, for the pocket's hold: the open world out of the room, the previous kept one in hand on its
// page (the slot's drop), its record out of the save. The saver writes nothing for an empty room by
// design (a refused save survives until a pick writes over it), so a room with nothing left to save
// clears the store here, or the cleared item would come back on reload; the catalog is then the
// splash, as at boot, and cannot be put down.
function clearItem(id: string) {
  // The pocket only offers the open item; this guards a stale callback.
  if (items.current?.id !== id) return;
  const next = items.drop();
  events.emit(clearEvent(id));
  fan.refresh();
  next?.booklet.focus();
  // Objects of a kind this build does not know still make a save worth writing.
  if (next || carried.length) saver.changed();
  else store.clear();
  if (!next) catalog.setOpen(true);
}

// The restore (src/game/roomRestore.ts): the saved room put back before the first frame, or the empty
// room as ever. A save this build cannot restore is refused whole, before anything is built; the room
// starts empty, the catalog says so, and the stored text stays until the next pick writes over it.
const restored = planRestore(store.read(), { item: (id) => (ITEM_IDS.includes(id) ? itemById(id) : null) });
if (restored.kind === 'none') console.info('room: no save, starting empty');
else if (restored.kind === 'refused') {
  console.warn('room: save not restored, starting empty', restored.error);
  catalog.notify(CATALOG.words.restoreFailed);
} else {
  try {
    const { plan } = restored;
    carried = plan.others;
    if (plan.dropped.length) console.warn(`room: ${plan.dropped.length} duplicate item record(s) dropped: ${plan.dropped.map((r) => r.id).join(', ')}`);
    // In the save's order, so the last record is the active world.
    for (const record of plan.items) items.pick(record.id).restore(record);
    cameraControls.frame(plan.world.camera);
    room.setPhase(plan.world.sky.phase);
    catalog.setOpen(false);
    fan.refresh();
  } catch (error) {
    items.clear();
    carried = [];
    fan.refresh();
    console.warn('room: save not restored, starting empty', error);
    catalog.notify(CATALOG.words.restoreFailed);
  }
}
restoring = false;
// The real sheet now covers index.html's stand-in; it goes in the frame that first paints it.
requestAnimationFrame(() => document.getElementById('pre-splash')?.remove());

// The upper-right row: the menu in the corner holding Repack and Snap rotate, the ?tune
// gear (added after it) to its left.
const cluster = createControlCluster();
const menu = createMenuButton({ name: 'Menu' });
const repack = createResetButton({
  onReset: () => {
    items.current?.repack();
    menu.close();
  },
});
// Closing the menu drops a Repack hold in progress.
menu.add(repack.element, { onClose: repack.cancel });
menu.add(snapRotate.element);
cluster.add(menu.element);
document.body.append(cluster.element);
// The row reaches to the cluster, which is on screen now to be measured.
fan.refresh();

// Under sustained load the room renders every other frame; everything else runs every frame.
const fps = createFpsGuard();

createLoop((delta, rawDelta) => {
  cameraControls.update(delta);
  stageLight.update(room.update(camera.position, renderer, delta));
  items.current?.update(delta);
  // The kept worlds, after the physics step the active one ran: their riders follow, their drawn hardware is put back.
  for (const world of items.all()) if (world !== items.current) world.keep();
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
  // The gear widens the cluster: the row's reach shrinks.
  fan.refresh();
}
