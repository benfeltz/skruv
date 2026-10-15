// Every tunable lives here — modules import names, never literals.
// Units: metres, seconds, radians.

import { CONTRACT } from '../tools/validate/lib/vocabulary.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

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
  // Panel colourways an item's variants name (identity.variants[].color), shown on the catalog's swatches.
  partPanelBlackBrown: 0x3b2f2a,
  partPanelBlack: 0x232323,
  partPanelGray: 0x8d9094,
  partHardboard: 0x9c8466,
  partDowel: 0xd8b27a,
  partMetal: 0xa7adb3,
  partWrench: 0x2f3136,
  partScrewdriver: 0xd9a21b,
  partFitting: 0x5d5853,
  // Second tones on a shaped piece (src/game/partShapes.ts): bare metal (the screwdriver's
  // blade and shaft) reuses partMetal; a recess, like the slot across a cam lock, is dark.
  partRecess: 0x2b2826,
  cardboard: 0xb48a5a,
  // Rotate gizmo rings, one per world axis, x/y/z in the usual red/green/blue.
  gizmoX: 0xe5534b,
  gizmoY: 0x6cc04a,
  gizmoZ: 0x4a8fe5,
  // DOM overlays (src/ui).
  uiSurface: 0x2a2d34,
  uiText: 0xf1eee6,
  uiAccent: 0xe0a64a,
  // Snap preview (src/scene/ghost.ts).
  ghost: 0xe0a64a,
  // The ghost, and the glow on the hole it seats in, when a panel's fit on offer is where it
  // goes in the finished item (src/game/panelFit.ts); any other fit keeps `ghost`'s amber.
  whereItGoes: 0x6cc46a,
  // Hole markings (src/game/decals.ts) and the flash when a fastener seats in one.
  decal: 0x3a3029,
  decalFlash: 0xe0a64a,
  // Drop line under a dragged part, and the glow on the hole it would drop onto.
  dropGuide: 0xe0a64a,
  // Emissive off: what a decal glows when it isn't flashing.
  unlit: 0x000000,
  // Sprue handle on a selected small part (src/scene/sprue.ts): model-kit plastic grey.
  sprue: 0x8f9a93,
  // Booklet pages (src/scene/bookletPages.ts): black line art on white paper, earlier
  // steps' parts in a pale grey.
  bookletPaper: 0xffffff,
  bookletInk: 0x1c1c1c,
  bookletFaint: 0xbdbdbd,
  // Per-page highlight (src/scene/highlight.ts): the warm accent, glowing softly.
  highlight: 0xe0a64a,
  // Target rings on the fasteners a carried tool can work (src/scene/targetRings.ts).
  targetRing: 0xe0a64a,
};

// Per-page highlight (src/scene/highlight.ts): the parts the open booklet page is about
// glow up and down — an aid for matching page to room, never a gate.
export const HIGHLIGHT = {
  // Seconds per glow cycle, and the peak emissive intensity — subtle.
  period: 1.6,
  intensity: 0.35,
};

// Booklet pages (src/scene/bookletPages.ts), in page-canvas pixels: a portrait sheet drawn
// at twice the size it shows on a phone, so lines and numerals stay crisp.
export const BOOKLET = {
  pageSize: [720, 1000] satisfies [number, number],
  margin: 44,
  // Line weights of the outline renders: this page's parts, and earlier ones.
  boldLine: 3.2,
  faintLine: 1.6,
  // Isometric-ish view the outline renders are drawn from (towards the origin).
  viewDirection: [1.1, 0.9, 1.5] satisfies Vec3,
  // Space left round the drawing inside its frame, as a fraction.
  framePadding: 0.08,
  // Room between loose panels fanned out on a loose-parts page, in metres of the drawing.
  fanGap: 0.12,
  numeralSize: 150,
  bubbleRadius: 64,
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  // The controls page (src/game/controlsPage.ts): a title, then rows in columns — each a
  // square pictogram, drawn on a 100-unit grid at `pictogramLine`, and its label beside it,
  // wrapped onto as many lines as it needs.
  controls: {
    titleSize: 44,
    titleGap: 28,
    columns: 2,
    pictogram: 96,
    pictogramLine: 4,
    labelGap: 16,
    labelSize: 27,
    labelLeading: 1.2,
  },
};

