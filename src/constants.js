// Every tunable lives here — modules import names, never literals.
// Units: metres, seconds, radians.

export const ROOM = {
  width: 10,
  depth: 10,
  // No ceiling. A real room's height — well clear of the 2.02 m bookcase standing — and
  // low enough that zooming out lifts the camera over the walls (dollhouse view), where
  // their inward faces vanish from outside.
  height: 3,
};

export const COLORS = {
  background: 0x1b1d22,
  floor: 0xc9b79c,
  wall: 0xe8e4dc,
  skyLight: 0xffffff,
  groundLight: 0x8a7a66,
  sunLight: 0xffffff,
  // Parts — keyed by the catalog's `color` field.
  partPanel: 0xf1eee6,
  partHardboard: 0x9c8466,
  partDowel: 0xd8b27a,
  partMetal: 0xa7adb3,
  partWrench: 0x2f3136,
  partScrewdriver: 0xd9a21b,
  // Rotate gizmo rings, one per world axis, x/y/z in the usual red/green/blue.
  gizmoX: 0xe5534b,
  gizmoY: 0x6cc04a,
  gizmoZ: 0x4a8fe5,
  // DOM overlays (src/ui).
  uiSurface: 0x2a2d34,
  uiText: 0xf1eee6,
  uiAccent: 0xe0a64a,
  // Snap preview (src/scene/ghost.js).
  ghost: 0xe0a64a,
  // Hole markings (src/game/decals.js) and the flash when a fastener seats in one.
  decal: 0x3a3029,
  decalFlash: 0xe0a64a,
  // Drop line under a dragged part, and the glow on the hole it would drop onto.
  dropGuide: 0xe0a64a,
  // Emissive off: what a decal glows when it isn't flashing.
  unlit: 0x000000,
  // Sprue handle on a selected small part (src/scene/sprue.js): model-kit plastic grey.
  sprue: 0x8f9a93,
};

export const LIGHTS = {
  hemisphereIntensity: 1.2,
  sunIntensity: 1.6,
  sunPosition: [-4, 7, 2],
  shadowMapSize: 1024,
  shadowExtent: 6,
  // Offsets shadow lookups along the normal so millimetre-thin parts don't self-shadow
  // into stripes (acne); small enough that contact shadows stay attached.
  shadowNormalBias: 0.02,
};

export const CAMERA = {
  fov: 50,
  // Close enough to zoom in on millimetre hardware without clipping it.
  near: 0.02,
  far: 100,
  startPosition: [2, 1.8, 2.4],
  startTarget: [0, 0.6, 0],
};

// Orbit limits. maxDistance is derived from these and ROOM by
// src/scene/cameraLimits.js so the camera stays wallMargin inside the walls horizontally;
// it may rise over their tops. The pivot and maxPolarAngle keep it above the floor.
export const CAMERA_LIMITS = {
  // Centre of the sphere the orbit target may be panned within.
  pivot: [0, 1, 0],
  maxTargetRadius: 0.8,
  wallMargin: 0.4,
  // Close enough to fill the screen with a dowel and the hole it goes in.
  minDistance: 0.3,
  // Stops short of straight down: the build is always seen at an angle, never as a plan.
  minPolarAngle: (40 * Math.PI) / 180,
  maxPolarAngle: (80 * Math.PI) / 180,
  dampingFactor: 0.1,
};

// Temporary floor layout for the full manifest (src/game/devLayout.js) until PR 5's unbox.
export const DEV_LAYOUT = {
  // Parts pack into rows no wider than this, centred on the room origin.
  rowWidth: 4,
  gap: 0.08,
  // Dropped from just above the floor so settling is visible without parts bouncing about.
  dropHeight: 0.05,
};

export const PHYSICS = {
  gravity: [0, -9.81, 0],
  // Fixed simulation step; the render loop banks frame time and runs whole steps.
  timestep: 1 / 60,
  // Pairs with RENDER.maxFrameDelta: a clamped 1/15 s frame needs exactly 4 steps.
  maxStepsPerFrame: 4,
  // Damping bleeds off residual jitter so resting parts reach Rapier's sleep threshold.
  linearDamping: 0.1,
  angularDamping: 0.3,
  // Wood on wood: grippy, and no bounce (the design clamps restitution).
  friction: 0.6,
  restitution: 0,
  // Room colliders are slabs this thick, laid just outside the visible surfaces.
  roomColliderThickness: 0.5,
};

export const RENDER = {
  // Above 2 the fill-rate cost on phones outweighs the visible sharpness gain.
  maxPixelRatio: 2,
  // A backgrounded tab resumes with a huge rAF gap; cap it so nothing jumps.
  maxFrameDelta: 1 / 15,
};

// Pointer gestures: who owns a touch (src/game/gestureState.js) and how a dragged part
// moves (src/game/dragMath.js). Distances in CSS pixels where noted, else metres.
export const GESTURE = {
  // A press that moves no further than this (CSS px) and lifts within tapMaxMs is a tap;
  // moving further starts a drag. Generous enough for a fingertip's wobble.
  tapMaxDistance: 10,
  tapMaxMs: 350,
  // A grabbed part rides this far above where it was picked up, so it clears neighbours.
  hoverLift: 0.03,
  // Dragged parts stay this far inside the walls.
  wallMargin: 0.05,
  // Rotate-gizmo detent — the default; the free-rotate toggle turns it off.
  detentStep: Math.PI / 2,
  // Lift channel (second finger on a phone): metres per CSS px of travel.
  liftRate: 0.004,
  // Desktop lift (Shift-held drag, or the wheel): gentler, since trackpad scrolls and mouse
  // sweeps run to hundreds of px where a phone's second finger travels tens.
  desktopLiftRate: 0.0025,
  // A lifted part's top stays this far below the walls' tops.
  ceilingMargin: 0.1,
};

