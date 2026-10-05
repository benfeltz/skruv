// Part catalog for the Billy-style bookcase (~80 × 28 × 202 cm) — the manifest from the
// Design doc, as DATA. Sizes, masses and connector positions describe the furniture
// item; they are not behaviour tunables, so they live here rather than in constants.js.
//
// Each type carries a fake five-digit part number, as printed beside the hardware counts in
// the booklet — stable, so the booklet and any future telemetry agree.
//
// Units: metres and kilograms. Sizes are [x, y, z] in the part's assembled orientation:
// carcass front faces +z, sides stand along y. Connector positions are part-local
// (origin at the part's centre); `axis` is the unit outward normal of a hole's mouth, or
// the direction a fastener's end points. Which instance mates with which is the assembly
// graph's concern (src/game/assembly.js) and deliberately absent here.

export const CONNECTOR = Object.freeze({
  DOWEL_HOLE: 'dowelHole',
  CAM_BOLT_HOLE: 'camBoltHole',
  CAM_LOCK_RECESS: 'camLockRecess',
  SHELF_PIN_HOLE: 'shelfPinHole',
  BACK_FITTING_HOLE: 'backFittingHole',
  DOWEL_END: 'dowelEnd',
  BOLT_THREAD: 'boltThread',
  BOLT_HEAD: 'boltHead',
  CAM_LOCK_BODY: 'camLockBody',
  PIN_TIP: 'pinTip',
  BACK_FITTING_TIP: 'backFittingTip',
  WRENCH_TIP: 'wrenchTip',
  CAM_SLOT: 'camSlot',
  SCREWDRIVER_TIP: 'screwdriverTip',
});

const PANEL_THICKNESS = 0.016;
const CARCASS_WIDTH = 0.8;
const CARCASS_DEPTH = 0.28;
const CARCASS_HEIGHT = 2.02;
const INNER_WIDTH = CARCASS_WIDTH - 2 * PANEL_THICKNESS;
// The plinth strip fills the gap under the bottom panel, flush with the carcass front.
const PLINTH_HEIGHT = 0.06;

// Heights of the horizontal panels' centres, relative to the side panel's centre.
const BOTTOM_Y = -CARCASS_HEIGHT / 2 + PLINTH_HEIGHT + PANEL_THICKNESS / 2;
const FIXED_Y = 0;
const TOP_Y = CARCASS_HEIGHT / 2 - PANEL_THICKNESS / 2;
const ADJUSTABLE_SHELF_Y = [-0.5, 0.5];
const PIN_BELOW_SHELF = PANEL_THICKNESS / 2 + 0.004;

// Joint layout shared by a side's holes and the horizontal panel ends they meet.
const DOWEL_Z = { topBottom: [-0.09, 0.09], fixed: [-0.11, 0.11] };
const CAM_Z = { topBottom: [0], fixed: [-0.04, 0.04] };
const CAM_INSET = 0.034;
const PIN_Z = [-0.09, 0.09];
// One dowel into each end of the plinth, centred in its height and thickness. The side
// is drilled for it at both edges, so either side stands either way round; the rear pair
// stays empty.
const PLINTH_Y = -CARCASS_HEIGHT / 2 + PLINTH_HEIGHT / 2;
const PLINTH_Z = [CARCASS_DEPTH / 2 - PANEL_THICKNESS / 2, -(CARCASS_DEPTH / 2 - PANEL_THICKNESS / 2)];

const X = [1, 0, 0];
const NEG_X = [-1, 0, 0];
const Y = [0, 1, 0];
const NEG_Y = [0, -1, 0];
const NEG_Z = [0, 0, -1];
const Z = [0, 0, 1];

const connector = (type, position, axis) => ({ type, position, axis });