// The booklet in hand (src/ui/booklet.ts): CSS pixels.
export const BOOKLET_UI = {
  // The collapsed thumbnail of the open page, bottom-left — small enough to leave the room
  // to the fingers.
  thumbWidth: 64,
  // A horizontal swipe this long flips a page; a downward one this long closes the sheet.
  swipeDistance: 48,
  // The open sheet never grows wider than this, nor taller than this share of the screen.
  maxWidth: 520,
  maxHeight: 0.92,
  // The sheet's own height round the page (handle, controls, gaps, padding; CSS pixels):
  // the page fits in maxHeight less this. index.html's pre-splash mirrors it.
  chromeHeight: 120,
  // A notice on the sheet (a pick that would not build): laid over the head of the page, so
  // it never adds to chromeHeight — its type size and line height, and its inset, padding
  // and corner radius (CSS pixels).
  notice: { size: 14, lineHeight: 1.3, inset: 8, padding: 8, radius: 8 },
  // After a tap on the room puts the booklet down, the scrim stays this long to catch the
  // click a touch synthesises after the lift.
  scrimLingerMs: 400,
  // A mouse over the docked thumbnail grows it to fit this share of the screen's width and
  // height (a quarter of the screen), big enough to read the page.
  thumbHoverShare: 0.5,
  // ...but only once the pointer has rested on it this long (ms): a pointer passing over a
  // thumb on its way elsewhere — the manual's, past the catalog's — never grows it.
  thumbHoverDelayMs: 400,
};

