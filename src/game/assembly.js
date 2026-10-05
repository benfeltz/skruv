// The assembly graph: the one source of truth for what is joined to what. Pure — part ids
// and catalog connector indices in, plain records out; poses are `{ position: [x, y, z],
// rotation: [x, y, z, w] }` supplied by the caller.
//
// A joint is one seated connector pair, normalised so `hardware` is the fastener-end side
// (dowel, bolt, cam, pin, back fitting, tool) and `host` the hole side, with the fastener state
// machine that pair runs (src/game/fasteners.js). `mover` is the part that was dragged
// into the seat — the one held in place until its first fastener engages.
//
// There is no notion of a correct assembly here: any type-compatible seated pair fastens,
// wrong panel or not. Right and wrong is the booklet's call (PR 5).
//
// `bonds()` derives the physics joints fastener state calls for: each fastened piece of
// hardware embeds rigidly in its first host, and two hosts sharing fastened hardware are
// bridged — with angular play while only dowels hold them, rigid once a cam locks.

import { FASTENER } from '../constants.js';
import { PART_TYPES } from './catalog.js';
import {
  canRelease as fastenersRelease,
  createFastener,
  isFastened,
  isCrankKind,
  isTapKind,
  KIND,
  kindOf,
  STATE,
  transition,
} from './fasteners.js';
import { COMPATIBLE, multiplyQuaternions, rotateVector, rotationBetween } from './snapMath.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const negate = (a) => scale(a, -1);
const conjugate = ([x, y, z, w]) => [-x, -y, -z, w];
const distance = (a, b) => Math.hypot(...sub(a, b));

function normalize(q) {
  const n = Math.hypot(...q);
  return q.map((c) => c / n);
}

/** `b`'s pose expressed in `a`'s frame, as `{ anchor, rotation }`. */
export function relativePose(a, b) {
  const inverse = conjugate(a.rotation);
  return {
    anchor: rotateVector(inverse, sub(b.position, a.position)),
    rotation: normalize(multiplyQuaternions(inverse, b.rotation)),
  };
}

/**
 * Where `pose` ends up when whatever it is rigidly attached to moves from pose `from` to
 * pose `to` — how a fastened compound follows one of its parts.
 */
export function carryPose(from, to, pose) {
  const rel = relativePose(from, pose);
  return {
    position: add(to.position, rotateVector(to.rotation, rel.anchor)),
    rotation: normalize(multiplyQuaternions(to.rotation, rel.rotation)),
  };
}

const compose = (f, g) => ({
  anchor: add(f.anchor, rotateVector(f.rotation, g.anchor)),
  rotation: normalize(multiplyQuaternions(f.rotation, g.rotation)),
});

const invert = (f) => {
  const rotation = conjugate(f.rotation);
  return { anchor: negate(rotateVector(rotation, f.anchor)), rotation };
};

/** World-space `{ position, axis }` of a part-local connector at `pose`. */
export function connectorInWorld(connector, pose) {
  return {
    position: add(rotateVector(pose.rotation, connector.position), pose.position),
    axis: rotateVector(pose.rotation, connector.axis),
  };
}

/**
 * The bolt head (`{ id, position }` records) nearest the cam recess position, if within
 * `radius` — any bolt, whichever instance; null otherwise.
 */
export function capture(recess, heads, radius = FASTENER.captureRadius) {
  let best = null;
  let bestDistance = radius;
  for (const head of heads) {
    const d = distance(head.position, recess.position);
    if (d <= bestDistance) {
      best = head;
      bestDistance = d;
    }
  }
  return best;
}

/** How deep the joint's fastener currently sits in its hole. */
const sinkOf = (joint) => (FASTENER.sinkDepth[joint.kind] ?? 0) * joint.fastener.progress;

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// The single event that takes a fastener of `kind` from seated to fully home, or null for
// a tool (it fastens nothing).
function homeEvent(kind) {
  if (isTapKind(kind)) return { type: 'tap' };
  if (kind === KIND.BOLT) return { type: 'crank', radians: FASTENER.screwRadians };
  if (kind === KIND.CAM) return { type: 'crank', radians: FASTENER.quarterTurn };
  return null;
}

/**
 * Seats every pair in `pairs` — `{ partA, connectorA, partB, connectorB, mover, ctx }`, as
 * `seat` takes them plus the `apply` context their fastener needs (`through`, `captured`)
 * — and drives each home with `drive`: bolts before the cams that catch them. A part set
 * put in this way is fastened by exactly the events a build sends, so the same events in
 * reverse take it apart. Returns the joints.
 */
