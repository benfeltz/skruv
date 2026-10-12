import { RENDER, TUNE } from './constants.js';
import { ANY, createBus, fpsEvent, sessionEvent, tuneEvent } from './game/events.js';
import { createHaptics, cueFor, patternFor } from './game/haptics.js';
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
// starts — the item world's parts, never the overlays (src/scene/itemWorld.ts).
const cameraControls = createCameraControls(camera, renderer.domElement, { pickDistance: (origin, direction) => world.pickDistance(origin, direction) });

// Rotation is free by default; the toggle turns 90° detents on.
const snapRotate = createToggleButton({ label: 'Snap rotate' });
document.body.append(snapRotate.element);

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

// The item in the room — its flatpack, display, booklet and everything that works them
// (src/scene/itemWorld.ts). The game opens with its booklet in hand, on its cover.
const world = createItemWorld({
  scene,
  camera,
  domElement: renderer.domElement,
  physics,
  cameraControls,
  events,
  haptics,
  isFree: () => !snapRotate.pressed,
  // Its controls page shows the device in hand: a coarse pointer is a touch screen.
  pages: () => createBookletPages(renderer, { scheme: matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop' }),
});
// The real sheet now covers index.html's stand-in; it goes in the frame that first paints it.
requestAnimationFrame(() => document.getElementById('pre-splash')?.remove());

document.body.append(createResetButton({ onReset: () => world.repack() }).element);

// Under sustained load the room renders every other frame; everything else runs every frame.
const fps = createFpsGuard();

createLoop((delta, rawDelta) => {
  cameraControls.update(delta);
  world.update(delta);
  // Measured on the true delta: the clamped one would floor every slow device at 15 fps.
  const { render, sample } = fps.frame(rawDelta);
  if (sample) events.emit(fpsEvent(Math.round(sample.fps * 10) / 10, sample.skipping));
  if (render) renderer.render(scene, camera);
}).start();

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