// The catalog (1.9.1): the game's front door, a second booklet of items to build
// (src/game/catalogModel.ts lays it out). Its items' names and part counts are their packs'.
export const CATALOG = {
  // Which items this build lets you build: a comma list of ids from the build-time flag
  // VITE_PICKABLE (`VITE_PICKABLE=johnny npm run build`), or every item when it is unset or
  // empty. Every build ships every pack; the rest show SOLD OUT. (vite.config.ts reads this
  // file in plain Node, where import.meta.env doesn't exist.)
  pickable: import.meta.env?.VITE_PICKABLE ?? '',
  // An item's printed size is its built extent in metres times this, rounded.
  cmPerMetre: 100,
  // Its pages (src/scene/catalogPages.ts), in page-canvas pixels on BOOKLET.pageSize paper.
  page: {
    wordmarkSize: 156,
    taglineSize: 30,
    detailSize: 30,
    // The cover's setting, as fractions of a type size: a title's baseline sits this far
    // down its size; the line under it (the tagline) this many of its own sizes below
    // that baseline; the drawing starts this many of them below the title's full size. The
    // line under is indented this far (page pixels) to sit optically flush under the title.
    baseline: 0.8,
    subtitleDrop: 1.6,
    drawingDrop: 2.4,
    taglineIndent: 6,
    // An item page's lines (src/game/catalogLayout.ts), top to bottom: the heavy rule's
    // weight; the category heading's size, and the gap between the rule and its cap line;
    // the thin rule's weight; the name line's size (name bold, category and size beside
    // it); a variant row's type size and its height as a multiple of that size; the thin
    // rule under each row. `lineGap` separates the blocks; the part count (detailSize) sits
    // `countGap` below the rows and `tagGap` above the tag.
    heavyRule: 8,
    headingSize: 40,
    headingGap: 12,
    // ...and the gap between the heading's descender and the thin rule under it.
    ruleGap: 6,
    thinRule: 2,
    nameLineSize: 34,
    rowSize: 26,
    rowHeight: 1.7,
    lineGap: 14,
    countGap: 34,
    tagGap: 34,
    // Type's cap-line and descender depth as fractions of its size, for stacking lines
    // without measuring them.
    capHeight: 0.75,
    descender: 0.25,
    // The swatches, one filled circle per variant right of the drawing's foot: radius, gap
    // between them, and the ink ring's weight.
    swatchRadius: 15,
    swatchGap: 12,
    swatchRing: 3,
    // The OWN IT NOW! tag, or the SOLD OUT stamp in its place: [x, y, w, h], also the hit
    // target src/ui/booklet.ts lays over the page, its foot on the page margin (pageSize
    // height 1000 less margin 44 less its own 104). The item page's lines stack up from it.
    action: [160, 852, 400, 104] satisfies [number, number, number, number],
    // The corner arrows, printed on the page and tapped through a clear button over each
    // (src/ui/booklet.ts): [x, y, w, h], level with the tag, in the lower corners — ‹ at the
    // left margin, › at the right — each 100 page pixels square (72 CSS px at the widest
    // page, over the 44 a thumb needs), and clear of the tag's columns by 16.
    prev: [44, 852, 100, 104] satisfies [number, number, number, number],
    next: [576, 852, 100, 104] satisfies [number, number, number, number],
    // An arrow drawn as a chevron at its rect's centre: this far up and down from it, this
    // far across, in this stroke weight (page pixels).
    arrowHalfHeight: 22,
    arrowHalfWidth: 13,
    arrowStroke: 7,
    // The page number, bottom centre, in the margin under the tag: its type size, and its
    // baseline this far up from the page's foot.
    pageNumberSize: 24,
    pageNumberFoot: 12,
    // Sized so OWN IT NOW! sits at its natural width between the hole and the tag's right
    // edge (src/game/catalogLayout.ts `tagWords`); the scene squeezes it only if a font runs wide.
    actionTextSize: 34,
    // The tag's corners and punched hole; the stamp's outline and tilt (radians).
    tagRadius: 18,
    // Clear space kept each side of the tag's words: from the hole's edge and from the tag's right edge.
    tagInset: 18,
    tagHole: 12,
    stampLine: 6,
    stampTurn: -0.08,
  },
  // The cover's wire-drawn room corner (metres): the items stand on its floor this far
  // apart and this far in from its walls, which rise this many times the tallest item.
  cover: {
    gap: 0.5,
    margin: 0.6,
    wallRise: 1.5,
    slab: 0.03,
  },
  // The corner stack (src/game/cornerStack.ts): the front booklet (the manual) fanned this far
  // right and up (CSS pixels) from the one behind it (the catalog), which stays in the corner
  // turned this much (radians) — far enough that the strip of catalog left showing, below and
  // left of the manual, is a thumb's target, and out of the path from the room to the
  // manual. ?tune knobs.
  stack: {
    fanX: 10,
    fanY: 44,
    fanTurn: -0.12,
  },
  words: {
    brand: 'SKRUV',
    tagline: 'Catalog',
    parts: 'parts',
    cm: 'cm',
    build: 'OWN IT NOW!',
    soldOut: 'SOLD OUT',
    // On the sheet when the tag's item could not be built (src/ui/catalogSheet.ts).
    buildFailed: "That one couldn't be built. Try again, or pick another.",
    // The corner arrows' accessible names (the buttons laid over the printed chevrons).
    prev: 'Previous page',
    next: 'Next page',
  },
};

export const LIGHTS = {
  hemisphereIntensity: 1.2,
  sunIntensity: 1.6,
  sunPosition: [-4, 7, 2] satisfies Vec3,
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
  startPosition: [2, 1.8, 2.4] satisfies Vec3,
  startTarget: [0, 0.6, 0] satisfies Vec3,
  // A phone (coarse pointer) starts this many times further from startTarget along the
  // same view, so a cold load frames the room without pinching out first. Dialed on
  // device through ?tune (camera.mobileStartScale) before freezing.
  mobileStartScale: 1.4,
  // Where a camera gesture pivots (src/scene/cameraControls.ts): 1, the first part (or the
  // box) along the line through the middle of the screen, else the floor, held for the
  // whole gesture; 0, today's floor pivot, re-seated every update. A 0/1 switch because
  // ?tune knobs hold numbers. Temporary: the losing mode goes once Ben picks on the phone.
  pivotOnParts: 1,
};

