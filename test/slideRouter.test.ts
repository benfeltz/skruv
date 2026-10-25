import { describe, expect, it, vi } from 'vitest';
import { SLIDE } from '../src/constants.js';
import { EVENT } from '../src/game/events.js';
import { makePart, mount } from './support/routerBench.js';
import { DOWEL_BOTTOM, PLATE_DOWEL_TOP, PLATE_GROOVE_L, PLATE_GROOVE_R, RAIL_TRAVEL, RUNNER_END, railsLayout } from './support/railParts.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

vi.mock('../src/game/item.js', async (original) => (await import('./support/railParts.js')).withRails(await original()));

// A drawer on its runners under the real router (1.9.3.3.2): a drag on any part of the drawer
// slides it along its travel, clamped; past the open limit it comes off and the drag carries on.
// The feel — stiffness, damping, the pull-out distance, how the finger tracks — is device-only.

const typeOf = (id: string) => id.replace(/-\d+$/, '');
const travelOf = (part: string): Vec3 | null => (part === 'plate-1' ? [0, 0, RAIL_TRAVEL] : null);

/** The plate seated on both runners (a slide starts fastened), over a dowel pressed into it when asked. */
function railed(withDowel = false) {
  const parts = railsLayout().map(({ id, position, rotation }) => makePart(id, typeOf(id), position, rotation));
  if (withDowel) parts.push(makePart('dowel-1', 'dowel', [0.016, 0.05, 0.1]));
  const bench = mount(parts, [0, 1.2, 0.8], undefined, undefined, travelOf);
  const { assembly } = bench;
  assembly.seat({ partA: 'runner-1', connectorA: RUNNER_END, partB: 'plate-1', connectorB: PLATE_GROOVE_L, mover: 'plate-1' });
  assembly.seat({ partA: 'runner-2', connectorA: RUNNER_END, partB: 'plate-1', connectorB: PLATE_GROOVE_R, mover: 'plate-1' });
  if (withDowel) {
    const dowel = assembly.seat({ partA: 'dowel-1', connectorA: DOWEL_BOTTOM, partB: 'plate-1', connectorB: PLATE_DOWEL_TOP, mover: 'dowel-1' });
    assembly.apply(dowel.id, { type: 'tap' });
  }
  bench.router.sync();
  return { ...bench, part: (id: string) => parts.find((p) => p.id === id)! };
}

type Bench = ReturnType<typeof railed>;
type Point = { clientX: number; clientY: number };

/** Where the finger is `metres` of travel along the drawer's axis from `at`, as this camera sees the axis. */
function along(bench: Bench, at: Point, metres: number): Point {
  const origin = bench.part('plate-1').mesh.position;
  const from = bench.screen(origin);
  const to = bench.screen([origin.x, origin.y, origin.z + RAIL_TRAVEL]);
  const k = metres / RAIL_TRAVEL;
  return { clientX: at.clientX + (to.clientX - from.clientX) * k, clientY: at.clientY + (to.clientY - from.clientY) * k };
}

/** Presses on `at` and drags the finger `metres` of travel along the axis, in a few steps, one frame each. */
function dragAlong(bench: Bench, at: Point, metres: number, steps = 20) {
  bench.canvas.fire('pointerdown', at);
  for (let i = 1; i <= steps; i++) {
    bench.canvas.fire('pointermove', along(bench, at, (metres * i) / steps));
    bench.hold(1);
  }
}

const targets = (bench: Bench) => bench.slides.flatMap(({ target }) => (target === null ? [] : [target]));

