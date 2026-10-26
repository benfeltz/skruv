// The booklet's contents, worked out from the pack's manual pages (items/johnny's
// `manual.pages`): which parts, which seated pairs and how much hardware each page shows.
// The pages name their fastener-to-hole pairs; everything a drawing needs beyond that —
// count bubbles, the part types to highlight, what is already on the carcass — is computed
// here. Pure: the pages are drawn by src/scene/bookletPages.ts and read by the per-page
// highlight; nothing here (or anywhere) checks a player's build against them. The booklet
// is reference; the player judges.

import type { ConnectorName, DrawingPose, GamePartType, InstanceId, Joint, ManifestEntry, PageFields, Resolver } from './item.js';
import type { Scheme } from './controlsPage.js';
import { KIND } from '../../tools/validate/lib/vocabulary.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';

/** The assembled item the booklet draws: its parts and derived joints (item.ts ASSEMBLED). */
export interface BookletLayout {
  parts: readonly { id: InstanceId; type: string }[];
  joints: readonly Joint[];
}

/** A count bubble: how many of a part type, and its part number. */
export interface PartCount {
  type: string;
  count: number;
  partNumber: string;
}

/** One build page — see `createBuildSteps`. */
export interface BuildStep {
  number: number;
  pose: DrawingPose;
  parts: InstanceId[];
  joints: number[];
  turns: number[];
  hardware: PartCount[];
  types: string[];
  tool: string | null;
  tip: boolean;
  shown: InstanceId[];
  assembly: string | null;
  install: { name: string; members: InstanceId[] } | null;
}

/**
 * A page the game adds to every booklet, whatever the pack's manual says: the controls for
 * the device in hand, and for the item's own fasteners (src/game/controlsPage.ts). The
 * site's own pages join this union.
 */
export type GamePage = { kind: 'controls'; scheme: Scheme; kinds: readonly FastenerKind[] };

/** The pages the game adds to the booklet, in order, for a device using `scheme` and an item using `kinds`. */
export const gamePagesFor = (scheme: Scheme, kinds: ReadonlySet<FastenerKind>): GamePage[] => [{ kind: 'controls', scheme, kinds: [...kinds] }];

/** One booklet page as drawn — see `createBooklet`. */
export type BookletPage =
  | GamePage
  | ({ kind: 'step' } & BuildStep)
  | { kind: 'inventory'; items: PartCount[] }
  | { kind: 'backCover' }
  | { kind: 'warning'; subject: string }
  | { kind: 'doDont'; subject: string }
  | { kind: 'cover' };

type PartTypes = Readonly<Record<string, Pick<GamePartType, 'partNumber'>>>;

const jointKey = (hardware: InstanceId, hardwareConnector: number, host: InstanceId, hostConnector: number) => `${hardware}#${hardwareConnector}|${host}#${hostConnector}`;

/**
 * Indices into `layout.joints` of `pairs` (`[end, hole]` connector references, resolved by
 * `resolve`), in the page's order. A pair that names no joint is the validator's to report;
 * here it throws.
 */