// Orbit limits (src/scene/cameraLimits.ts, applied by src/scene/cameraControls.ts). The
// orbit target roams the whole floor so the camera can get right up to any part; as a
// gesture starts it moves along the view to the first part in the middle of the screen,
// else the floor (CAMERA.pivotOnParts), and holds there. The camera is clamped inside the
// walls and above the floor every frame, and may rise over the wall tops when zoomed out
// (dollhouse view).
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

// Where the flatpack the game opens on stands (src/game/boxLayout.ts, src/scene/flatpack.ts):
// a thin-walled cardboard box lying on the floor, its lid closed on top. Its inside, walls
// and lid are the item's (items/johnny `packing`). Box-local frame: length along z,
// origin on the floor at its centre.
export const BOX = {
  // On the floor in front of the start view, turned so its length runs across it.
  position: [0, 0, 0.6] satisfies Vec3,
  yaw: Math.PI / 2,
  // The box is a part the player can drag: heavy and grippy, so a panel slid out over a
  // wall scrapes past it rather than skating it across the floor (kg; Rapier friction).
  mass: 25,
  friction: 1,
};

// Repack and recovery (src/ui/resetButton.ts, src/main.ts).
export const RESET = {
  // The repack button arms on a first tap and repacks only on a second within this many
  // ms — cheap insurance against a fat finger wiping a build.
  confirmMs: 2500,
  // Every this many seconds, any loose player part found outside the room (by more than
  // `escapeMargin` m) is set down again beside the box.
  sweepInterval: 2,
  escapeMargin: 0.05,
  // Where: laid flat in a patch starting this far out from the box's long side and this
  // deep, running the box's length, a gap between pieces; each dropped from this clearance
  // above the floor. Pieces that don't fit go in again `layerHeight` higher, to land on top.
  respawn: { offset: 0.35, depth: 2.5, gap: 0.05, height: 0.25, layerHeight: 0.1 },
};

export const PHYSICS = {
  gravity: [0, -9.81, 0] satisfies Vec3,
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
  // No body simulates lighter than this (kg); the catalog keeps the true masses. Impulse
  // joints go soft at big mass ratios: a 1 g shelf pin fixed in a side spins loose under a
  // 2 kg shelf resting on it, and the shelf drops through.
  minBodyMass: 0.2,
  // Room colliders are slabs this thick, laid just outside the visible surfaces.
  roomColliderThickness: 0.5,
};

export const RENDER = {
  // Above 2 the fill-rate cost on phones outweighs the visible sharpness gain.
  maxPixelRatio: 2,
  // A backgrounded tab resumes with a huge rAF gap; cap it so nothing jumps.
  maxFrameDelta: 1 / 15,
};

// Pointer gestures: who owns a touch (src/game/gestureState.ts) and how a dragged part
// moves (src/game/dragMath.ts). Distances in CSS pixels where noted, else metres.
export const GESTURE = {
  // A press that moves no further than this (CSS px) and lifts within tapMaxMs is a tap;
  // moving further starts a drag. Generous enough for a fingertip's wobble.
  tapMaxDistance: 10,
  tapMaxMs: 350,
  // A grabbed part rides this far above where it was picked up, so it clears neighbours.
  hoverLift: 0.03,
  // Dragged parts stay this far inside the walls.
  wallMargin: 0.05,
  // Rotate-gizmo detent — behind the snap-rotate toggle; rotation is free by default.
  detentStep: Math.PI / 2,
  // Lift channel (second finger on a phone): metres per CSS px of travel.
  liftRate: 0.004,
  // Desktop lift (the wheel mid-drag, or Shift + scroll): gentler, since trackpad scrolls and mouse
  // sweeps run to hundreds of px where a phone's second finger travels tens.
  desktopLiftRate: 0.0025,
  // A lifted part's top stays this far below the walls' tops.
  ceilingMargin: 0.1,
};

