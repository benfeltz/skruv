import * as THREE from 'three';
import { PICK, RESET, ROOM } from '../constants.js';
import { createAssembly } from '../game/assembly.js';
import { EVENT, recoveryEvent, resetEvent } from '../game/events.js';
import { CUE, homeCue } from '../game/haptics.js';
import { ASSEMBLED, PART_TYPES } from '../game/item.js';
import { preferredRelatives } from '../game/panelFit.js';
import { createPartMesh } from '../game/partMesh.js';
import { hasEscaped } from '../game/dragMath.js';
import { fractionOf, heightAt, selectsDuringHold } from '../game/liftLine.js';
import { baseRest, boxPlacement, boxPoseOf, createPackedWorldLayout, lidRest, respawnSpots } from '../game/boxLayout.js';
import { isSmallPart } from '../game/pickMath.js';
import { createPivotPick } from './pivotPick.js';
import { createGhost } from './ghost.js';
import { createCompoundPhysics } from './compoundPhysics.js';
import { createDropGuide } from './dropGuide.js';
import { createTargetRings } from './targetRings.js';
import { createFlatpack } from './flatpack.js';
import { edgesGeometry, hullGeometry, inkEdges, inkHull } from './ink.js';
import type { Ink } from './ink.js';
import { createGestureRouter } from './gestureRouter.js';
import { createLiftHold, liftRangeOf } from './liftHold.js';
import { createGizmo } from './gizmo.js';
import { createHighlight } from './highlight.js';
import { createSprue } from './sprue.js';
import { createBookletSheet } from '../ui/booklet.js';
import { createLiftLine } from '../ui/liftLine.js';
import { createTurnRing } from '../ui/turnRing.js';
import { createInsetPanel } from './insetPanel.js';
import type { Bus } from '../game/events.js';
import type { Haptics } from '../game/haptics.js';
import type { PartId } from '../game/assembly.js';
import type { Part } from '../game/partMesh.js';
import type { PhysicsWorld } from '../physics/world.js';
import type { CameraControls } from './cameraControls.js';
import type { createBookletPages } from './bookletPages.js';
import type { Pose, Vec3 } from '../../tools/validate/lib/geometry.js';

/** The booklet's pages for the current item, as src/scene/bookletPages.ts draws them. */
export type BookletPages = Pick<ReturnType<typeof createBookletPages>, 'count' | 'pages' | 'canvas' | 'prerender' | 'dispose'>;

/** What an item world is built into: the engine that outlives every item (src/main.ts). */
export interface ItemWorldDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  physics: PhysicsWorld;
  cameraControls: CameraControls;
  events: Bus;
  haptics: Haptics;
  /** Whether rotation is free, or snapped to 90° detents (the persistent Snap rotate toggle). */
  isFree: () => boolean;
  /** The room's ink, so parts draw in the same line. */
  ink: Ink;
  /** Draws the current item's booklet pages. */
  pages: () => BookletPages;
}

/**
 * Everything one item brings into the room, built for the item src/game/item.ts serves
 * now: its flatpack and packed parts, the assembly graph and
 * the compound seam, the gizmo, the gesture router, the elevation line and Shift hold, the
 * booklet and its highlight, the detail inset, repack and the recovery sweep. Returns `{ update(delta),
 * render(renderer, scene), repack(), pickDistance, booklet, dispose() }`: the loop calls `update`
 * and, after the main render, `render` (the inset's one extra pass), the reset button
 * `repack`, the camera's pivot `pickDistance`. `dispose()` takes it all back out — meshes off
 * the scene, bodies out of the physics world, DOM nodes off the page, every listener it
 * bound unbound — so the room is as it was before it came; an item swap is `dispose()` then
 * another `createItemWorld`. A build that throws takes back what it had built before
 * rethrowing.
 */