// Inner face is +x; the second side is the same part turned 180° about y, and the
// pattern is symmetric in z so it fits either way round.
function sidePanelConnectors() {
  const face = PANEL_THICKNESS / 2;
  const joints = [
    { y: BOTTOM_Y, dowels: DOWEL_Z.topBottom, cams: CAM_Z.topBottom },
    { y: FIXED_Y, dowels: DOWEL_Z.fixed, cams: CAM_Z.fixed },
    { y: TOP_Y, dowels: DOWEL_Z.topBottom, cams: CAM_Z.topBottom },
  ];
  const holes = joints.flatMap(({ y, dowels, cams }) => [
    ...dowels.map((z) => connector(CONNECTOR.DOWEL_HOLE, [face, y, z], X)),
    ...cams.map((z) => connector(CONNECTOR.CAM_BOLT_HOLE, [face, y, z], X)),
  ]);
  const pins = ADJUSTABLE_SHELF_Y.flatMap((y) =>
    PIN_Z.map((z) => connector(CONNECTOR.SHELF_PIN_HOLE, [face, y - PIN_BELOW_SHELF, z], X)),
  );
  // Last, so the indices above stay put.
  const plinth = PLINTH_Z.map((z) => connector(CONNECTOR.DOWEL_HOLE, [face, PLINTH_Y, z], X));
  return [...holes, ...pins, ...plinth];
}

// Dowel holes in both end edges; cam recesses in the underside face, inset from the ends.
function horizontalPanelConnectors(dowelZ, camZ) {
  const end = INNER_WIDTH / 2;
  const underside = -PANEL_THICKNESS / 2;
  return [-1, 1].flatMap((sign) => [
    ...dowelZ.map((z) => connector(CONNECTOR.DOWEL_HOLE, [sign * end, 0, z], sign > 0 ? X : NEG_X)),
    ...camZ.map((z) =>
      connector(CONNECTOR.CAM_LOCK_RECESS, [sign * (end - CAM_INSET), underside, z], NEG_Y),
    ),
  ]);
}

// Push-pin back fittings press through these from behind into the sides' back edges and
// the top, fixed and bottom panels. The panel sits flush with the carcass top, so its rows
// are the horizontal panels' heights shifted into its own frame — the plinth makes them
// asymmetric.
function backPanelConnectors(size) {
  const [w, h, d] = size;
  const x = w / 2 - PANEL_THICKNESS / 2;
  const centreY = CARCASS_HEIGHT / 2 - h / 2;
  const [bottom, middle, top] = [BOTTOM_Y, FIXED_Y, TOP_Y].map((y) => y - centreY);
  const points = [
    [-x, bottom], [x, bottom], [-x, top], [x, top],
    [-x, middle], [x, middle], [0, bottom], [0, top],
  ];
  return points.map(([px, py]) => connector(CONNECTOR.BACK_FITTING_HOLE, [px, py, -d / 2], NEG_Z));
}

// A dowel hole in each end edge.
function plinthConnectors([w]) {
  return [-1, 1].map((sign) => connector(CONNECTOR.DOWEL_HOLE, [sign * (w / 2), 0, 0], sign > 0 ? X : NEG_X));
}

// Long fasteners stand along y: `tip` at the bottom end, optional `head` at the top.
function rodConnectors(size, tip, head) {
  const half = size[1] / 2;
  const ends = [connector(tip, [0, -half, 0], NEG_Y)];
  if (head) ends.push(connector(head, [0, half, 0], Y));
  return ends;
}

const BACK_PANEL_SIZE = [CARCASS_WIDTH - 0.01, CARCASS_HEIGHT - 0.02, 0.003];
const DOWEL_SIZE = [0.008, 0.03, 0.008];
const CAM_LOCK_BOLT_SIZE = [0.007, 0.035, 0.007];
const CAM_LOCK_SIZE = [0.015, 0.012, 0.015];
const SHELF_PIN_SIZE = [0.005, 0.016, 0.005];
// Push-pin: a shank through the hardboard into the carcass edge, a flat head left proud.
const BACK_FITTING_SIZE = [0.008, 0.016, 0.008];
const PLINTH_SIZE = [INNER_WIDTH, PLINTH_HEIGHT, PANEL_THICKNESS];
// The L-shaped key as its bounding box; the short arm's tip is the working end.
const ALLEN_WRENCH_SIZE = [0.07, 0.004, 0.025];
// Handle and shaft as one bounding box; the blade tip is the bottom end.
const SCREWDRIVER_SIZE = [0.022, 0.2, 0.022];

