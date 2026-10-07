// The booklet's contents, worked out from the pack's manual pages (items/johnny's
// `manual.pages`): which parts, which seated pairs and how much hardware each page shows.
// The pages name their fastener-to-hole pairs; everything a drawing needs beyond that —
// count bubbles, the part types to highlight, what is already on the carcass — is computed
// here. Pure: the pages are drawn by src/scene/bookletPages.js and read by the per-page
// highlight; nothing here (or anywhere) checks a player's build against them. The booklet
// is reference; the player judges.

const jointKey = (hardware, hardwareConnector, host, hostConnector) => `${hardware}#${hardwareConnector}|${host}#${hostConnector}`;

/**
 * Indices into `layout.joints` of `pairs` (`[end, hole]` connector references, resolved by
 * `resolve`), in the page's order. A pair that names no joint is the validator's to report;
 * here it throws.
 */
function jointIndices(pairs = [], layout, resolve) {
  const index = new Map(layout.joints.map((j, i) => [jointKey(j.hardware, j.hardwareConnector, j.host, j.hostConnector), i]));
  return pairs.map(([end, hole]) => {
    const a = resolve(end);
    const b = resolve(hole);
    const i = index.get(jointKey(a.part, a.connector, b.part, b.connector));
    if (i === undefined) throw new Error(`${end} → ${hole} is no joint of the assembled item`);
    return i;
  });
}

/**
 * The build pages, in order: `{ number, pose, parts, joints, turns, hardware, types, tool,
 * tip, shown }`.
 *   parts    — ids of the panels this page brings in (first appearance)
 *   joints   — indices into `layout.joints` this page seats (and fastens)
 *   turns    — indices of the cam joints this page locks
 *   hardware — `[{ type, count, partNumber }]` count bubbles for the hardware first seated
 *              here (a dowel already in a panel end is not counted again when a side goes on)
 *   types    — the part types the page is about (its panels, the hardware it seats or
 *              turns, the panels that hardware goes into, the tool) — what the per-page
 *              highlight pulses in the room, an aid only
 *   shown    — ids of everything in place once the page is done, as its drawing shows the
 *              carcass: a panel only once a built page brings it in or seats it, and
 *              hardware only once its panel is there
 *   tool     — the tool in hand ('allenWrench', 'screwdriver') or null
 *   tip      — the page tips the carcass upright (a 'special' tipUpright page)
 *   pose     — 'parts' (loose), 'lying' (carcass on its left side), 'faceDown' (on its
 *              front, back up) or 'upright'
 */
export function createBuildSteps(pages, { layout, partTypes, resolve }) {
  const typeById = new Map(layout.parts.map((p) => [p.id, p.type]));
  const typeOf = (id) => typeById.get(id);
  const counted = new Set();
  const steps = pages
    .filter((page) => page.kind === 'step' || page.kind === 'special')
    .map((page) => {
      const parts = page.parts ?? [];
      const joints = jointIndices(page.fasten, layout, resolve);
      const turns = jointIndices(page.turn, layout, resolve);
      const fresh = [...new Set(joints.map((i) => layout.joints[i].hardware))].filter((id) => !counted.has(id));
      for (const id of fresh) counted.add(id);
      const acted = [...joints, ...turns].flatMap((i) => [layout.joints[i].hardware, layout.joints[i].host]);
      const types = new Set([...parts, ...acted].map(typeOf));
      if (page.tool) types.add(page.tool);
      return {
        number: page.number,
        pose: page.pose,
        parts,
        joints,
        turns,
        hardware: countHardware(fresh, typeOf, partTypes),
        types: [...types],
        tool: page.tool ?? null,
        tip: page.special === 'tipUpright',
      };
    });
  for (const step of steps) step.shown = shownBy(steps, step.number, layout);
  return steps;
}

// What is in place once page `n` is done. Loose-parts pages prepare pieces off to the side;
// a panel joins the carcass when a built page brings it in or seats something in it, or
// seats hardware that already sits in it (the horizontals, via their dowels, when the side
// goes on). Hardware shows once the panel it is in has joined.
function shownBy(pages, n, layout) {
  const done = pages.filter((p) => p.number <= n);
  const built = done.filter((p) => p.pose !== 'parts');
  const seatedBy = (ps) => ps.flatMap((p) => p.joints.map((i) => layout.joints[i]));
  const panels = new Set(built.flatMap((p) => p.parts));
  for (const joint of seatedBy(built)) {
    panels.add(joint.host);
    for (const earlier of seatedBy(done)) if (earlier.hardware === joint.hardware) panels.add(earlier.host);
  }
  const hardware = seatedBy(done).filter((j) => panels.has(j.host)).map((j) => j.hardware);
  return [...new Set([...panels, ...hardware])];
}

// One bubble per hardware type: how many pieces of it the page adds.
function countHardware(pieces, typeOf, partTypes) {
  const counts = new Map();
  for (const id of pieces) counts.set(typeOf(id), (counts.get(typeOf(id)) ?? 0) + 1);
  return [...counts].map(([type, count]) => ({ type, count, partNumber: partTypes[type].partNumber }));
}

/**
 * The whole booklet, front to back, as the pack's manual runs: `{ kind, ... }` records —
 * 'cover', 'warning' and 'doDont' (with their `subject`), 'inventory' (with `items`: every
 * instance in the box counted by type, spares and tools included), 'step' (a build step's
 * fields; a 'special' page is a step that tips) and 'backCover'.
 */
export function createBooklet(pages, { layout, manifest, partTypes, resolve }) {
  const steps = createBuildSteps(pages, { layout, partTypes, resolve });
  let next = 0;
  return pages.map((page) => {
    switch (page.kind) {
      case 'step':
      case 'special':
        return { kind: 'step', ...steps[next++] };
      case 'inventory': {
        const counts = new Map();
        for (const { type } of manifest) counts.set(type, (counts.get(type) ?? 0) + 1);
        return { kind: 'inventory', items: [...counts].map(([type, count]) => ({ type, count, partNumber: partTypes[type].partNumber })) };
      }
      case 'back':
        return { kind: 'backCover' };
      case 'warning':
      case 'doDont':
        return { kind: page.kind, subject: page.subject };
      default:
        return { kind: page.kind };
    }
  });
}