// Elevation line (src/ui/liftLine.ts, src/game/liftLine.ts, src/scene/liftHold.ts): a
// vertical line with a knob for the held part's height, floor at the bottom to the lift
// ceiling at the top. A finger on it holds the part in mid-air; touching the line eases the
// part there, the knob drags it 1:1. Read at use time, so the ?tune knobs act live.
export const LIFT_LINE = {
  // Across the screen as a fraction of its width, 0 = left edge.
  x: 0.08,
  // Top and bottom of the line as fractions of the screen's height, top down.
  top: 0.22,
  bottom: 0.78,
  // Knob radius, the drawn line's width and the line's touch band, CSS px — a fingertip.
  knobRadius: 22,
  lineWidth: 4,
  hitWidth: 48,
  // How fast the part eases toward a touched height, 1/s (exponential, like seat assist).
  easeRate: 8,
};

// Rotate gizmo (src/scene/gizmo.ts): rings sized from the selected part's bounding sphere.
export const GIZMO = {
  radiusPadding: 1.15,
  // Hardware is millimetres long; rings never shrink below a fingertip-sized target.
  minRadius: 0.08,
  // Tube thickness as a fraction of ring radius: drawn, and the fatter invisible hit band.
  tube: 0.025,
  hitTube: 0.12,
  opacity: 0.85,
  // Direction arrowheads: a pair of cones on each ring, on opposite sides, pointing the way
  // a counter-clockwise screen sweep turns the part. Fractions of ring radius; the angle
  // is where the first cone sits around its ring, from the ring's local +X.
  arrowLength: 0.14,
  arrowRadius: 0.05,
  arrowAngle: Math.PI / 4,
};

// Drop guide (src/scene/dropGuide.ts): a line from a dragged part straight down to where it
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

// Fat-finger picking (src/game/pickMath.ts, src/scene/gestureRouter.ts). Hardware is
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

// Sprue handle (src/scene/sprue.ts) on a selected small part. The ball stands far enough
// above the part to clear its gizmo rings (the screwdriver's are the widest, ~0.12 m), so a
// press on it is never a ring's.
export const SPRUE = {
  length: 0.15,
  stickRadius: 0.003,
  ballRadius: 0.012,
  // The invisible hit sphere round the ball: a fingertip-sized target.
  hitRadius: 0.03,
};

// Connector snapping (src/game/snapMath.ts). Generous first, per the Design doc: a snap
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

// Panel fit (src/game/panelFit.ts, driven by src/scene/gestureRouter.ts): a carried panel
// seats by all its holes at once onto free fastener ends — a dowel standing in another
// panel. Its own window, wider than SNAP's: a small finger move swings a panel's holes a
// long way. SNAP stays hardware's.
export const PANEL = {
  // A hole this near a free end (metres), and its axis this far off (radians), seeds a fit.
  maxDistance: 0.15,
  maxAngle: (60 * Math.PI) / 180,
  // With the fit seated, any other hole this near a compatible end across its axis (metres),
  // up to seatSlack along it, axis against axis within matchAngle (radians), seats on it too.
  // The slack is a dowel sink and a little: one dowel tapped home stands a sink lower than
  // one only seated at its hole's mouth, and a panel over both still seats on both.
  matchTolerance: 0.01,
  seatSlack: 0.02,
  matchAngle: (5 * Math.PI) / 180,
  // Where it goes: a fit is the panel's place in the finished item when it sits there within
  // matchTolerance across the dowels and matchAngle, and up to this far (metres) along them —
  // a dowel not yet pushed home in either panel stands that much proud (two dowel sinks).
  preferSlide: 0.035,
  // Magnetism: within `zone` metres (panel centre to where it goes), a carried panel with no
  // fit on offer turns toward where it goes, at `rate` (1/s) at full strength.
  zone: 0.4,
  rate: 6,
  // A fit on offer holds (hysteresis) until the finger has moved the panel more than
  // holdReach metres, or turned it more than holdTurn radians, since the offer was taken, or a
  // better fit comes in reach — where it goes, or more pairs; another fit as good takes over
  // only once the panel is offerMargin metres nearer it. The same fit found again stays as
  // first offered (what it seats on is held still under it). So a trembling finger, the line
  // easing, or a carcass the panel nudges never flips the offer frame to frame (1.8.3.4 phone
  // finding 1).
  holdReach: 0.08,
  holdTurn: (20 * Math.PI) / 180,
  offerMargin: 0.02,
};