export const PART_TYPES = Object.freeze({
  sidePanel: {
    size: [PANEL_THICKNESS, CARCASS_HEIGHT, CARCASS_DEPTH],
    partNumber: '10334',
    mass: 6,
    color: 'partPanel',
    connectors: sidePanelConnectors(),
  },
  topBottomPanel: {
    size: [INNER_WIDTH, PANEL_THICKNESS, CARCASS_DEPTH],
    partNumber: '10335',
    mass: 2.3,
    color: 'partPanel',
    connectors: horizontalPanelConnectors(DOWEL_Z.topBottom, CAM_Z.topBottom),
  },
  fixedShelf: {
    size: [INNER_WIDTH, PANEL_THICKNESS, CARCASS_DEPTH],
    partNumber: '10336',
    mass: 2.3,
    color: 'partPanel',
    connectors: horizontalPanelConnectors(DOWEL_Z.fixed, CAM_Z.fixed),
  },
  adjustableShelf: {
    // Narrower than the carcass and shy of the back panel, so it drops in on its pins.
    size: [INNER_WIDTH - 0.004, PANEL_THICKNESS, CARCASS_DEPTH - 0.02],
    partNumber: '10337',
    mass: 2.1,
    color: 'partPanel',
    connectors: [],
  },
  plinth: {
    size: PLINTH_SIZE,
    partNumber: '10338',
    mass: 0.6,
    color: 'partPanel',
    connectors: plinthConnectors(PLINTH_SIZE),
  },
  backPanel: {
    size: BACK_PANEL_SIZE,
    partNumber: '10339',
    mass: 4.3,
    color: 'partHardboard',
    connectors: backPanelConnectors(BACK_PANEL_SIZE),
  },
  dowel: {
    size: DOWEL_SIZE,
    partNumber: '10106',
    mass: 0.0015,
    color: 'partDowel',
    connectors: rodConnectors(DOWEL_SIZE, CONNECTOR.DOWEL_END, CONNECTOR.DOWEL_END),
  },
  camLockBolt: {
    size: CAM_LOCK_BOLT_SIZE,
    partNumber: '11902',
    mass: 0.004,
    color: 'partMetal',
    connectors: rodConnectors(CAM_LOCK_BOLT_SIZE, CONNECTOR.BOLT_THREAD, CONNECTOR.BOLT_HEAD),
  },
  camLock: {
    size: CAM_LOCK_SIZE,
    partNumber: '11701',
    mass: 0.005,
    color: 'partMetal',
    // Body end drops into the recess; the slot on the opposite face takes the screwdriver.
    connectors: rodConnectors(CAM_LOCK_SIZE, CONNECTOR.CAM_LOCK_BODY, CONNECTOR.CAM_SLOT),
  },
  shelfPin: {
    size: SHELF_PIN_SIZE,
    partNumber: '10221',
    mass: 0.001,
    color: 'partMetal',
    connectors: rodConnectors(SHELF_PIN_SIZE, CONNECTOR.PIN_TIP),
  },
  backFitting: {
    size: BACK_FITTING_SIZE,
    partNumber: '12614',
    mass: 0.001,
    color: 'partFitting',
    connectors: rodConnectors(BACK_FITTING_SIZE, CONNECTOR.BACK_FITTING_TIP),
  },
  allenWrench: {
    size: ALLEN_WRENCH_SIZE,
    partNumber: '10067',
    mass: 0.015,
    color: 'partWrench',
    connectors: [
      connector(
        CONNECTOR.WRENCH_TIP,
        [ALLEN_WRENCH_SIZE[0] / 2, 0, ALLEN_WRENCH_SIZE[2] / 2],
        Z,
      ),
    ],
  },
  screwdriver: {
    size: SCREWDRIVER_SIZE,
    partNumber: '10093',
    mass: 0.08,
    color: 'partScrewdriver',
    connectors: rodConnectors(SCREWDRIVER_SIZE, CONNECTOR.SCREWDRIVER_TIP),
  },
});

/**
 * Quantities in the flatpack, per the Design doc's manifest table — plus spares, as in the
 * real bag: two dowels and two cam locks more than the holes take.
 */
export const MANIFEST_QUANTITIES = Object.freeze({
  sidePanel: 2,
  topBottomPanel: 2,
  fixedShelf: 1,
  adjustableShelf: 2,
  plinth: 1,
  backPanel: 1,
  dowel: 16,
  camLockBolt: 8,
  camLock: 10,
  shelfPin: 8,
  backFitting: 8,
  allenWrench: 1,
  screwdriver: 1,
});

/** One entry per physical part in the box: `{ id, type }`, ids like `dowel-3`. */
export const MANIFEST = Object.freeze(
  Object.entries(MANIFEST_QUANTITIES).flatMap(([type, quantity]) =>
    Array.from({ length: quantity }, (_, i) => Object.freeze({ id: `${type}-${i + 1}`, type })),
  ),
);