export function createItemWorld(deps: ItemWorldDeps) {
  // Everything the world puts in the scene, the physics world, the page or the bus, each
  // with how to take it back — run last in, first out by dispose(), or straight away by a
  // build that throws half-way, so a failed pick leaves the room as it found it too. Every
  // release runs even if one before it throws: one bad step never strands the rest.
  const undo: (() => void)[] = [];
  const teardown = () => {
    const errors: unknown[] = [];
    while (undo.length) {
      try {
        undo.pop()!();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };
  try {
    const world = buildItemWorld(deps, undo);
    return {
      ...world,
      /** Takes the world back out, every release run; any that threw are thrown together after. */
      dispose() {
        const errors = teardown();
        if (errors.length) throw new AggregateError(errors, 'item world teardown: some releases threw');
      },
    };
  } catch (error) {
    // The build's own error is the one the caller sees; a release that also threw rides along.
    const errors = teardown();
    if (errors.length) throw new AggregateError([error, ...errors], `item world build failed: ${String(error)}`, { cause: error });
    throw error;
  }
}

export type ItemWorld = ReturnType<typeof createItemWorld>;

// The build: every acquisition pushes its own release onto `undo` as it happens.
function buildItemWorld({ scene, camera, domElement, physics, cameraControls, events, haptics, isFree, ink, pages }: ItemWorldDeps, undo: (() => void)[]) {
  const release = releaser(new Set<THREE.Material>([ink.lines, ink.hull]));
  const add = (...added: THREE.Object3D[]) => {
    scene.add(...added);
    // Off the scene, their GPU resources freed.
    undo.push(() => {
      scene.remove(...added);
      for (const object of added) object.traverse(release);
    });
  };
  // Every body this world registers goes on `undo` the moment it exists — out of the physics
  // world, its joints with it — the factory's (the box) included, so a factory
  // that throws half-way strands nothing it had already registered.
  const owning: PhysicsWorld = {
    ...physics,
    register(...args) {
      const body = physics.register(...args);
      undo.push(() => physics.remove(body));
      return body;
    },
  };

  // The game opens on the closed flatpack: every part packed flat inside, settling at once
  // and resting until the lid comes off and a hand disturbs it.
  const flatpack = createFlatpack(owning, ink);
  add(flatpack.base.mesh, flatpack.lid.mesh);

  // Every part wears the hull; a panel (drawn as its plain box) also its sharp edges, never a faceted round.
  // The outline geometry is built once per part type and shared by its instances, like the ghost's.
  const outlines = new Map<string, { hull: THREE.BufferGeometry; edges: ReturnType<typeof edgesGeometry> | null }>();
  const outline = (mesh: THREE.Mesh, type: string) => {
    let shared = outlines.get(type);
    if (!shared) {
      shared = { hull: hullGeometry(mesh.geometry), edges: mesh.userData.shaped ? null : edgesGeometry(mesh.geometry) };
      outlines.set(type, shared);
    }
    mesh.add(inkHull(shared.hull, ink.hull));
    if (shared.edges) mesh.add(inkEdges(shared.edges, ink.lines));
  };

  // One record per physical part — what gestures pick, drag and snap. The box and its lid
  // are ones too.
  const parts = [flatpack.base, flatpack.lid];
  for (const { id, type, position, rotation } of createPackedWorldLayout()) {
    const part = PART_TYPES[type];
    const mesh = createPartMesh(part);
    outline(mesh, type);
    const body = owning.register(mesh, {
      // map keeps the length; TS widens a mapped tuple to number[].
      halfExtents: part.size.map((d) => d / 2) as Vec3,
      // Every packed part is the pack's, with its mass.
      mass: part.mass!,
      position,
      rotation,
    });
    add(mesh);
    parts.push({ id, type, mesh, body });
  }

  // The camera pivots about the first of these along the middle of the screen as a gesture
  // starts: every part and the box, never the overlays.
  const pickDistance = createPivotPick(parts.map((part) => part.mesh));

  // What is seated on and fastened to what — every type-compatible pair, right or wrong.
  const typeById = new Map(parts.map(({ id, type }) => [id, type]));
  const assembly = createAssembly((id) => typeById.get(id)!);
  // Manipulation goes through these seams: a fastened compound moves as one, and while a
  // finger is on the elevation line its part is held in mid-air at the line's height.
  const hold = createLiftHold(createCompoundPhysics(physics, parts, assembly));
  undo.push(() => hold.end());
  const manipulation = hold;

  const gizmo = createGizmo({
    camera,
    domElement,
    physics: manipulation,
    isFree,
  });
  add(gizmo.object);

  // The booklet: pages drawn from the same models, flipped freely — reference, never a gate.
  // It arrives docked as the carousel strip along the bottom, in front of the catalog: BUILD
  // IT goes straight into the room, so nothing opens on a pick (Ben, 1.9.1). It never blocks
  // the room — no scrim: only the strip and the open page take input, so the camera and the
  // parts stay live around them (1.9.1.2).
  const bookletPages = pages();
  undo.push(() => bookletPages.dispose());
  const booklet = createBookletSheet({ pages: bookletPages, open: false, docked: 'strip', blocking: false });
  document.body.append(booklet.thumb, booklet.element);
  undo.push(() => booklet.dispose());

  // The centre page's parts glow, whether or not it is open — the player's own set only,
  // never the box and its lid. A page with no parts (cover, inventory, controls) lights none.
  const playerParts = parts.filter((part) => part !== flatpack.base && part !== flatpack.lid);
  const highlight = createHighlight(playerParts);
  const light = (page: number) => {
    const shown = bookletPages.pages[page];
    highlight.show(shown.kind === 'step' ? shown.types : []);
  };
  booklet.onChange(({ page }) => light(page));
  light(booklet.currentPage);

  const ghost = createGhost();
  add(ghost.object);

  // While a part is dragged: where it would land, and the hole it would drop onto.
  const dropGuide = createDropGuide();
  add(dropGuide.object);

  // While a tool is carried: rings on the fasteners it can work right now.
  const targetRings = createTargetRings();
  add(targetRings.object);

  // A model-kit handle on a selected fastener or tool, to drag millimetre hardware by.
  const sprue = createSprue();
  add(sprue.object);

  // The box drags but never takes the gizmo: tapping it is tapping the room. While the line
  // holds a part, a tap on the room puts its rings away (a drag then moves it) and one on the
  // part brings them back (to turn it); no other part is picked.
  function select(part: Part | null) {
    if (!selectsDuringHold(part === flatpack.base ? null : part, hold.held)) return;
    if (!part || part === flatpack.base) {
      gizmo.hide();
      sprue.hide();
      return;
    }
    gizmo.show(part);
    if (isSmallPart(PART_TYPES[part.type].size, PICK)) sprue.show(part);
    else sprue.hide();
  }

  // On a seated tool: the dial showing which way and how far to turn it.
  const turnRing = createTurnRing(document.body);
  undo.push(() => turnRing.element.remove());

  // The live detail inset: a circle of paper showing the joint a carried part nears or an engaged tool works.
  const insetPanel = createInsetPanel({ domElement, camera, container: document.body, lines: ink.lines });
  undo.push(() => insetPanel.dispose());

  const router = createGestureRouter({
    domElement,
    camera,
    cameraControls,
    physics: manipulation,
    parts,
    assembly,
    rings: gizmo,
    // Tap a part to select it (unless the tap pushed a fastener home); tap empty space to
    // deselect.
    onTap: select,
    ghost,
    sprue,
    dropGuide,
    targetRings,
    events,
    hold,
    turnRing,
    inset: insetPanel.hook,
    // Where each panel goes in the finished item: offered first, never a gate.
    relatives: preferredRelatives(ASSEMBLED, PART_TYPES),
    // One tick a frame, however many eighths the turn crossed: a buzz can't land faster.
    onRatchet: () => haptics.cue(CUE.TICK),
    // A fastener backed off partway and turned home again buzzes as its first arrival did.
    onRehome: (kind) => {
      const cue = homeCue(kind);
      if (cue) haptics.cue(cue);
    },
  });
  // It lets go of any gesture and unbinds from the room's canvas.
  undo.push(() => router.dispose());
  // The line keeps whatever a panel carries (its dowels, its assembly) off the floor too: the router knows what it carries.
  hold.measure(router.verticalReachOf);

  // Where the box sits now, as the level, in-room box frame the layout hangs off.
  function boxPose() {
    const { x, y, z } = flatpack.base.body.translation();
    const r = flatpack.base.body.rotation();
    return boxPoseOf({ position: [x, y, z], rotation: [r.x, r.y, r.z, r.w] });
  }

  // Repack: the player's parts come apart by the normal teardown and go back into the box
  // as packed, lid on — wherever the box has been dragged to, stood upright there first if
  // it was left tilted.
  function repack() {
    hold.end();
    events.emit(resetEvent());
    router.unseatAll(playerParts.map((part) => part.id));
    select(null);
    insetPanel.reset();
    const box = boxPose();
    const upright = baseRest(box);
    physics.place(flatpack.base.body, upright.position, upright.rotation);
    const packedPose = new Map<PartId, Pose>([[flatpack.lid.id, lidRest(box)], ...createPackedWorldLayout(box).map((p): [PartId, Pose] => [p.id, p])]);
    for (const { id, body } of [...playerParts, flatpack.lid]) {
      const { position, rotation } = packedPose.get(id)!;
      physics.place(body, position, rotation);
    }
  }

  // The elevation line's part: the one being moved (never cranked or pulled, nor a compound,
  // whose range is not one part's), else the selected one — never the box, nor a part
  // sitting in a seat unless it is a panel the router carries with all it holds (its
  // assembly, its dowels), standing on nothing else.
  function liftablePart() {
    if (hold.held) return hold.held;
    const dragging = router.dragging;
    const part = dragging ? (dragging.mode === 'move' ? dragging.part : null) : gizmo.selected;
    if (!part || part === flatpack.base) return null;
    return dragging || assembly.jointsOf(part.id).length === 0 || router.carries(part) ? part : null;
  }

  const rangeOf = (part: Part) => liftRangeOf(part, part.mesh.quaternion.toArray(), router.verticalReachOf);
  const heightOf = (part: Part) => (hold.held === part ? hold.height : part.mesh.position.y);

  // A finger on the line holds the part: a press on the line eases it toward the finger, one
  // on the knob drags it 1:1 from where it is. Letting go hands it back to gravity — unless
  // Shift still keeps it up.
  let knobOffset: number | null = null;
  function liftTo(fraction: number) {
    const part = hold.held;
    if (!part) return;
    if (knobOffset === null) hold.target(heightAt(fraction, rangeOf(part)));
    else hold.jump(heightAt(fraction + knobOffset, rangeOf(part)));
  }
  const liftLine = createLiftLine({
    onPress(fraction, onKnob) {
      const part = liftablePart();
      if (!part) return;
      hold.begin(part, 'line');
      knobOffset = onKnob ? fractionOf(heightOf(part), rangeOf(part)) - fraction : null;
      liftTo(fraction);
    },
    onMove: liftTo,
    onRelease: () => hold.end('line'),
  });
  document.body.append(liftLine.element);
  undo.push(() => liftLine.element.remove());

  // Shift is the desktop's finger on the line: while it is down, the part the line would lift
  // stays where it is — the pointer free to turn it, drag it (across the floor, as any drag)
  // or orbit, and Shift + scroll sets its height (src/scene/gestureRouter.ts) — and letting
  // go drops it. Window-level, so it counts wherever focus sits.
  let shiftDown = false;
  function onShift(event: KeyboardEvent) {
    if (event.key !== 'Shift') return;
    shiftDown = event.type === 'keydown';
    if (!shiftDown) hold.end('key');
  }
  window.addEventListener('keydown', onShift);
  window.addEventListener('keyup', onShift);
  undo.push(() => {
    window.removeEventListener('keydown', onShift);
    window.removeEventListener('keyup', onShift);
  });

  // Per frame, so a part picked up or selected with Shift already down is held from then on.
  function keepShiftHold() {
    const part = shiftDown && liftablePart();
    if (part) hold.begin(part, 'key');
  }

  function showLiftLine() {
    const part = liftablePart();
    if (part) liftLine.show(fractionOf(heightOf(part), rangeOf(part)));
    else liftLine.hide();
  }

  // The hold ends with the finger and Shift, and also when its part seats, on a repack, and
  // whenever the app is backgrounded or loses focus — a Shift let go meanwhile never arrives.
  function dropHold() {
    shiftDown = false;
    hold.end();
  }
  undo.push(
    events.on(EVENT.SEAT, ({ hardware, host }) => {
      if (hold.held && (hardware === hold.held.id || host === hold.held.id)) hold.end();
    }),
  );
  // A panel carried in on its dowels seats through them: it is neither side of the joint, but its
  // mover — or another panel of the assembly it carries is.
  undo.push(
    events.on(EVENT.SEAT, ({ joint }) => {
      const mover = typeof joint === 'number' ? assembly.get(joint)?.mover : undefined;
      if (hold.held && mover && assembly.compoundOf(hold.held.id).has(mover)) hold.end();
    }),
  );
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') dropHold();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', dropHold);
  undo.push(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('blur', dropHold);
  });

  // Recovery: a loose player part that has left the room (through a slab, off a wall) is set
  // down again beside the box. Bonded parts go back only with a repack. The box itself goes
  // back to where it last sat in the room — floor it held a moment ago, not the boot spot
  // the player may have built on since.
  let sweepIn = RESET.sweepInterval;
  let lastBox = boxPlacement();
  function sweep(delta: number) {
    sweepIn -= delta;
    if (sweepIn > 0) return;
    sweepIn = RESET.sweepInterval;
    const escaped = [...playerParts, flatpack.lid, flatpack.base].filter(({ id, body }) => {
      const { x, y, z } = body.translation();
      return hasEscaped([x, y, z], ROOM, RESET.escapeMargin) && assembly.compoundOf(id).size === 1;
    });
    if (!escaped.includes(flatpack.base)) lastBox = boxPose();
    if (escaped.length === 0) return;
    events.emit(recoveryEvent(escaped.map(({ id }) => id)));
    // The box goes back first, so the rest are set down beside it there.
    if (escaped.includes(flatpack.base)) {
      const back = baseRest(lastBox);
      physics.place(flatpack.base.body, back.position, back.rotation);
    }
    const loose = escaped.filter((part) => part !== flatpack.base);
    const spots = respawnSpots(loose.map((part) => part.type), boxPose());
    loose.forEach(({ body }, i) => physics.place(body, spots[i].position, spots[i].rotation));
  }

  // The rest of the booklet draws in idle time, after the room is on screen.
  bookletPages.prerender();

  return {
    booklet,
    pickDistance,
    repack,
    /** The inset's extra pass, after the main render: nothing while the inset is not showing. */
    render: (renderer: THREE.WebGLRenderer, scene: THREE.Scene) => insetPanel.render(renderer, scene),
    /** One frame of the item: the hold eases and the line draws before the physics step; the sweep, router and overlays follow it. */
    update(delta: number) {
      keepShiftHold();
      hold.update(delta);
      showLiftLine();
      physics.step(delta);
      sweep(delta);
      router.update(delta);
      insetPanel.update();
      gizmo.update();
      sprue.update();
      highlight.update(delta);
    },
  };
}

// Frees what an object holds on the GPU. The materials the world borrows (the room's ink) are not its
// to free: disposing them would recompile the room's own lines on every item swap.
function releaser(borrowed: ReadonlySet<THREE.Material>) {
  return (object: THREE.Object3D) => release(object, borrowed);
}

function release(object: THREE.Object3D, borrowed: ReadonlySet<THREE.Material>) {
  // Line covers LineSegments and the drop guide's plain Line; Mesh covers the fat LineSegments2.
  if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
  object.geometry.dispose();
  for (const material of [object.material].flat()) if (!borrowed.has(material)) material.dispose();
}