// Self-aim (src/game/toolAim.ts, driven by src/scene/gestureRouter.ts): dragged hardware —
// a tool, a dowel, a bolt, a cam lock, a pin, a fitting — whose fastener end comes within
// `zone` of a seat that takes it turns that end to point in, harder the nearer it is, so
// SNAP's 40° window is reached without the gizmo. Outside the zone the part keeps whatever
// orientation it has; panels never aim.
export const AIM = {
  // Fasteners — a dowel, bolt, cam lock, pin or fitting into its hole: metres from the end
  // at which aiming starts (strength 0 there, 1 at the seat), and the turn rate at full
  // strength (1/s, the seat assist's exponential law).
  zone: 0.3,
  rate: 8,
  // Tools — a tip onto a bolt head or cam slot — the same, tuned apart.
  toolZone: 0.3,
  toolRate: 8,
  // An end this close (radians) to pointing straight in is left as it is.
  settled: 0.001,
};

// Target rings (src/game/toolTargets.ts picks them, src/scene/targetRings.ts draws them):
// while hardware is carried, each place it can go right now — a free hole that takes a
// fastener, a fastener a tool can turn — lights a ring as the finger nears it on screen,
// never one across the room from the part, the nearest brightest. Letting go over a lit
// ring seats the part there.
export const RING = {
  // CSS px from the finger at which a ring starts to fade in.
  screenRadius: 120,
  // CSS px from a lit ring within which letting go seats the part: a fingertip.
  hitRadius: 36,
  // Metres from the carried part's ends beyond which nothing lights, however close it looks.
  maxDistance: 0.5,
  // The ring lying round a head or slot (m), and its look at full strength.
  radius: 0.012,
  width: 0.004,
  opacity: 0.9,
  // Rings drawn at once, nearest first: plenty for the holes around one finger.
  pool: 12,
};

// Turn ring (src/game/turnRing.ts decides, src/ui/turnRing.ts draws): a flat dial facing
// the screen round the head of each fastener a seated tool is on, with arrows the
// tightening way and an arc filled to how far home it is. CSS px; it flashes this long as
// the fastener goes home.
export const TURN_RING = {
  // Radius of the drawn ring — a comfortable finger's reach from the head.
  radius: 64,
  // Half-width of the grab band either side of the ring: a fingertip.
  band: 24,
  // How long the ring flashes as its fastener goes home.
  flashMs: 400,
  // Drawn ring and arc widths, and the arrowheads' size.
  width: 4,
  arcWidth: 6,
  arrowSize: 14,
};

// Hole markings (src/game/decals.ts, drawn by src/game/partMesh.ts). Radii are keyed by
// the catalog's socket connector type and sized a touch wider than what fills them, so a
// seated fastener still shows a rim.
export const DECAL = {
  radius: {
    dowelHole: 0.005,
    camBoltHole: 0.0045,
    shelfPinHole: 0.0035,
    backFittingHole: 0.0045,
    camLockRecess: 0.009,
    // A threaded insert in a table top or leg: a hole a hair wider than the stud it takes.
    studHole: 0.0035,
    // A pilot hole through the part a wood screw attaches: a hair wider than its thread.
    screwHole: 0.002,
    // The pilot a wood screw's tip lands in, in the part behind the one it attaches.
    screwPilot: 0.002,
  },
  // A recess is drawn as a ring: inner radius as a fraction of the outer.
  recessInner: 0.55,
  // Laid this far proud of the face, so it never z-fights the panel.
  surfaceOffset: 0.0004,
  segments: 24,
};

