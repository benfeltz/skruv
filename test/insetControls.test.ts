import { describe, expect, it } from 'vitest';
import { INSET } from '../src/constants.js';
import { controlFor, controlSlot, pushLook, ringGrab, ringRadians, RING_SIGN, toolScreenDirection, turnLook } from '../src/game/insetControls.js';
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

const frame: InsetFrame = { centre: [200, 100], radius: 80 };
const reach = frame.radius + INSET.controls.gap + Math.max(INSET.controls.ring.radius, INSET.controls.arrow.length / 2, INSET.controls.arrow.head);

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

describe('the ring’s grab band', () => {
  const { radius, band } = INSET.controls.ring;
  it('takes the band either side of the ring and not the middle or far outside', () => {
    expect(ringGrab([100 + radius, 50], [100, 50])).toBe(true);
    expect(ringGrab([100 + radius + band - 1, 50], [100, 50])).toBe(true);
    expect(ringGrab([100, 50], [100, 50])).toBe(false);
    expect(ringGrab([100 + radius + band + 5, 50], [100, 50])).toBe(false);
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
    expect(controlSlot(frame, 'portrait', [1, 0], []).centre).toEqual([frame.centre[0] + reach, frame.centre[1]]);
    expect(controlSlot(frame, 'portrait', [-1, 0], []).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
  });

  it('landscape: below for a tip pointing down, left otherwise (right is not offered)', () => {
    expect(controlSlot(frame, 'landscape', [0.1, 1], []).centre).toEqual([frame.centre[0], frame.centre[1] + reach]);
    expect(controlSlot(frame, 'landscape', [1, 0], []).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
  });

  it('skips a slot that collides with the cluster, keeping the gap', () => {
    const [x, y] = [frame.centre[0] + reach, frame.centre[1]];
    const cluster = { left: x - 5, top: y - 5, right: x + 5, bottom: y + 5 };
    expect(controlSlot(frame, 'portrait', [1, 0], [cluster]).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
    // Just outside the slot's box but inside the cluster gap: still a collision.
    const half = Math.max(INSET.controls.ring.radius, INSET.controls.arrow.length / 2, INSET.controls.arrow.head);
    const near = { left: x + half + 2, top: y - 5, right: x + half + 30, bottom: y + 5 };
    expect(controlSlot(frame, 'portrait', [1, 0], [near]).centre[0]).toBeLessThan(frame.centre[0]);
  });

  it('uses the last slot when every one collides, never nothing', () => {
    const everywhere = { left: -1e4, top: -1e4, right: 1e4, bottom: 1e4 };
    expect(controlSlot(frame, 'portrait', [1, 0], [everywhere]).centre).toEqual([frame.centre[0] - reach, frame.centre[1]]);
  });
});
