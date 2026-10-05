// The booklet's contents, as data: which parts, which seated pairs and how much hardware
// each page shows, in the adapted order of the real flatpack manual (the carcass is built
// flat on its side, tipped upright, then fitted out). Pure — the pages are drawn by
// src/scene/bookletPages.js and read by the per-page highlight; nothing here (or anywhere)
// checks a player's build against them. The booklet is reference; the player judges.

import { CONNECTOR, MANIFEST, PART_TYPES } from './catalog.js';
import { createAssembledLayout } from './assembledLayout.js';
import { kindOf } from './fasteners.js';

const DOWEL = kindOf(CONNECTOR.DOWEL_END);
const BOLT = kindOf(CONNECTOR.BOLT_THREAD);
const CAM = kindOf(CONNECTOR.CAM_LOCK_BODY);
const PIN = kindOf(CONNECTOR.PIN_TIP);
const FITTING = kindOf(CONNECTOR.BACK_FITTING_TIP);

const HORIZONTALS = ['plinth', 'bottom', 'fixed', 'top'];

/**
 * The twelve build steps. Each selects the joints it seats from the assembled layout
 * (`seats`), the panels it brings in (`roles`), the earlier cams it turns (`turns`), the
 * tool in hand, and how the carcass lies: on its left side, face down, or standing.
 */
const STEPS = [
  // ① Dowels into the horizontal parts' ends.
  { roles: HORIZONTALS, seats: (j, ctx) => j.kind === DOWEL && ctx.isHorizontal(j.host), pose: 'parts' },
  // ② Cam bolts screwed into both sides.
  { roles: ['leftSide', 'rightSide'], seats: (j) => j.kind === BOLT, tool: 'allenWrench', pose: 'parts' },
  // ③ The horizontals pressed down onto the left side, lying flat.
  { seats: (j, ctx) => j.kind === DOWEL && j.host === ctx.left, pose: 'lying' },
  // ④ Cams dropped into the recesses at the left side's end.
  { seats: (j, ctx) => j.kind === CAM && ctx.boltSide(j) === ctx.left, pose: 'lying' },
  // ⑤ …and turned to lock.
  { turns: (j, ctx) => j.kind === CAM && ctx.boltSide(j) === ctx.left, tool: 'screwdriver', pose: 'lying' },
  // ⑥ The right side pressed on top.
  { seats: (j, ctx) => j.kind === DOWEL && j.host === ctx.right, pose: 'lying' },
  // ⑦ Cams into the right side's end, turned to lock.
  {
    seats: (j, ctx) => j.kind === CAM && ctx.boltSide(j) === ctx.right,
    turns: (j, ctx) => j.kind === CAM && ctx.boltSide(j) === ctx.right,
    tool: 'screwdriver',
    pose: 'lying',
  },
  // ⑧ Turned face down, the back panel laid on.
  { roles: ['back'], pose: 'faceDown' },
  // ⑨ Back fittings pressed through it.
  { seats: (j) => j.kind === FITTING, pose: 'faceDown' },
  // ⑩ Tipped upright — two people.
  { tip: true, pose: 'upright' },
  // ⑪ Shelf pins into the sides.
  { seats: (j) => j.kind === PIN, pose: 'upright' },
  // ⑫ Shelves lowered onto them.
  { roles: ['shelf'], pose: 'upright' },
];

/**
 * The build pages, in order: `{ number, pose, parts, joints, turns, hardware, tool, tip }`.
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
 *              hardware only once its panel is there (a side fitted with bolts on a
 *              loose-parts page waits off the drawing until a later step puts it on)
 *   tool     — the tool in hand ('allenWrench', 'screwdriver') or null
 *   pose     — 'parts' (loose), 'lying' (carcass on its left side), 'faceDown' (on its
 *              front, back up) or 'upright'
 */
export function createBuildSteps(layout = createAssembledLayout()) {
  const roleOf = new Map(layout.parts.map((p) => [p.id, p.role]));
  const typeById = new Map(layout.parts.map((p) => [p.id, p.type]));
  const typeOf = (id) => typeById.get(id);
  const idsWithRole = (role) => layout.parts.filter((p) => p.role === role).map((p) => p.id);
  const [left] = idsWithRole('leftSide');
  const [right] = idsWithRole('rightSide');
  const boltHost = new Map(layout.joints.filter((j) => j.kind === BOLT).map((j) => [j.hardware, j.host]));
  const ctx = {
    left,
    right,
    isHorizontal: (id) => HORIZONTALS.includes(roleOf.get(id)),
    boltSide: (joint) => boltHost.get(joint.captured) ?? null,
  };
  const select = (test) => (test ? layout.joints.flatMap((j, i) => (test(j, ctx) ? [i] : [])) : []);

  const counted = new Set();
  const pages = STEPS.map((step, n) => {
    const joints = select(step.seats);
    const fresh = [...new Set(joints.map((i) => layout.joints[i].hardware))].filter((id) => !counted.has(id));
    for (const id of fresh) counted.add(id);
    const acted = [...joints, ...select(step.turns)].flatMap((i) => [layout.joints[i].hardware, layout.joints[i].host]);
    const types = new Set([...(step.roles ?? []).flatMap(idsWithRole), ...acted].map(typeOf));
    if (step.tool) types.add(step.tool);
    return {
      number: n + 1,
      pose: step.pose,
      parts: (step.roles ?? []).flatMap(idsWithRole),
      joints,
      turns: select(step.turns),
      hardware: countHardware(fresh, typeOf),
      types: [...types],
      tool: step.tool ?? null,
      tip: step.tip ?? false,
    };
  });
  for (const page of pages) page.shown = shownBy(pages, page.number, layout);
  return pages;
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
function countHardware(pieces, typeOf) {
  const counts = new Map();
  for (const id of pieces) counts.set(typeOf(id), (counts.get(typeOf(id)) ?? 0) + 1);
  return [...counts].map(([type, count]) => ({ type, count, partNumber: PART_TYPES[type].partNumber }));
}

/**
 * The whole booklet, front to back — as the real manual runs: cover, the warnings and
 * do/don't pages, the inventory of what is in the box, every build step, and the back
 * cover. `{ kind, ... }` records; 'step' pages carry a build step's fields.
 */
export function createBooklet(manifest = MANIFEST, layout = createAssembledLayout()) {
  const counts = new Map();
  for (const { type } of manifest) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [
    { kind: 'cover' },
    // A lone figure struggling with a panel; a second figure joins and all is well.
    { kind: 'warning', subject: 'twoPeople' },
    // A cross over the bare hard floor, a tick over the panel laid on its flattened box.
    { kind: 'doDont', subject: 'protectFloor' },
    // A tick over the screwdriver turned by hand, a cross over a power drill.
    { kind: 'doDont', subject: 'noPowerTools' },
    {
      kind: 'inventory',
      items: [...counts].map(([type, count]) => ({ type, count, partNumber: PART_TYPES[type].partNumber })),
    },
    ...createBuildSteps(layout).map((step) => ({ kind: 'step', ...step })),
    { kind: 'backCover' },
  ];
}
