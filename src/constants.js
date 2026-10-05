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

// The product and the company on the box and the booklet. A parody of flatpack furniture
// in general — never any real maker's name, marks or document numbers.
export const BRAND = {
  product: 'JOHNNY',
  maker: 'SKRUV',
  // Printed on the booklet's back cover, where a real manual carries its document code.
  documentCode: 'SK-0000451-1',
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
  partFitting: 0x5d5853,
  cardboard: 0xb48a5a,
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
  // Booklet pages (src/scene/bookletPages.js): black line art on white paper, earlier
  // steps' parts in a pale grey.
  bookletPaper: 0xffffff,
  bookletInk: 0x1c1c1c,
  bookletFaint: 0xbdbdbd,
};

// Booklet pages (src/scene/bookletPages.js), in page-canvas pixels: a portrait sheet drawn
// at twice the size it shows on a phone, so lines and numerals stay crisp.
export const BOOKLET = {
  pageSize: [720, 1000],
  margin: 44,
  // Line weights of the outline renders: this page's parts, and earlier ones.
  boldLine: 3.2,
  faintLine: 1.6,
  // Isometric-ish view the outline renders are drawn from (towards the origin).
  viewDirection: [1.1, 0.9, 1.5],
  // Space left round the drawing inside its frame, as a fraction.
  framePadding: 0.08,
  // Room between loose panels fanned out on a loose-parts page, in metres of the drawing.
  fanGap: 0.12,
  numeralSize: 150,
  bubbleRadius: 64,
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
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

// Orbit limits (src/scene/cameraLimits.js, applied by src/scene/cameraControls.js). The
// orbit target roams the whole floor so the camera can get right up to any part; the
// camera is clamped inside the walls and above the floor every frame, and may rise over
// the wall tops when zoomed out (dollhouse view).
export const CAMERA_LIMITS = {
  // The target stays this far inside the walls, between these heights: down to the parts
  // lying on the floor, up to just over the standing bookcase.
  targetMargin: 0.6,
  targetHeight: [0, 2.2],
  wallMargin: 0.4,
  // The camera never dips nearer the floor than this.
  floorClearance: 0.05,
  // Close enough that a dowel and the hole it goes in fill much of a phone screen.
  minDistance: 0.15,
  // Far enough to take in the whole room from over the walls.
  maxDistance: 6,
  // Panning slows with zoom; closer than panReference (m) it is sped back up, by at most
  // maxPanBoost, so moving around a close-up doesn't crawl.
  panReference: 1.2,
  maxPanBoost: 5,
  // Stops short of straight down: the build is always seen at an angle, never as a plan.
  minPolarAngle: (40 * Math.PI) / 180,
  maxPolarAngle: (80 * Math.PI) / 180,
  dampingFactor: 0.1,
};

// The flatpack the game opens on (src/game/packedLayout.js, src/scene/flatpack.js): a
// thin-walled cardboard box lying on the floor, its lid closed on top. Box-local frame:
// length along z, origin on the floor at its centre.
export const BOX = {
  // Inside, [across, height, length]: the 2 m panels lie along it, the hardboard back
  // only just fits across.
  inner: [0.84, 0.07, 2.08],
  // Cardboard walls and bottom, as physics slabs this thick (thin enough to read as
  // cardboard, thick enough that a sliding panel can't tunnel through).
  wall: 0.01,
  floor: 0.01,
  lidThickness: 0.008,
  // On the floor in front of the start view, turned so its length runs across it.
  position: [0, 0, 0.6],
  yaw: Math.PI / 2,
};

// The display JOHNNY (src/scene/displayShelf.js): a second, already-built shelf standing
// against the back wall, left of the start view — the exhibit, and a disassembly
// playground. `position`/`yaw` place the assembled layout's frame (floor under the carcass
// centre, front +z); its back panel's rear face is ~0.143 m behind that centre.
export const DISPLAY = {
  position: [-1.6, 0, -ROOM.depth / 2 + 0.165],
  yaw: 0,
  // Its parts' ids: the manifest's, prefixed, so they never collide with the player's set.
  idPrefix: 'display/',
};

// Packing inside the box (src/game/packedLayout.js).
export const PACK = {
  // Between neighbouring panels in a layer, and between a panel and the wall.
  gap: 0.01,
  // Loose hardware lies this far apart on top — a fingertip between pieces.
  hardwareGap: 0.045,
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
    backFittingHole: 0.0045,
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
  // A dowel, pin or back fitting comes back out when dragged this far (CSS px) along its axis.
  pullDistance: 40,
  // Wrench crank from a seated cam bolt to a screwed one: two full turns.
  screwRadians: 4 * Math.PI,
  // Screwdriver turn from an open cam lock to a locked one.
  quarterTurn: Math.PI / 2,
  // A cam catches any screwed bolt head this close to its recess (Design: instance-agnostic).
  captureRadius: 0.015,
  // How deep each fastener sits in its hole once fully home, along its axis.
  sinkDepth: { dowel: 0.015, pin: 0.008, fitting: 0.012, bolt: 0.011, cam: 0.012 },
  // Crank motion this close (CSS px) to the fastener's on-screen centre is ignored — the
  // angle swings wildly there.
  crankDeadzone: 12,
  // Dowel-stage connections: rigid in translation, this much angular play, and damped so
  // the carcass slumps to the limit and stays (no spring, no bounce). Cam-locked = rigid.
  angularPlayDegrees: 4,
  // Torque per rad/s resisting the slump (N·m·s/rad), so it reads as a sag, not a drop.
  playDamping: 1000,
};

