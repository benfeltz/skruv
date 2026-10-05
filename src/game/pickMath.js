// Fat-finger picking: which part a press means when small hardware sits near a panel.
// Pure: plain [x, y, z] arrays and hit records in, a hit out, so Vitest covers it
// headlessly. src/scene/gestureRouter.js raycasts the real meshes and each small part's
// invisible, oversized hit proxy, measures how far the ray passes from the real part, and
// asks `preferHit` which one the finger meant.

const SEARCH_STEPS = 60;

/** A part this size (catalog [x, y, z]) is small — hardware or a tool, never a panel. */
export const isSmallPart = (size, { smallPartMax }) => Math.max(...size) < smallPartMax;

/** Distance from point `p` to an origin-centred box of half-extents `half`. */
function pointBoxGap(p, half) {
  const outside = p.map((v, i) => Math.max(0, Math.abs(v) - half[i]));
  return Math.hypot(...outside);
}

/** Distance along the ray to where it enters an origin-centred box (slab test), or null. */
function rayBoxEntry(origin, direction, half) {
  let near = 0;
  let far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-12) {
      if (Math.abs(origin[i]) > half[i]) return null;
      continue;
    }
    const a = (-half[i] - origin[i]) / direction[i];
    const b = (half[i] - origin[i]) / direction[i];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return near <= far ? near : null;
}

/**
 * How the ray `origin + t·direction` (t ≥ 0, `direction` unit length) meets an
 * origin-centred box with half-extents `half`, both in the box's own frame:
 * `{ miss, depth }` — the closest it passes (0 when it goes through), and how far along
 * the ray the box is (where it enters, else where it passes closest). The gap along a ray
 * is convex in t, so a ternary search finds the closest approach.
 */
export function rayBoxReach(origin, direction, half) {
  const entry = rayBoxEntry(origin, direction, half);
  if (entry !== null) return { miss: 0, depth: entry };
  let lo = 0;
  let hi = Math.hypot(...origin) + 2 * Math.hypot(...half);
  const gapAt = (t) => pointBoxGap(origin.map((v, i) => v + direction[i] * t), half);
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (gapAt(a) <= gapAt(b)) hi = b;
    else lo = a;
  }
  const t = (lo + hi) / 2;
  return { miss: gapAt(t), depth: t };
}

/** Closest the ray passes to the box — `rayBoxReach`'s miss. */
export const rayBoxGap = (origin, direction, half) => rayBoxReach(origin, direction, half).miss;

/**
 * What a press picks, from the nearest real-mesh hit `partHit` (`{ part, distance, ... }`
 * or null) and the small parts' proxy hits `proxyHits` (`[{ part, distance, miss, depth,
 * ... }]`, where `miss` is how far the ray passes from the real part and `depth` how far
 * along the ray the real part is — `rayBoxReach` — in metres; depth defaults to distance).
 *
 * A small part wins only when the finger is genuinely over it — its `miss` within
 * `fingerRadius` (radians: the finger's angular radius, so metres at the hit's distance)
 * and the real part not behind the real hit: a fat proxy poking out of a panel never makes
 * the fastener sunk inside it pickable through it — the nearest such one if several are. Otherwise
 * the real hit stands, so a panel grabbed near hardware stays the panel. With no real hit
 * at all, the nearest proxy is the press (there is nothing it could hijack).
 */
export function preferHit(partHit, proxyHits, { fingerRadius }) {
  const visible = proxyHits.filter(
    (hit) => !partHit || hit.part === partHit.part || (hit.depth ?? hit.distance) <= partHit.distance,
  );
  const nearest = (hits) => hits.reduce((best, hit) => (!best || hit.distance < best.distance ? hit : best), null);
  const under = nearest(visible.filter((hit) => hit.miss <= fingerRadius * hit.distance));
  if (under) return under.part === partHit?.part ? partHit : under;
  return partHit ?? nearest(visible);
}