function jointIndices(pairs: [ConnectorName, ConnectorName][] = [], layout: BookletLayout, resolve: Resolver) {
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
 *              hardware only once its panel is there. A tagged page shows its assembly
 *              alone; an untagged page leaves an assembly out until its install page
 *   assembly — the sub-assembly this page builds, drawn alone (its `assembly`), or null
 *   install  — the sub-assembly this page brings in whole (its `install`) with its members,
 *              or null; the members are derived from the tagged pages, never listed
 *   tool     — the tool in hand ('allenWrench', 'screwdriver') or null
 *   tip      — the page tips the carcass upright (a 'special' tipUpright page)
 *   pose     — 'parts' (loose), 'lying' (carcass on its left side), 'faceDown' (on its
 *              front, back up), 'upright' or 'upsideDown' (a table turned over on its top)
 */
export function createBuildSteps(
  pages: PageFields[],
  { layout, partTypes, resolve }: { layout: BookletLayout; partTypes: PartTypes; resolve: Resolver },
): BuildStep[] {
  const typeById = new Map(layout.parts.map((p) => [p.id, p.type]));
  // Every id a page names is a part of the layout.
  const typeOf = (id: InstanceId) => typeById.get(id)!;
  const counted = new Set<InstanceId>();
  const stepPages = pages.filter((page) => page.kind === 'step' || page.kind === 'special');
  const steps = stepPages
    .map((page): Omit<BuildStep, 'shown' | 'install'> & Partial<Pick<BuildStep, 'shown' | 'install'>> => {
      const parts = page.parts ?? [];
      const joints = jointIndices(page.fasten, layout, resolve);
      const turns = jointIndices(page.turn, layout, resolve);
      const fresh = [...new Set(joints.map((i) => layout.joints[i].hardware))].filter((id) => !counted.has(id));
      for (const id of fresh) counted.add(id);
      // A runner is furniture, not the page's hardware: a slide's rail end is never counted.
      const slideOnly = (id: InstanceId) => joints.filter((i) => layout.joints[i].hardware === id).every((i) => layout.joints[i].kind === KIND.SLIDE);
      const acted = [...joints, ...turns].flatMap((i) => [layout.joints[i].hardware, layout.joints[i].host]);
      const types = new Set([...parts, ...acted].map(typeOf));
      if (page.tool) types.add(page.tool);
      return {
        // Step and special pages always carry both.
        number: page.number!,
        pose: page.pose!,
        parts,
        joints,
        turns,
        hardware: countHardware(fresh.filter((id) => !slideOnly(id)), typeOf, partTypes),
        types: [...types],
        tool: page.tool ?? null,
        tip: page.special === 'tipUpright',
        assembly: page.assembly ?? null,
      };
    });
  const members = membersOf(steps, layout);
  // Install page number → the assembly it brings in.
  const installs = new Map(stepPages.filter((page) => page.install !== undefined).map((page) => [page.number!, page.install!]));
  for (const step of steps) {
    step.shown = shownFor(steps, step, layout, members, installs);
    const name = installs.get(step.number);
    step.install = name === undefined ? null : { name, members: members.get(name) ?? [] };
    step.types = [...new Set([...step.types, ...step.install?.members.map(typeOf) ?? []])];
  }
  // Every step's `shown` is set just above.
  return steps as BuildStep[];
}

/**
 * The members of each sub-assembly, in first-seen order: the parts its tagged pages bring in
 * plus the hardware those pages seat. Derived, never listed in the pack.
 */
export function membersOf(steps: Pick<BuildStep, 'assembly' | 'parts' | 'joints'>[], layout: BookletLayout): Map<string, InstanceId[]> {
  const members = new Map<string, Set<InstanceId>>();
  for (const step of steps) {
    if (step.assembly === null) continue;
    const set = members.get(step.assembly) ?? new Set<InstanceId>();
    for (const id of step.parts) set.add(id);
    for (const i of step.joints) set.add(layout.joints[i].hardware);
    members.set(step.assembly, set);
  }
  return new Map([...members].map(([name, set]) => [name, [...set]]));
}

// What page `step` shows. A tagged page shows its assembly's pages alone; any other page
// shows what the untagged pages have built plus every member of each assembly installed
// on or before it, so a member never appears before its install.
function shownFor(
  steps: Pick<BuildStep, 'number' | 'pose' | 'parts' | 'joints' | 'assembly'>[],
  step: Pick<BuildStep, 'number' | 'assembly'>,
  layout: BookletLayout,
  members: Map<string, InstanceId[]>,
  installs: Map<number, string>,
) {
  if (step.assembly !== null) return shownBy(steps.filter((p) => p.assembly === step.assembly), step.number, layout);
  const installed = [...installs].filter(([number]) => number <= step.number).flatMap(([, name]) => members.get(name) ?? []);
  return [...new Set([...shownBy(steps.filter((p) => p.assembly === null), step.number, layout), ...installed])];
}

// What is in place once page `n` is done. Loose-parts pages prepare pieces off to the side;
// a panel joins the carcass when a built page brings it in or seats something in it, or
// seats hardware that already sits in it (the horizontals, via their dowels, when the side
// goes on). Hardware shows once the panel it is in has joined.
function shownBy(pages: Pick<BuildStep, 'number' | 'pose' | 'parts' | 'joints'>[], n: number, layout: BookletLayout) {
  const done = pages.filter((p) => p.number <= n);
  const built = done.filter((p) => p.pose !== 'parts');
  const seatedBy = (ps: typeof pages) => ps.flatMap((p) => p.joints.map((i) => layout.joints[i]));
  const panels = new Set(built.flatMap((p) => p.parts));
  for (const joint of seatedBy(built)) {
    panels.add(joint.host);
    for (const earlier of seatedBy(done)) if (earlier.hardware === joint.hardware) panels.add(earlier.host);
  }
  const hardware = seatedBy(done).filter((j) => panels.has(j.host)).map((j) => j.hardware);
  return [...new Set([...panels, ...hardware])];
}

// One bubble per hardware type: how many pieces of it the page adds.
function countHardware(pieces: InstanceId[], typeOf: (id: InstanceId) => string, partTypes: PartTypes): PartCount[] {
  const counts = new Map<string, number>();
  for (const id of pieces) counts.set(typeOf(id), (counts.get(typeOf(id)) ?? 0) + 1);
  // Hardware is the pack's, every type with a part number.
  return [...counts].map(([type, count]) => ({ type, count, partNumber: partTypes[type].partNumber! }));
}

/**
 * The whole booklet, front to back, as the pack's manual runs: `{ kind, ... }` records —
 * 'cover', 'warning' and 'doDont' (with their `subject`), 'inventory' (with `items`: every
 * instance in the box counted by type, spares and tools included), 'step' (a build step's
 * fields; a 'special' page is a step that tips) and 'backCover' — with the game's own
 * `gamePages`, in order, just before the back cover (at the end, if the pack has none).
 */
export function createBooklet(
  pages: PageFields[],
  {
    layout,
    manifest,
    partTypes,
    resolve,
    gamePages = [],
  }: { layout: BookletLayout; manifest: readonly ManifestEntry[]; partTypes: PartTypes; resolve: Resolver; gamePages?: readonly GamePage[] },
): BookletPage[] {
  const booklet = packPages(pages, { layout, manifest, partTypes, resolve });
  const back = booklet.findIndex((page) => page.kind === 'backCover');
  booklet.splice(back === -1 ? booklet.length : back, 0, ...gamePages);
  return booklet;
}

// The pack's own pages, as its manual runs.
function packPages(
  pages: PageFields[],
  { layout, manifest, partTypes, resolve }: { layout: BookletLayout; manifest: readonly ManifestEntry[]; partTypes: PartTypes; resolve: Resolver },
): BookletPage[] {
  const steps = createBuildSteps(pages, { layout, partTypes, resolve });
  let next = 0;
  return pages.map((page): BookletPage => {
    switch (page.kind) {
      case 'step':
      case 'special':
        return { kind: 'step', ...steps[next++] };
      case 'inventory': {
        const counts = new Map<string, number>();
        for (const { type } of manifest) counts.set(type, (counts.get(type) ?? 0) + 1);
        // Everything in the box is the pack's, every type with a part number.
        return { kind: 'inventory', items: [...counts].map(([type, count]) => ({ type, count, partNumber: partTypes[type].partNumber! })) };
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
