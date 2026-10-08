// The Flatpack format's shared vocabulary: the connector types a pack may name, which
// fastener end goes in which hole, and the fastener machine each pair runs. Names only —
// what a quarter turn or a crank FEELS like stays in the engine and its tuning. A pack
// using a name not listed here fails validation.
//
// Pure and dependency-free: the web game, the validator CLI and (by contract) the Godot
// build read the same names. Nothing here imports from src/, Three, Rapier, the DOM or Node.

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

/** A connector type the format knows (the schema's `connectorType`). */
export type ConnectorType = (typeof CONNECTOR)[keyof typeof CONNECTOR];

/** Fastener end → the hole it goes in. Matching is symmetric; see `areCompatible`. */
export const COMPATIBLE: Readonly<Partial<Record<ConnectorType, ConnectorType>>> = Object.freeze({
  [CONNECTOR.DOWEL_END]: CONNECTOR.DOWEL_HOLE,
  [CONNECTOR.BOLT_THREAD]: CONNECTOR.CAM_BOLT_HOLE,
  [CONNECTOR.CAM_LOCK_BODY]: CONNECTOR.CAM_LOCK_RECESS,
  [CONNECTOR.PIN_TIP]: CONNECTOR.SHELF_PIN_HOLE,
  [CONNECTOR.BACK_FITTING_TIP]: CONNECTOR.BACK_FITTING_HOLE,
  [CONNECTOR.WRENCH_TIP]: CONNECTOR.BOLT_HEAD,
  [CONNECTOR.SCREWDRIVER_TIP]: CONNECTOR.CAM_SLOT,
});

export const areCompatible = (a: ConnectorType, b: ConnectorType) => COMPATIBLE[a] === b || COMPATIBLE[b] === a;

/** True for a fastener-end connector type (the side of a pair that goes into a hole). */
export const isFastenerEnd = (type: ConnectorType) => type in COMPATIBLE;

/** The fastener machines — one per seated pair, named by the engine that runs them. */
export const KIND = Object.freeze({
  DOWEL: 'dowel',
  PIN: 'pin',
  // A push-pin back fitting: pressed through the back panel into whatever lies behind.
  FITTING: 'fitting',
  BOLT: 'bolt',
  CAM: 'cam',
  TOOL: 'tool',
});

/** A fastener machine the format knows (the schema's `fastenerKind`). */
export type FastenerKind = (typeof KIND)[keyof typeof KIND];

// Keyed by the fastener-end side of a pair (COMPATIBLE's keys).
const KIND_FOR_END: Readonly<Partial<Record<ConnectorType, FastenerKind>>> = Object.freeze({
  [CONNECTOR.DOWEL_END]: KIND.DOWEL,
  [CONNECTOR.PIN_TIP]: KIND.PIN,
  [CONNECTOR.BACK_FITTING_TIP]: KIND.FITTING,
  [CONNECTOR.BOLT_THREAD]: KIND.BOLT,
  [CONNECTOR.CAM_LOCK_BODY]: KIND.CAM,
  [CONNECTOR.WRENCH_TIP]: KIND.TOOL,
  [CONNECTOR.SCREWDRIVER_TIP]: KIND.TOOL,
});

/** The fastener kind for a pair whose fastener end has connector type `endType`, or null. */
export const kindOf = (endType: ConnectorType) => KIND_FOR_END[endType] ?? null;

/**
 * The geometric contract every engine honours, in metres. A pack's assembled poses are
 * checked against it, and joints are derived from them by it.
 *   sinkDepth     — how deep each fastener sits in its hole once fully home, along its axis
 *   captureRadius — a cam catches any bolt head this close to its recess (instance-agnostic)
 *   mateReach     — a fastener end this near its seated spot in a compatible hole is paired
 *                   with it when joints are derived
 *   mateTolerance — how exactly a derived pair must then sit (the validator's coincidence rule)
 */
export const CONTRACT = Object.freeze({
  sinkDepth: Object.freeze<Partial<Record<FastenerKind, number>>>({ dowel: 0.015, pin: 0.008, fitting: 0.012, bolt: 0.011, cam: 0.012 }),
  captureRadius: 0.015,
  mateReach: 0.005,
  mateTolerance: 1e-6,
});
