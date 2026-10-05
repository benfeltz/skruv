// The session's event stream: one pub/sub bus every observer reads — the session buffer
// and its export, haptics, the fps guard, the dev WebSocket. Pure: no DOM, Three or
// Rapier, so the shapes below are pinned headlessly.
//
// Every event is `{ type, t, seq, ...fields }`: the bus stamps `t` (ms, from the clock it
// was made with) and `seq` (emit order); the fields are exactly EVENT_FIELDS[type]. Emitters
// build events with the factories at the bottom, never by hand, so a shape changes in one
// place. Part and joint ids are the assembly's.
//
//   session        phase              'start' on boot; 'hidden' / 'visible' as the page is
//                                      backgrounded and returns — a session that ends
//                                      hidden is an abandon
//   grab           part, mode         a drag began: 'move' (free part), 'compound' (carried
//                                      through its joints), 'crank' (a tool turning its
//                                      fastener) or 'pull' (drawing a fastened part out)
//   release        part, mode,        the drag ended: seated (it dropped into a seat) or
//                  seated, cancelled  cancelled (interrupted — never seats). Every grab has
//                                      one release of the same mode: a pull that frees its
//                                      part releases as 'pull' and grabs again as 'move'
//   snapCandidate  part, target,      the seat on offer under the dragged part changed;
//                  connector,         target (and both connectors) null when the offer
//                  targetConnector    is withdrawn
//   seat           joint, kind,       a connector pair seated (kind is fasteners.js KIND)
//                  hardware, host
//   unseat         joint, kind,       a seated pair came apart
//                  hardware, host
//   fasten         joint, kind,       a fastener went home: pressed, screwed — or, kind
//                  hardware, host,    'cam' with state 'locked', the cam lock
//                  state
//   unfasten       joint, kind,       a fastener came back to plain seated
//                  hardware, host
//   reset          —                  the player repacked
//   recovery       parts              parts that left the room were set down by the box
//   fps            fps, skipping      a sampled frame rate, and whether the render-skip
//                                      fallback is engaged
//   tune           key, value         a live knob was set (src/game/tunables.js)

export const EVENT = Object.freeze({
  SESSION: 'session',
  GRAB: 'grab',
  RELEASE: 'release',
  SNAP_CANDIDATE: 'snapCandidate',
  SEAT: 'seat',
  UNSEAT: 'unseat',
  FASTEN: 'fasten',
  UNFASTEN: 'unfasten',
  RESET: 'reset',
  RECOVERY: 'recovery',
  FPS: 'fps',
  TUNE: 'tune',
});

const JOINT_FIELDS = ['joint', 'kind', 'hardware', 'host'];

export const EVENT_FIELDS = Object.freeze({
  [EVENT.SESSION]: ['phase'],
  [EVENT.GRAB]: ['part', 'mode'],
  [EVENT.RELEASE]: ['part', 'mode', 'seated', 'cancelled'],
  [EVENT.SNAP_CANDIDATE]: ['part', 'target', 'connector', 'targetConnector'],
  [EVENT.SEAT]: JOINT_FIELDS,
  [EVENT.UNSEAT]: JOINT_FIELDS,
  [EVENT.FASTEN]: [...JOINT_FIELDS, 'state'],
  [EVENT.UNFASTEN]: JOINT_FIELDS,
  [EVENT.RESET]: [],
  [EVENT.RECOVERY]: ['parts'],
  [EVENT.FPS]: ['fps', 'skipping'],
  [EVENT.TUNE]: ['key', 'value'],
});

// Exactly the schema's fields, in its order; one an emitter left out is null, never absent.
function build(type, fields = {}) {
  const event = { type };
  for (const name of EVENT_FIELDS[type]) event[name] = fields[name] ?? null;
  return event;
}

// The joint fields of an assembly joint record (src/game/assembly.js).
const jointFields = ({ id, kind, hardware, host }) => ({ joint: id, kind, hardware, host });

export const sessionEvent = (phase) => build(EVENT.SESSION, { phase });
export const grabEvent = (part, mode) => build(EVENT.GRAB, { part, mode });
export const releaseEvent = (part, mode, { seated = false, cancelled = false } = {}) =>
  build(EVENT.RELEASE, { part, mode, seated, cancelled });
/** `offer` is a snapMath snap (`{ from, to }` world connectors), or null when withdrawn. */
export const snapCandidateEvent = (part, offer) =>
  build(EVENT.SNAP_CANDIDATE, {
    part,
    target: offer?.to.part.id,
    connector: offer?.from.index,
    targetConnector: offer?.to.index,
  });
export const seatEvent = (joint) => build(EVENT.SEAT, jointFields(joint));
export const unseatEvent = (joint) => build(EVENT.UNSEAT, jointFields(joint));
export const fastenEvent = (joint) => build(EVENT.FASTEN, { ...jointFields(joint), state: joint.fastener.state });
export const unfastenEvent = (joint) => build(EVENT.UNFASTEN, jointFields(joint));
export const resetEvent = () => build(EVENT.RESET);
export const recoveryEvent = (parts) => build(EVENT.RECOVERY, { parts: [...parts] });
export const fpsEvent = (fps, skipping) => build(EVENT.FPS, { fps, skipping });
export const tuneEvent = (key, value) => build(EVENT.TUNE, { key, value });

/** Subscribe to every event type at once. */
export const ANY = '*';

/**
 * A bus: `on(type, fn)` (type or ANY) returns its unsubscribe; `off(type, fn)`; `emit(event)`
 * stamps `t` from `now()` and `seq`, then calls the type's listeners and ANY's. A listener
 * that throws is reported and skipped — an observer never breaks the gesture that emitted.
 */
export function createBus({ now = () => 0, onError = (error) => console.error(error) } = {}) {
  const listeners = new Map();
  let seq = 0;

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    listeners.get(type)?.delete(fn);
  }

  function emit(event) {
    const stamped = { ...event, t: now(), seq: seq++ };
    for (const type of [stamped.type, ANY]) {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        try {
          fn(stamped);
        } catch (error) {
          onError(error);
        }
      }
    }
    return stamped;
  }

  return { on, off, emit };
}
