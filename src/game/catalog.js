// Part catalog for the Billy-style bookcase (~80 × 28 × 202 cm) — the manifest from the
// Design doc, as DATA. Sizes, masses and connector positions describe the furniture
// item; they are not behaviour tunables, so they live here rather than in constants.js.
//
// Units: metres and kilograms. Sizes are [x, y, z] in the part's assembled orientation:
// carcass front faces +z, sides stand along y. Connector positions are part-local
// (origin at the part's centre); `axis` is the unit outward normal of a hole's mouth, or
// the direction a fastener's end points. Which connector mates with which is PR 4's
// concern and deliberately absent here.

export const CONNECTOR = Object.freeze({
  DOWEL_HOLE: 'dowelHole',
  CAM_BOLT_HOLE: 'camBoltHole',
  CAM_LOCK_RECESS: 'camLockRecess',
  SHELF_PIN_HOLE: 'shelfPinHole',
  NAIL_HOLE: 'nailHole',
  DOWEL_END: 'dowelEnd',
  BOLT_THREAD: 'boltThread',
  BOLT_HEAD: 'boltHead',
  CAM_LOCK_BODY: 'camLockBody',
  PIN_TIP: 'pinTip',
  NAIL_TIP: 'nailTip',
  WRENCH_TIP: 'wrenchTip',
});

const PANEL_THICKNESS = 0.016;
const CARCASS_WIDTH = 0.8;
const CARCASS_DEPTH = 0.28;
const CARCASS_HEIGHT = 2.02;
const INNER_WIDTH = CARCASS_WIDTH - 2 * PANEL_THICKNESS;

// Heights of the horizontal panels' centres, relative to the side panel's centre.
const BOTTOM_Y = -CARCASS_HEIGHT / 2 + 0.06 + PANEL_THICKNESS / 2;
const FIXED_Y = 0;
const TOP_Y = CARCASS_HEIGHT / 2 - PANEL_THICKNESS / 2;
const ADJUSTABLE_SHELF_Y = [-0.5, 0.5];
const PIN_BELOW_SHELF = PANEL_THICKNESS / 2 + 0.004;

// Joint layout shared by a side's holes and the horizontal panel ends they meet.
const DOWEL_Z = { topBottom: [-0.09, 0.09], fixed: [-0.11, 0.11] };
const CAM_Z = { topBottom: [0], fixed: [-0.04, 0.04] };
const CAM_INSET = 0.034;
const PIN_Z = [-0.09, 0.09];

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
  return [...holes, ...pins];
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

// Nailed at the corners and edge midpoints, from behind.
function backPanelConnectors(size) {
  const [w, h, d] = size;
  const x = w / 2 - PANEL_THICKNESS / 2;
  const y = h / 2 - PANEL_THICKNESS / 2;
  const points = [
    [-x, -y], [x, -y], [-x, y], [x, y],
    [-x, 0], [x, 0], [0, -y], [0, y],
  ];
  return points.map(([px, py]) => connector(CONNECTOR.NAIL_HOLE, [px, py, -d / 2], NEG_Z));
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
const NAIL_SIZE = [0.002, 0.02, 0.002];
// The L-shaped key as its bounding box; the short arm's tip is the working end.
const ALLEN_WRENCH_SIZE = [0.07, 0.004, 0.025];

export const PART_TYPES = Object.freeze({
  sidePanel: {
    size: [PANEL_THICKNESS, CARCASS_HEIGHT, CARCASS_DEPTH],
    mass: 6,
    color: 'partPanel',
    connectors: sidePanelConnectors(),
  },
  topBottomPanel: {
    size: [INNER_WIDTH, PANEL_THICKNESS, CARCASS_DEPTH],
    mass: 2.3,
    color: 'partPanel',
    connectors: horizontalPanelConnectors(DOWEL_Z.topBottom, CAM_Z.topBottom),
  },
  fixedShelf: {
    size: [INNER_WIDTH, PANEL_THICKNESS, CARCASS_DEPTH],
    mass: 2.3,
    color: 'partPanel',
    connectors: horizontalPanelConnectors(DOWEL_Z.fixed, CAM_Z.fixed),
  },
  adjustableShelf: {
    // Narrower than the carcass and shy of the back panel, so it drops in on its pins.
    size: [INNER_WIDTH - 0.004, PANEL_THICKNESS, CARCASS_DEPTH - 0.02],
    mass: 2.1,
    color: 'partPanel',
    connectors: [],
  },
  backPanel: {
    size: BACK_PANEL_SIZE,
    mass: 4.3,
    color: 'partHardboard',
    connectors: backPanelConnectors(BACK_PANEL_SIZE),
  },
  dowel: {
    size: DOWEL_SIZE,
    mass: 0.0015,
    color: 'partDowel',
    connectors: rodConnectors(DOWEL_SIZE, CONNECTOR.DOWEL_END, CONNECTOR.DOWEL_END),
  },
  camLockBolt: {
    size: CAM_LOCK_BOLT_SIZE,
    mass: 0.004,
    color: 'partMetal',
    connectors: rodConnectors(CAM_LOCK_BOLT_SIZE, CONNECTOR.BOLT_THREAD, CONNECTOR.BOLT_HEAD),
  },
  camLock: {
    size: CAM_LOCK_SIZE,
    mass: 0.005,
    color: 'partMetal',
    connectors: rodConnectors(CAM_LOCK_SIZE, CONNECTOR.CAM_LOCK_BODY),
  },
  shelfPin: {
    size: SHELF_PIN_SIZE,
    mass: 0.001,
    color: 'partMetal',
    connectors: rodConnectors(SHELF_PIN_SIZE, CONNECTOR.PIN_TIP),
  },
  nail: {
    size: NAIL_SIZE,
    mass: 0.0005,
    color: 'partMetal',
    connectors: rodConnectors(NAIL_SIZE, CONNECTOR.NAIL_TIP),
  },
  allenWrench: {
    size: ALLEN_WRENCH_SIZE,
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
});

/** Quantities in the flatpack, per the Design doc's manifest table. */
export const MANIFEST_QUANTITIES = Object.freeze({
  sidePanel: 2,
  topBottomPanel: 2,
  fixedShelf: 1,
  adjustableShelf: 2,
  backPanel: 1,
  dowel: 12,
  camLockBolt: 8,
  camLock: 8,
  shelfPin: 8,
  nail: 8,
  allenWrench: 1,
});

/** One entry per physical part in the box: `{ id, type }`, ids like `dowel-3`. */
export const MANIFEST = Object.freeze(
  Object.entries(MANIFEST_QUANTITIES).flatMap(([type, quantity]) =>
    Array.from({ length: quantity }, (_, i) => Object.freeze({ id: `${type}-${i + 1}`, type })),
  ),
);
