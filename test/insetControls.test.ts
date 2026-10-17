import { describe, expect, it } from 'vitest';
import { INSET } from '../src/constants.js';
import { controlFor, controlSlot, pushLook, ringGeometry, ringGrab, ringRadians, RING_SIGN, toolScreenDirection, turnLook } from '../src/game/insetControls.js';
import { insetCameraPose } from '../src/game/insetView.js';
import type { InsetSubject } from '../src/game/insetModel.js';
import type { InsetFrame } from '../src/game/insetView.js';

const subject = (over: Partial<InsetSubject> = {}): InsetSubject => ({
  joint: 1,
  kind: 'dowel',
  hardware: 'dowel-1',
  host: 'side-1',
  tool: null,
  centre: [0, 0, 0],
  axis: [0, 1, 0],
  progress: 0,
  tighten: false,
  loosen: false,
  pressed: false,
  ...over,
});
const tool = (over: Partial<InsetSubject> = {}) => subject({ kind: 'tool', tool: 'key-1', hardware: 'key-1', host: 'bolt-1', ...over });

const frame: InsetFrame = { centre: [500, 300], radius: 80 };
const { ring: RING, arrow: ARROW, gap: GAP, clusterGap: CLUSTER_GAP } = INSET.controls;
// What takes a press, from the arrow's centre: its grab box.
const half = Math.max(ARROW.length / 2, Math.max(ARROW.width, ARROW.head) / 2) + ARROW.band;
const reach = frame.radius + GAP + half;
const screen = { left: 0, top: 0, right: 1000, bottom: 800 };
const placement = (obstacles: { left: number; top: number; right: number; bottom: number }[] = [], bounds = screen) => ({ obstacles, bounds });

describe('which control a subject gets', () => {
  it('a ring for a tool, an arrow for a dowel, pin or fitting, none for an offered seat or a bolt', () => {
    expect(controlFor(tool())).toBe('turn');
    for (const kind of ['dowel', 'pin', 'fitting'] as const) expect(controlFor(subject({ kind }))).toBe('push');
    expect(controlFor(subject({ joint: -1 }))).toBeNull();
    expect(controlFor(subject({ kind: 'bolt' }))).toBeNull();
  });
});

describe('how a control looks', () => {
  it('the ring reads the subject’s progress and both limits', () => {
    expect(turnLook(tool({ progress: 0.4, tighten: true, loosen: false }))).toEqual({ progress: 0.4, tighten: true, loosen: false });
  });

  it('the arrow is black with its head in while seated, green with its head out once pressed', () => {
    expect(pushLook(subject())).toEqual({ seated: false, head: 'in' });
    expect(pushLook(subject({ pressed: true }))).toEqual({ seated: true, head: 'out' });
  });

  it('a clockwise sweep tightens, by the one sign the widget shares', () => {
    expect(RING_SIGN).toBe(1);
    expect(ringRadians(0.5)).toBeGreaterThan(0);
    expect(ringRadians(-0.5)).toBeLessThan(0);
  });
});

describe('the turn ring round the circle', () => {
  const ring = ringGeometry(frame);

  it('shares the circle’s centre, its line just outside the rim', () => {
    expect(ring.radius).toBe(frame.radius + RING.gap);
    expect(ring.radius).toBeGreaterThan(frame.radius);
  });

  it('grabs on the band outside the rim, never on the circle’s picture', () => {
    const at = (distance: number): [number, number] => [frame.centre[0] + distance, frame.centre[1]];
    expect(ring.inner).toBeGreaterThanOrEqual(frame.radius);
    expect(ringGrab(at(ring.radius), frame)).toBe(true);
    expect(ringGrab(at(ring.outer), frame)).toBe(true);
    expect(ringGrab(at(ring.outer + 2), frame)).toBe(false);
    // Inside the circle, and on its very rim, is the picture's.
    expect(ringGrab(at(0), frame)).toBe(false);
    expect(ringGrab(at(frame.radius - 1), frame)).toBe(false);
    expect(ringGrab(at(ring.inner - 0.5), frame)).toBe(false);
  });

  it('is the same all the way round', () => {
    for (const angle of [0, 1, 2.5, 4, 5.5]) {
      const p: [number, number] = [frame.centre[0] + ring.radius * Math.cos(angle), frame.centre[1] + ring.radius * Math.sin(angle)];
      expect(ringGrab(p, frame)).toBe(true);
    }
  });
});