// Rotate gizmo (src/scene/gizmo.js): rings sized from the selected part's bounding sphere.
export const GIZMO = {
  radiusPadding: 1.15,
  // Hardware is millimetres long; rings never shrink below a fingertip-sized target.
  minRadius: 0.08,
  // Tube thickness as a fraction of ring radius: drawn, and the fatter invisible hit band.
  tube: 0.025,
  hitTube: 0.12,
  opacity: 0.85,
};

// Drop guide (src/scene/dropGuide.js): a line from a dragged part straight down to where it
// would land, a ring there, and the hole marking under it lit when it is a free hole that
// takes the part.
export const DROP = {
  ringRadius: 0.012,
  ringWidth: 0.003,
  opacity: 0.7,
  // A landing spot this close to a hole's centre is "over the hole" (a dowel hole's
  // marking is 5 mm across, so a little slack beyond it).
  holeReach: 0.012,
  // Glow of a hole under the drop line, or the seat the ghost shows; the seat flash is 1.
  glowIntensity: 0.6,
};

// Fat-finger picking (src/game/pickMath.js, src/scene/gestureRouter.js). Hardware is
// millimetres across; an invisible proxy box never thinner than proxyMinSize surrounds each
// small part, and the preference rule decides when a press on it means the part.
export const PICK = {
  // A part whose longest side is under this is "small": every fastener and both tools,
  // never a panel (the narrowest is ~0.77 m long).
  smallPartMax: 0.25,
  proxyMinSize: 0.04,
  // The finger's angular radius from the camera (radians): ~20 CSS px on a phone.
  fingerRadius: 0.025,
};

// Sprue handle (src/scene/sprue.js) on a selected small part. The ball stands far enough
// above the part to clear its gizmo rings (the screwdriver's are the widest, ~0.12 m), so a
// press on it is never a ring's.
export const SPRUE = {
  length: 0.15,
  stickRadius: 0.003,
  ballRadius: 0.012,
  // The invisible hit sphere round the ball: a fingertip-sized target.
  hitRadius: 0.03,
};

// Connector snapping (src/game/snapMath.js). Generous first, per the Design doc: a snap
// that fires too eagerly is a nuisance, one that never fires reads as broken. Tighten
// from playtest feedback.
export const SNAP = {
  maxDistance: 0.08,
  maxAngle: (40 * Math.PI) / 180,
  // A seated pose may graze the floor or a wall by this much; any deeper and the snap is
  // refused (the part would be held kinematic inside a static collider).
  roomTolerance: 0.002,
  ghostOpacity: 0.45,
  // Seat assist: while a seat is on offer, the held part eases toward it this fast (1/s —
  // about 90% of the way in a quarter second). Zero pull whenever no seat is on offer.
  assistStrength: 9,
  // How long the hole's decal glows after a fastener seats in it.
  flashMs: 450,
};

// Hole markings (src/game/decals.js, drawn by src/game/partMesh.js). Radii are keyed by
// the catalog's socket connector type and sized a touch wider than what fills them, so a
// seated fastener still shows a rim.
export const DECAL = {
  radius: {
    dowelHole: 0.005,
    camBoltHole: 0.0045,
    shelfPinHole: 0.0035,
    nailHole: 0.0022,
    camLockRecess: 0.009,
  },
  // A recess is drawn as a ring: inner radius as a fraction of the outer.
  recessInner: 0.55,
  // Laid this far proud of the face, so it never z-fights the panel.
  surfaceOffset: 0.0004,
  segments: 24,
};

// Fasteners (src/game/fasteners.js, src/game/assembly.js) and the joints that follow them
// (src/physics/world.js). Distances in metres unless marked CSS px; angles in radians.
export const FASTENER = {
  // A dowel, pin or nail comes back out when dragged this far (CSS px) along its axis.
  pullDistance: 40,
  // Hammer taps from a seated nail to a driven one.
  tapsToDrive: 3,
  // Wrench crank from a seated cam bolt to a screwed one: two full turns.
  screwRadians: 4 * Math.PI,
  // Screwdriver turn from an open cam lock to a locked one.
  quarterTurn: Math.PI / 2,
  // A cam catches any screwed bolt head this close to its recess (Design: instance-agnostic).
  captureRadius: 0.015,
  // How deep each fastener sits in its hole once fully home, along its axis.
  sinkDepth: { dowel: 0.015, pin: 0.008, nail: 0.018, bolt: 0.011, cam: 0.012 },
  // Crank motion this close (CSS px) to the fastener's on-screen centre is ignored — the
  // angle swings wildly there.
  crankDeadzone: 12,
  // Dowel-stage connections: rigid in translation, this much angular play, and damped so
  // the carcass slumps to the limit and stays (no spring, no bounce). Cam-locked = rigid.
  angularPlayDegrees: 4,
  // Torque per rad/s resisting the slump (N·m·s/rad), so it reads as a sag, not a drop.
  playDamping: 1000,
};

