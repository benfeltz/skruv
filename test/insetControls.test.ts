import { describe, expect, it } from 'vitest';
import { BOOKLET, INSET } from '../src/constants.js';
import { bubbleFor, bubbleOf, bubbleOverhang, controlFor, handBubbleOf, pushLook, ringRadians, RING_SIGN, turnLook } from '../src/game/insetControls.js';
import type { InsetSubject } from '../src/game/insetModel.js';
import type { InsetFrame } from '../src/game/insetView.js';

const subject = (over: Partial<InsetSubject> = {}): InsetSubject => ({
  joint: 1,
  kind: 'dowel',
  hardware: 'dowel-1',
  host: 'side-1',
  tool: null,
  grip: null,
  centre: [0, 0, 0],
  axis: [0, 1, 0],
  progress: 0,
  tighten: false,
  loosen: false,
  pressed: false,
  ...over,
});
const tool = (over: Partial<InsetSubject> = {}) => subject({ kind: 'tool', tool: 'key-1', hardware: 'key-1', host: 'bolt-1', grip: 'key-1', ...over });

const hand = (over: Partial<InsetSubject> = {}) => subject({ kind: 'stud', hardware: 'stud-1', host: 'leg-1', grip: 'leg-1', ...over });

const frame: InsetFrame = { centre: [500, 300], radius: 80 };

describe('which control a subject gets', () => {
  it('a ring for a tool, an arrow for a dowel, pin or fitting, none for an offered seat or a bolt', () => {
    expect(controlFor(tool())).toBe('turn');
    for (const kind of ['dowel', 'pin', 'fitting'] as const) expect(controlFor(subject({ kind }))).toBe('push');
    expect(controlFor(subject({ joint: -1 }))).toBeNull();
    expect(controlFor(subject({ kind: 'bolt' }))).toBeNull();
  });

  it('a ring for a hand turn too: its grip, no tool; a stud with no grip gets none', () => {
    expect(controlFor(hand())).toBe('turn');
    expect(controlFor(hand({ grip: null }))).toBeNull();
    expect(controlFor(hand({ joint: -1 }))).toBeNull();
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

describe('where a control’s sub-bubble is attached', () => {
  const { bubble } = INSET.controls;

  it('matches the manual’s tool bubble: its share of the radius, its centre that share out along the lower-right diagonal', () => {
    expect(bubble.share).toBe(BOOKLET.inset.tool);
    expect(bubble.at).toBe(BOOKLET.inset.toolAt);
    const { centre, radius } = bubbleOf(frame);
    expect(radius).toBeCloseTo(frame.radius * BOOKLET.inset.tool, 9);
    expect(centre[0]).toBeCloseTo(frame.centre[0] + frame.radius * BOOKLET.inset.toolAt, 9);
    expect(centre[1]).toBeCloseTo(frame.centre[1] + frame.radius * BOOKLET.inset.toolAt, 9);
  });

  it('sits partly on the circle’s rim and partly off it', () => {
    const { centre, radius } = bubbleOf(frame);
    const distance = Math.hypot(centre[0] - frame.centre[0], centre[1] - frame.centre[1]);
    expect(distance - radius).toBeLessThan(frame.radius);
    expect(distance + radius).toBeGreaterThan(frame.radius);
  });

  it('is never smaller than a finger’s bubble, even on the smallest circle', () => {
    const small = bubbleOf({ centre: [100, 100], radius: INSET.portrait.min / 2 * 0.2 });
    expect(small.radius).toBe(bubble.min);
    expect(bubbleOf({ centre: [100, 100], radius: INSET.portrait.min / 2 }).radius).toBeGreaterThanOrEqual(bubble.min);
  });

  it('reaches past the circle’s right by a small, known overhang', () => {
    const { centre, radius } = bubbleOf(frame);
    expect(bubbleOverhang(frame)).toBeCloseTo(Math.max(0, centre[0] + radius - (frame.centre[0] + frame.radius)), 9);
    expect(bubbleOverhang(frame)).toBeLessThan(frame.radius * 0.2);
  });
});

describe('where a hand turn’s spinner is attached', () => {
  const { hand: place } = INSET.controls;
  const gap = (frame.radius + frame.radius * place.share) * (1 - place.overlap);

  it('is the circle’s own size', () => {
    for (const layout of ['portrait', 'landscape'] as const) expect(handBubbleOf(frame, layout).radius).toBe(frame.radius * place.share);
  });

  it('sits straight below the circle in portrait, overlapping its rim', () => {
    const { centre, radius } = handBubbleOf(frame, 'portrait');
    expect(centre[0]).toBeCloseTo(frame.centre[0], 9);
    expect(centre[1]).toBeCloseTo(frame.centre[1] + gap, 9);
    expect(centre[1] - frame.centre[1]).toBeLessThan(frame.radius + radius);
  });

  it('sits straight left of the circle in landscape, overlapping its rim', () => {
    const { centre, radius } = handBubbleOf(frame, 'landscape');
    expect(centre[1]).toBeCloseTo(frame.centre[1], 9);
    expect(centre[0]).toBeCloseTo(frame.centre[0] - gap, 9);
    expect(frame.centre[0] - centre[0]).toBeLessThan(frame.radius + radius);
  });

  it('is the hand subject’s bubble; a tool’s stays the small lower-right one', () => {
    expect(bubbleFor(hand(), frame, 'portrait')).toEqual(handBubbleOf(frame, 'portrait'));
    expect(bubbleFor(hand(), frame, 'landscape')).toEqual(handBubbleOf(frame, 'landscape'));
    expect(bubbleFor(tool(), frame, 'portrait')).toEqual(bubbleOf(frame));
    expect(bubbleFor(tool(), frame, 'landscape')).toEqual(bubbleOf(frame));
  });
});