describe('dragging a drawer on its runners', () => {
  it('slides it: equal, rising targets on both joints, clamped at the travel, and let go with damping alone', () => {
    const bench = railed();
    expect(bench.joined).toHaveLength(2);
    const at = bench.screen(bench.part('plate-1').mesh.position);
    dragAlong(bench, at, RAIL_TRAVEL + SLIDE.pullOut / 2);
    expect(bench.router.dragging).toMatchObject({ mode: 'slide' });
    const moved = targets(bench);
    expect(moved.length).toBeGreaterThan(2);
    expect(Math.max(...moved)).toBeCloseTo(RAIL_TRAVEL, 6);
    expect(moved.every((t) => t >= 0 && t <= RAIL_TRAVEL)).toBe(true);
    // Both joints get every target, in step; they rise (never fall) while the finger goes one way.
    const [a, b] = bench.joined;
    expect(bench.slides.filter((s) => s.joint === a).map((s) => s.target)).toEqual(bench.slides.filter((s) => s.joint === b).map((s) => s.target));
    expect(moved).toEqual([...moved].sort((x, y) => x - y));
    bench.canvas.fire('pointerup', along(bench, at, RAIL_TRAVEL));
    expect(bench.slides.slice(-2)).toEqual([
      { joint: a, target: null },
      { joint: b, target: null },
    ]);
    expect(bench.grabbed).toEqual([]);
    expect(bench.released).toEqual([]);
    expect(bench.log.filter((e) => e.type === EVENT.GRAB)).toMatchObject([{ mode: 'slide' }]);
  });

  it('slides it by a dowel pressed into the drawer; the runner is not the drawer', () => {
    const bench = railed(true);
    const at = bench.screen(bench.part('dowel-1').mesh.position);
    dragAlong(bench, at, 0.05);
    expect(bench.router.dragging).toMatchObject({ mode: 'slide' });
    expect(targets(bench).length).toBeGreaterThan(0);
  });

  it('does not slide for a drag on the runner', () => {
    const bench = railed();
    const at = bench.screen(bench.part('runner-1').mesh.position);
    dragAlong(bench, at, 0.05);
    expect(bench.router.dragging?.mode).not.toBe('slide');
    expect(bench.slides).toEqual([]);
  });

  it('buzzes once at the open end, not again while held there, and once more back at closed', () => {
    const bench = railed();
    const at = bench.screen(bench.part('plate-1').mesh.position);
    dragAlong(bench, at, RAIL_TRAVEL + SLIDE.pullOut / 2);
    expect(bench.slideEnds()).toBe(1);
    bench.canvas.fire('pointermove', along(bench, at, RAIL_TRAVEL + SLIDE.pullOut / 4));
    expect(bench.slideEnds()).toBe(1);
    for (let m = RAIL_TRAVEL; m >= -0.02; m -= 0.005) bench.canvas.fire('pointermove', along(bench, at, m));
    expect(bench.slideEnds()).toBe(2);
  });

  it('stays at closed when dragged against the travel, and never pulls out', () => {
    const bench = railed();
    const at = bench.screen(bench.part('plate-1').mesh.position);
    dragAlong(bench, at, -0.3);
    expect(targets(bench).every((t) => t === 0)).toBe(true);
    expect(bench.assembly.slideOf('plate-1')).not.toBeNull();
    expect(bench.router.dragging).toMatchObject({ mode: 'slide' });
  });
});

describe('pulling a drawer off its runners', () => {
  it('unfastens and unseats both slide joints and carries on as a plane drag', () => {
    const bench = railed(true);
    const at = bench.screen(bench.part('plate-1').mesh.position);
    dragAlong(bench, at, RAIL_TRAVEL + SLIDE.pullOut * 2);
    // Past the open limit by SLIDE.pullOut: off the runners, a free drag from here.
    expect(SLIDE.pullOut).toBeGreaterThan(0);
    expect(bench.router.dragging).toMatchObject({ mode: 'move' });
    expect(bench.assembly.all().filter((j) => j.kind === 'slide')).toEqual([]);
    expect(bench.assembly.slideOf('plate-1')).toBeNull();
    expect(bench.assembly.all().filter((j) => j.kind === 'dowel')).toHaveLength(1);
    const all = bench.log.map((e) => e.type);
    expect(all.filter((t) => t === EVENT.UNSEAT)).toHaveLength(2);
    expect(all.filter((t) => t === EVENT.UNFASTEN)).toHaveLength(2);
    expect(bench.log.filter((e) => e.type === EVENT.GRAB).map((e) => e.mode)).toEqual(['slide', 'move']);
  });
});

describe('a slide pulled to seated', () => {
  it('is no longer a slide: the next drag goes to the branches it always took', () => {
    const bench = railed();
    for (const joint of bench.assembly.all()) bench.assembly.apply(joint.id, { type: 'pull' });
    bench.router.sync();
    expect(bench.assembly.slideOf('plate-1')).toBeNull();
    const at = bench.screen(bench.part('plate-1').mesh.position);
    dragAlong(bench, at, 0.05);
    expect(bench.router.dragging?.mode).not.toBe('slide');
  });
});