// Hardware and tool shapes (src/game/partShapes.ts): visual only, each drawn inside its
// pack box. Radii are fractions of the box's half-width across the piece's axis; lengths
// are fractions of its length along it, measured from the end that goes in first.
export const MODELS = {
  // Round faces: low, because these are a few millimetres on screen.
  segments: 12,
  // The Allen key's hexagonal rod.
  hexSides: 6,
  // The key's rod, as a fraction of half the box's thickness: under 1 keeps the short
  // leg's axis close to the tip connector on the box's edge.
  wrenchRod: 0.75,
  // Screwdriver: the handle's share of the length, the shaft's radius, and the flat blade
  // at the tip (its length; its thickness as a fraction of the shaft's diameter).
  screwdriverHandle: 0.45,
  screwdriverShaft: 0.2,
  screwdriverBlade: 0.05,
  screwdriverBladeThickness: 0.35,
  // Cam bolt: the thread's radius, and the head's share of the length.
  boltShaft: 0.55,
  boltCap: 0.14,
  // A drive slot (a cam lock's top, a wood screw's head): its depth (share of the piece's
  // length), and its width and length across the end face (shares of the piece's diameter).
  driveSlotDepth: 0.1,
  driveSlotWidth: 0.16,
  driveSlotLength: 0.8,
  // Wood screw: the thread's radius (share of the head's), the head's share of the length (it
  // runs to the end of the box), and how far (share of the length) its drive slot's mark
  // stands proud of the head's top face.
  screwShaft: 0.45,
  screwHead: 0.15,
  screwSlotProud: 0.02,
  // Shelf pin: the rod's radius, and its collar (where it starts, how thick).
  pinRod: 0.6,
  pinCollarAt: 0.5,
  pinCollar: 0.12,
  // Back fitting: the plug's radius, and the head's share of the length.
  fittingShaft: 0.5,
  fittingHead: 0.25,
  // Double-ended stud: each end's hex socket, as a dark hexagonal plug — its depth (share of
  // the length) and its radius (share of the rod's).
  studSocketDepth: 0.1,
  studSocket: 0.6,
};

// Fasteners (src/game/fasteners.ts, src/game/assembly.ts) and the joints that follow them
// (src/physics/world.ts). Distances in metres unless marked CSS px; angles in radians.
export const FASTENER = {
  // A dowel, pin or back fitting comes back out when dragged this far (CSS px) along its axis.
  pullDistance: 40,
  // Wrench crank from a seated cam bolt to a screwed one: two full turns.
  boltRadians: 4 * Math.PI,
  // Hand or key turn from a seated threaded stud end to a screwed one: two full turns, a
  // fiddly stud being a turn-and-a-bit slower to seat than a bolt on the phone (?tune it).
  studRadians: 4 * Math.PI,
  // Screwdriver turn from a seated wood screw to one driven home: two full turns (?tune it).
  screwRadians: 4 * Math.PI,
  // Screwdriver turn from an open cam lock to a locked one.
  quarterTurn: Math.PI / 2,
  // A cam catches any screwed bolt head this close to its recess, and how deep each
  // fastener sits in its hole once fully home — the Flatpack contract's, so the game and
  // the validator never disagree (tools/validate/lib/vocabulary.js).
  captureRadius: CONTRACT.captureRadius,
  sinkDepth: CONTRACT.sinkDepth,
  // Crank motion this close (CSS px) to the fastener's on-screen centre is ignored — the
  // angle swings wildly there.
  crankDeadzone: 12,
  // Hold-to-drive: a still press on a seated tool drives its fastener home in this many
  // seconds, whatever its span — the cam's quarter turn as long as the bolt's two turns.
  driveSeconds: 1.5,
  // The ratchet ticks once every this much turn (an eighth), cranked or driven.
  ratchetRadians: Math.PI / 4,
  // Dowel-stage connections: rigid in translation, this much angular play about the pivot.
  // Zero: a dowelled carcass holds square until its cams lock or its screws drive home.
  // Ben's playtest of ÖVERKÄLL's drawer (2026-10-13) showed any sag knocks the next part's
  // dowels out of line, so the slump ships off; the ?tune knob (joint.angularPlay) puts it
  // back for a feel pass. Cam-locked = rigid.
  angularPlayDegrees: 0,
  // Torque per rad/s resisting the slump (N·m·s/rad) when there is play: a sag, not a drop.
  playDamping: 1000,
};