describe('the tool’s direction on the inset’s screen', () => {
  it('a hole facing down (into-axis up) points up the screen from the tilted camera', () => {
    const pose = insetCameraPose([0, 0, 0], [0, 1, 0], [0, 0, -1]);
    const [, y] = toolScreenDirection([0, 1, 0], pose);
    expect(y).toBeLessThan(0);
  });

  it('a hole facing up (into-axis down) points down the screen', () => {
    const pose = insetCameraPose([0, 0, 0], [0, -1, 0], [0, 0, -1]);
    expect(toolScreenDirection([0, -1, 0], pose)[1]).toBeGreaterThan(0);
  });

  it('follows the room: turning the main camera mirrors the sideways direction', () => {
    const a = toolScreenDirection([1, 0, 0], insetCameraPose([0, 0, 0], [0, -1, 0], [0, 0, -1]));
    const b = toolScreenDirection([1, 0, 0], insetCameraPose([0, 0, 0], [0, -1, 0], [0, 0, 1]));
    expect(Math.sign(a[0])).toBe(-Math.sign(b[0]));
    expect(Math.abs(a[0])).toBeGreaterThan(0);
  });
});

describe('where a control sits', () => {
  it('portrait: right of the circle for a tip pointing right, left for a tip pointing left', () => {
    expect(controlSlot(frame, 'portrait', [1, 0], placement()).centre).toEqual([frame.centre[0] + reach, frame.centre[1]]);
    expect(controlSlot(frame, 'portrait', [-1, 0], placement()).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
  });

  it('landscape: below for a tip pointing down, left otherwise (right is not offered)', () => {
    expect(controlSlot(frame, 'landscape', [0.1, 1], placement()).centre).toEqual([frame.centre[0], frame.centre[1] + reach]);
    expect(controlSlot(frame, 'landscape', [1, 0], placement()).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
  });

  it('portrait keeps to the sides even for a tip pointing down; landscape alone goes below for it', () => {
    expect(controlSlot(frame, 'portrait', [0.1, 1], placement()).centre).toEqual([frame.centre[0] + reach, frame.centre[1]]);
    expect(controlSlot(frame, 'portrait', [-0.1, 1], placement()).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
  });

  it('keeps the arrow’s grab box clear of the circle: its reach plus the gap fits between rim and slot', () => {
    for (const layout of ['portrait', 'landscape'] as const) {
      for (const tip of [[1, 0], [-1, 0], [0, 1]] as [number, number][]) {
        const [x, y] = controlSlot(frame, layout, tip, placement()).centre;
        expect(Math.hypot(x - frame.centre[0], y - frame.centre[1]) - half).toBeGreaterThanOrEqual(frame.radius + GAP);
      }
    }
  });

  it('skips a slot whose grab box collides with the cluster, keeping the gap', () => {
    const [x, y] = [frame.centre[0] + reach, frame.centre[1]];
    const cluster = { left: x - 5, top: y - 5, right: x + 5, bottom: y + 5 };
    expect(controlSlot(frame, 'portrait', [1, 0], placement([cluster])).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
    // Just outside the slot's grab box but inside the cluster gap: still a collision.
    const near = { left: x + half + CLUSTER_GAP - 2, top: y - 5, right: x + half + 60, bottom: y + 5 };
    expect(controlSlot(frame, 'portrait', [1, 0], placement([near])).centre[0]).toBeLessThan(frame.centre[0]);
    // Past the gap it is clear.
    const clear = { ...near, left: x + half + CLUSTER_GAP + 2 };
    expect(controlSlot(frame, 'portrait', [1, 0], placement([clear])).centre[0]).toBeGreaterThan(frame.centre[0]);
  });

  it('skips a slot that would run off the screen, taking portrait’s last resort below on a narrow phone', () => {
    // Only the right side fits: a tip pointing left still takes the right slot.
    const rightOnly = { left: frame.centre[0] - reach, top: 0, right: frame.centre[0] + reach + half, bottom: 800 };
    expect(controlSlot(frame, 'portrait', [-1, 0], placement([], rightOnly)).centre).toEqual([frame.centre[0] + reach, frame.centre[1]]);
    // A 390 phone: neither side fits, so below.
    const phone = { left: frame.centre[0] - 195, top: 0, right: frame.centre[0] + 195, bottom: 800 };
    expect(controlSlot(frame, 'portrait', [1, 0], placement([], phone)).centre).toEqual([frame.centre[0], frame.centre[1] + reach]);
  });

  it('uses the last slot when every one collides or runs off, never nothing', () => {
    const everywhere = { left: -1e4, top: -1e4, right: 1e4, bottom: 1e4 };
    expect(controlSlot(frame, 'portrait', [1, 0], placement([everywhere])).centre).toEqual([frame.centre[0], frame.centre[1] + reach]);
    expect(controlSlot(frame, 'landscape', [1, 0], placement([everywhere])).centre).toEqual([frame.centre[0], frame.centre[1] + reach]);
  });
});