export function seatHome(assembly, pairs) {
  const seated = pairs.map(({ ctx = {}, ...pair }) => ({ joint: assembly.seat(pair), ctx }));
  const camsLast = (s) => (s.joint.kind === KIND.CAM ? 1 : 0);
  for (const { joint, ctx } of [...seated].sort((a, b) => camsLast(a) - camsLast(b))) assembly.drive(joint.id, ctx);
  return seated.map((s) => assembly.get(s.joint.id));
}

/**
 * `typeOf(partId)` names each part's catalog type.
 */
export function createAssembly(typeOf) {
  const joints = new Map();
  let nextId = 1;

  const connectorOf = (part, index) => PART_TYPES[typeOf(part)].connectors[index];
  const hardwareConnector = (j) => connectorOf(j.hardware, j.hardwareConnector);
  const hostConnector = (j) => connectorOf(j.host, j.hostConnector);

  /** Seats connector `connectorA` of `partA` on `connectorB` of `partB`; returns the joint. */
  function seat({ partA, connectorA, partB, connectorB, mover }) {
    const typeA = connectorOf(partA, connectorA).type;
    const typeB = connectorOf(partB, connectorB).type;
    let ends;
    if (COMPATIBLE[typeA] === typeB) ends = [partA, connectorA, partB, connectorB];
    else if (COMPATIBLE[typeB] === typeA) ends = [partB, connectorB, partA, connectorA];
    else throw new Error(`${typeA} does not seat on ${typeB}`);
    const [hardware, hc, host, hostIndex] = ends;
    const kind = kindOf(connectorOf(hardware, hc).type);
    const joint = {
      id: nextId++,
      hardware,
      hardwareConnector: hc,
      host,
      hostConnector: hostIndex,
      kind,
      mover,
      fastener: createFastener(kind),
      // A pressed back fitting's tip lands in whatever part sits behind its hole.
      through: null,
      // A locked cam's caught bolt.
      captured: null,
    };
    joints.set(joint.id, joint);
    return joint;
  }

  function unseat(id) {
    joints.delete(id);
  }

  const all = () => [...joints.values()];
  const jointsOf = (part) => all().filter((j) => j.hardware === part || j.host === part);
  const fastenedOf = (hardware) =>
    all()
      .filter((j) => j.hardware === hardware && isFastened(j.fastener))
      .sort((a, b) => a.id - b.id);

  const isHeld = (bolt) => all().some((j) => j.kind === KIND.CAM && j.fastener.state === STATE.LOCKED && j.captured === bolt);

  /** The part a bolt is screwed into, or null. */
  function screwedHost(bolt) {
    const joint = all().find((j) => j.hardware === bolt && j.kind === KIND.BOLT && isFastened(j.fastener));
    return joint ? joint.host : null;
  }

  /**
   * Feeds `event` to a joint's machine. `ctx.captured` (a cam's caught bolt id or null) and
   * `ctx.through` (the part behind a back fitting) come from the caller's geometry. True if it
   * changed.
   */
  function apply(id, event, ctx = {}) {
    const joint = joints.get(id);
    if (!joint) return false;
    const fastener = transition(joint.fastener, event, {
      captured: ctx.captured != null,
      held: joint.kind === KIND.BOLT && isHeld(joint.hardware),
    });
    if (fastener === joint.fastener) return false;
    const next = { ...joint, fastener };
    if (joint.kind === KIND.FITTING) next.through = isFastened(fastener) ? (ctx.through ?? null) : null;
    if (joint.kind === KIND.CAM) next.captured = fastener.state === STATE.LOCKED ? (joint.captured ?? ctx.captured) : null;
    joints.set(id, next);
    return true;
  }

  /**
   * Drives a seated joint's fastener all the way home through the very events a player's
   * hands send — one tap, or one full turn of the wrench or screwdriver — so a part can
   * start out fastened (the display shelf) by the same path the build takes, and come
   * apart by it too. `ctx` as for `apply`. True if the joint ended fastened.
   */
  function drive(id, ctx = {}) {
    const joint = joints.get(id);
    const event = joint && homeEvent(joint.kind);
    if (!event) return false;
    apply(id, event, ctx);
    return isFastened(joints.get(id).fastener);
  }

  /**
   * Lets go of `parts` wherever a joint holds them as its third party — neither its
   * hardware nor its host — each by its own reverse move: a cam locked on one of their
   * bolts turns open, a back fitting pressed through into one of them pulls back. The
   * joints stay seated where they are. A teardown that takes those parts away runs this
   * first, so nothing is left fastened to a part that has gone. Returns the ids changed.
   */
  function letGoOf(parts) {
    const set = new Set(parts);
    const reverse = (j) => {
      if (j.kind === KIND.CAM && j.fastener.state === STATE.LOCKED && set.has(j.captured)) {
        return { type: 'crank', radians: -FASTENER.quarterTurn };
      }
      if (j.kind === KIND.FITTING && set.has(j.through)) return { type: 'pull' };
      return null;
    };
    return all()
      .filter((j) => !set.has(j.hardware) && !set.has(j.host))
      .filter((j) => reverse(j) && apply(j.id, reverse(j)))
      .map((j) => j.id);
  }

  /**
   * A tap on `part` pushes home every tap-kind fastener touching it — a tapped dowel, or a
   * panel tapped down onto its dowels. `ctxFor(joint)` supplies per-joint context (a
   * back fitting's `through`). Returns the ids that changed.
   */
  function tap(part, ctxFor = () => ({})) {
    return jointsOf(part)
      .filter((j) => isTapKind(j.kind))
      .filter((j) => apply(j.id, { type: 'tap' }, ctxFor(j)))
      .map((j) => j.id);
  }

  /** Hosts a piece of fastened hardware joins, its first (embedding) host first. */
  function hostsOf(hardware) {
    const hosts = [];
    for (const j of fastenedOf(hardware)) {
      if (!hosts.includes(j.host)) hosts.push(j.host);
      if (j.through && !hosts.includes(j.through)) hosts.push(j.through);
      if (j.captured) {
        const host = screwedHost(j.captured);
        if (host && !hosts.includes(host)) hosts.push(host);
      }
    }
    return hosts;
  }

  /** True when a locked cam ties hosts `a` and `b` together. */
  function lockedBetween(a, b) {
    return all().some((j) => {
      if (j.kind !== KIND.CAM || j.fastener.state !== STATE.LOCKED) return false;
      const other = screwedHost(j.captured);
      return (j.host === a && other === b) || (j.host === b && other === a);
    });
  }

  /**
   * Fastened tap-kind joints `part` can be pulled out of: it was the part pushed into the
   * seat, and no locked cam binds the connection.
   */
  function pullable(part) {
    return all().filter((j) => {
      if (j.mover !== part || !isTapKind(j.kind) || !isFastened(j.fastener)) return false;
      return !hostsOf(j.hardware).some((other) => other !== j.host && lockedBetween(j.host, other));
    });
  }

  const canRelease = (part) => fastenersRelease(jointsOf(part).map((j) => j.fastener));

  /** For a tool seated on a head or slot: `{ tool, target }` joints, target null if none. */
  function crankTarget(tool) {
    const engagement = all().find((j) => j.hardware === tool && j.kind === KIND.TOOL);
    if (!engagement) return null;
    const target = all().find((j) => j.hardware === engagement.host && isCrankKind(j.kind)) ?? null;
    return { tool: engagement, target };
  }

  /** Screwed bolts — the only heads a cam can catch. */
  const screwedBolts = () => all().filter((j) => j.kind === KIND.BOLT && isFastened(j.fastener));

  /** Every part reachable from `part` through fastened joints (itself included). */
  function compoundOf(part) {
    const edges = new Map();
    const link = (a, b) => {
      if (!edges.has(a)) edges.set(a, []);
      if (!edges.has(b)) edges.set(b, []);
      edges.get(a).push(b);
      edges.get(b).push(a);
    };
    for (const j of all()) {
      if (!isFastened(j.fastener)) continue;
      link(j.hardware, j.host);
      if (j.through) link(j.hardware, j.through);
      if (j.captured) link(j.hardware, j.captured);
    }
    const seen = new Set([part]);
    const queue = [part];
    while (queue.length) for (const next of edges.get(queue.shift()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }

  // Hardware's pose in its host's frame with its end `sink` deep in the hole: axis exactly
  // reversed against the hole's, twist about it kept from the current poses.
  function seatedPose(joint, poseOf, sink) {
    const h = hardwareConnector(joint);
    const o = hostConnector(joint);
    const current = relativePose(poseOf(joint.host), poseOf(joint.hardware)).rotation;
    const rotation = normalize(multiplyQuaternions(rotationBetween(rotateVector(current, h.axis), negate(o.axis)), current));
    const target = sub(o.position, scale(o.axis, sink));
    return { anchor: sub(target, rotateVector(rotation, h.position)), rotation };
  }

  /** World pose of a joint's hardware sitting at the hole's mouth, its host where it is now. */
  function restPose(id, poseOf) {
    const joint = joints.get(id);
    const host = poseOf(joint.host);
    const rel = seatedPose(joint, poseOf, 0);
    return {
      position: add(host.position, rotateVector(host.rotation, rel.anchor)),
      rotation: normalize(multiplyQuaternions(host.rotation, rel.rotation)),
    };
  }

  // World-joint frame: the same physical point in each body's frame, plus b's rest rotation
  // in a's frame. `pivot` is b-local — where the connection bends under play.
  const jointFrame = (rel, pivot) => ({
    anchorA: add(rel.anchor, rotateVector(rel.rotation, pivot)),
    anchorB: pivot,
    rotation: rel.rotation,
  });

  /** b's pose in a's frame from a live pose snapshot; `pivotWorld` mapped into b. */
  function currentFrame(a, b, pivotWorld, poseOf) {
    const pb = poseOf(b);
    return jointFrame(relativePose(poseOf(a), pb), rotateVector(conjugate(pb.rotation), sub(pivotWorld, pb.position)));
  }

  /**
   * The physics joints the graph calls for, from `poseOf(partId)`:
   * `{ key, a, b, mode: 'embed' | 'rigid' | 'play', frame: { anchorA, anchorB, rotation }, signature }`.
   * A bond whose `signature` is unchanged needs no rebuild — frames taken from live poses
   * are only meaningful when the bond is first made.
   */
  function bonds(poseOf) {
    const out = [];
    const bridges = new Map();
    const addBridge = (entry) => {
      const key = pairKey(entry.a, entry.b);
      if (!bridges.has(key)) bridges.set(key, []);
      bridges.get(key).push(entry);
    };

    const hardwareParts = new Set(all().filter((j) => isFastened(j.fastener)).map((j) => j.hardware));
    for (const hardware of hardwareParts) {
      const fastened = fastenedOf(hardware);
      const [first] = fastened;
      const sink = sinkOf(first);
      // A shelf pin stays solid so a shelf can rest on it; anything else sits inside wood.
      const mode = first.kind === KIND.PIN ? 'rigid' : 'embed';
      out.push({
        key: `embed:${hardware}`,
        a: first.host,
        b: hardware,
        mode,
        frame: jointFrame(seatedPose(first, poseOf, sink), hardwareConnector(first).position),
        signature: `${mode}|${first.id}|${sink}`,
      });

      const hosts = hostsOf(hardware);
      for (const other of hosts.slice(1)) {
        const second = fastened.find((j) => j.host === other);
        if (isTapKind(first.kind) && second && isTapKind(second.kind)) {
          // Through a dowel: each end sits its sink deep, so the hosts close up flush.
          const inFirst = seatedPose(first, poseOf, sinkOf(first));
          const inSecond = seatedPose(second, poseOf, sinkOf(second));
          addBridge({
            a: first.host,
            b: other,
            rigid: false,
            via: `${first.id}+${second.id}`,
            frame: () => jointFrame(compose(inFirst, invert(inSecond)), hostConnector(second).position),
          });
        } else {
          // A back fitting into what lies behind, or a cam onto another host's bolt: as they are.
          const pivot = connectorInWorld(hostConnector(first), poseOf(first.host)).position;
          addBridge({
            a: first.host,
            b: other,
            rigid: first.kind === KIND.CAM,
            via: null,
            frame: () => currentFrame(first.host, other, pivot, poseOf),
          });
        }
      }
    }

    for (const [key, entries] of bridges) {
      const chosen = entries.find((e) => e.via) ?? entries[0];
      const mode = entries.some((e) => e.rigid) ? 'rigid' : 'play';
      out.push({
        key: `bridge:${key}`,
        a: chosen.a,
        b: chosen.b,
        mode,
        frame: chosen.frame(),
        signature: `${mode}|${chosen.via ?? 'live'}`,
      });
    }
    return out;
  }

  return {
    seat,
    unseat,
    apply,
    drive,
    letGoOf,
    tap,
    pullable,
    canRelease,
    crankTarget,
    screwedBolts,
    compoundOf,
    bonds,
    restPose,
    jointsOf,
    hardwareConnector,
    hostConnector,
    get: (id) => joints.get(id) ?? null,
    all,
  };
}