// Telemetry and live tuning (src/game/events.ts, src/game/sessionBuffer.ts,
// src/game/tunables.ts).
export const TUNE = {
  // The session buffer keeps this many of the latest events for export — a long session's
  // worth of grabs, seats and fps samples.
  sessionBufferSize: 5000,
  // The tuning drawer (src/ui/tunePanel.ts) exists only on a URL carrying this query flag
  // (…/skruv/?tune); the plain URL is the teaser, untouched.
  queryFlag: 'tune',
  // The drawer, in CSS pixels: never wider than this, nor taller than this share of the
  // screen, so the build stays in view above it.
  panelMaxWidth: 520,
  panelMaxHeight: 0.6,
  // A download's object URL is let go only after this many ms: Safari starts blob
  // downloads asynchronously and fails on a URL already revoked (FileSaver.js waits as long).
  downloadRevokeMs: 40_000,
  // Frame-rate fallback (src/scene/fpsGuard.ts): the loop's rate is sampled every
  // fpsSampleSeconds. Below fpsFloor for fpsWindow seconds running, the room renders every
  // other frame — a steady half rate rather than a stutter — while physics and gestures
  // keep every frame. It renders every frame again once a fully rendered rate would hold at
  // fpsRecover (or the floor, if higher) for fpsWindow — or at once if rendered frames
  // cost less than fpsHelpRatio times skipped ones (a capped loop, not a loaded one, where
  // skipping buys nothing). A floor of 0 never engages it.
  fpsSampleSeconds: 1,
  fpsFloor: 40,
  fpsWindow: 3,
  fpsRecover: 55,
  fpsHelpRatio: 1.25,
  // A frame gap longer than this many seconds is a backgrounded tab, not load: the sample
  // in progress is dropped rather than read as a frame rate near zero.
  fpsMaxGap: 1,
};

// Android haptics (navigator.vibrate; iOS Safari has none), in ms: a tick when a part
// seats (a tool engaging too), a double tick when a cam lock locks, a buzz when a bolt goes
// home, and a ratchet tick every FASTENER.ratchetRadians a fastener turns. 0 turns one off.
// The cues they back are src/game/haptics.ts's; a native shell maps those its own way.
export const HAPTICS = {
  seatMs: 10,
  lockMs: 18,
  lockGapMs: 60,
  tickMs: 4,
  homeMs: 24,
};

// Dev stream (dev server only — never in a build): the socket a dev session streams its
// events out of and takes knob sets in through. The hub is a plugin in vite.config.ts, the
// game's end src/dev/wsClient.ts, and tools/agent-bridge the agent's. Every message is
// JSON `{ kind, ... }`, one of `kinds`:
//   hello       any → hub      `{ role }`: 'game' for the page; anything else is a tool
//   event       game → tools   `{ event }`: one bus event (src/game/events.ts)
//   list        tool → game    `{ id }`: asks for the knobs
//   knobs       game → tools   `{ id, knobs }`: tunables.list(), answering list or set
//   set         tool → game    `{ id, key, value }`: a knob set, clamped by the registry
//   screenshot  tool → game    `{ id }`: asks for the canvas
//   image       game → tools   `{ id, dataUrl }`: a PNG of the next rendered frame
//   error       game → tools   `{ id, message }`: a request refused
// The hub relays game messages to every tool and tool messages to every game.
export const DEV_WS = {
  path: '/__skruv-dev',
  kinds: {
    hello: 'hello',
    event: 'event',
    list: 'list',
    knobs: 'knobs',
    set: 'set',
    screenshot: 'screenshot',
    image: 'image',
    error: 'error',
  },
  gameRole: 'game',
  // A dropped socket (the dev server restarted) is retried this often, in ms.
  retryMs: 2000,
};
