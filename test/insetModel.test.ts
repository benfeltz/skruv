import { describe, expect, it } from 'vitest';
import { createInsetModel } from '../src/game/insetModel.js';
import type { InsetSubject } from '../src/game/insetModel.js';

const subject = (joint: number, over: Partial<InsetSubject> = {}): InsetSubject => ({
  joint,
  kind: 'dowel',
  hardware: `dowel-${joint}`,
  host: `side-${joint}`,
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
const seat = (hardware = 'dowel-9', host = 'top-1') => subject(-1, { hardware, host });
const nothing = () => null;
// The router's lookup of a pressed-home joint's subject.
const pressedOf = (...subjects: InsetSubject[]) => (joint: number) => subjects.find((s) => s.joint === joint) ?? null;
const none = { offered: null, engaged: [], settled: nothing };

describe('the inset model', () => {
  it('starts hidden with no subject', () => {
    const m = createInsetModel();
    expect(m.state).toBe('hidden');
    expect(m.subject).toBeNull();
  });

  it('hidden → offered when carried hardware has a seat in the zone, framing that seat', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [], settled: nothing });
    expect(m.state).toBe('offered');
    expect(m.subject?.joint).toBe(-1);
  });

  it('offered → hidden when the hardware leaves the zone', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [], settled: nothing });
    m.step(none);
    expect(m.state).toBe('hidden');
    expect(m.subject).toBeNull();
  });

  it('offered → active once the parts engage', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [], settled: nothing });
    m.step({ offered: null, engaged: [subject(3)], settled: nothing });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(3);
  });

  it('hidden → active when something is engaged outright', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    expect(m.state).toBe('active');
  });

  it('active → hidden when the engagement ends', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.step(none);
    expect(m.state).toBe('hidden');
  });

  it('frames the most recently engaged of two joints', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.step({ offered: null, engaged: [subject(1), subject(2)], settled: nothing });
    expect(m.subject?.joint).toBe(2);
    // The order the router lists them in is irrelevant.
    m.step({ offered: null, engaged: [subject(2), subject(1)], settled: nothing });
    expect(m.subject?.joint).toBe(2);
  });

  it('falls back to the earlier joint when the later one ends', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.step({ offered: null, engaged: [subject(1), subject(2)], settled: nothing });
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    expect(m.subject?.joint).toBe(1);
  });

  it('carrying hardware to a seat overrides recency while it is carried', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.step({ offered: seat(), engaged: [subject(1)], settled: nothing });
    expect(m.state).toBe('offered');
    expect(m.subject?.joint).toBe(-1);
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(1);
  });

  it('a tap outside dismisses an offered or active inset, and changes nothing when hidden', () => {
    const m = createInsetModel();
    expect(m.tapOutside()).toBe(false);
    expect(m.state).toBe('hidden');
    m.step({ offered: seat(), engaged: [], settled: nothing });
    expect(m.tapOutside()).toBe(true);
    expect(m.state).toBe('dismissed');
    expect(m.tapOutside()).toBe(false);
    const a = createInsetModel();
    a.step({ offered: null, engaged: [subject(1)], settled: nothing });
    expect(a.tapOutside()).toBe(true);
    expect(a.state).toBe('dismissed');
  });

  it('stays dismissed while its subject is still engaged', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    expect(m.state).toBe('dismissed');
    expect(m.subject?.joint).toBe(1);
  });

  it('a dismissed offer stays put while the seat is still on offer', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [], settled: nothing });
    m.tapOutside();
    m.step({ offered: seat(), engaged: [], settled: nothing });
    expect(m.state).toBe('dismissed');
  });

  it('a tap on a tool’s joint reopens it from the tool or the bolt, and on a dowel from the dowel', () => {
    for (const [s, part] of [
      [subject(1, { kind: 'tool', hardware: 'key-1', host: 'bolt-1', tool: 'key-1', grip: 'key-1' }), 'key-1'],
      [subject(1, { kind: 'tool', hardware: 'key-1', host: 'bolt-1', tool: 'key-1', grip: 'key-1' }), 'bolt-1'],
      [subject(1), 'dowel-1'],
    ] as const) {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [s], settled: nothing });
      m.tapOutside();
      expect(m.tapOn(part)).toBe(true);
      expect(m.state).toBe('active');
    }
  });

  it('a tap on a hand turn’s leg or its stud reopens it, and its grip survives a step', () => {
    const hand = subject(1, { kind: 'stud', hardware: 'stud-1', host: 'leg-1', grip: 'leg-1' });
    for (const part of ['leg-1', 'stud-1']) {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [hand], settled: nothing });
      expect(m.subject?.grip).toBe('leg-1');
      m.tapOutside();
      expect(m.tapOn(part)).toBe(true);
      expect(m.state).toBe('active');
      expect(m.subject?.grip).toBe('leg-1');
    }
  });

  it('a tap on a dowel’s host panel is not the inset’s: the panel keeps its own tap', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.tapOutside();
    expect(m.tapOn('side-1')).toBe(false);
    expect(m.state).toBe('dismissed');
  });

  it('a tap on a part that is not the subject does nothing and stays dismissed', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.tapOutside();
    expect(m.tapOn('lid')).toBe(false);
    expect(m.state).toBe('dismissed');
  });

  it('while showing, a tap on an engaged part is not consumed', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    expect(m.tapOn('dowel-1')).toBe(false);
    expect(m.state).toBe('active');
  });

  it('a dismissed inset whose engagement ends goes hidden, and a new offer shows it again', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.tapOutside();
    m.step(none);
    expect(m.state).toBe('hidden');
    m.step({ offered: seat(), engaged: [], settled: nothing });
    expect(m.state).toBe('offered');
  });

  it('a dismissal puts away what was there: a new offer after it shows', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.tapOutside();
    m.step({ offered: seat('dowel-9', 'top-1'), engaged: [subject(1)], settled: nothing });
    expect(m.state).toBe('offered');
    expect(m.subject?.joint).toBe(-1);
  });

  it('shows a joint engaged after the dismissal, and leaves the earlier one away when it ends', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1), subject(2)], settled: nothing });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(2);
    m.step({ offered: null, engaged: [subject(1)], settled: nothing });
    expect(m.state).toBe('dismissed');
    m.step(none);
    expect(m.state).toBe('hidden');
  });

  it('puts away every joint that was engaged, not only the one it showed', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1), subject(2)], settled: nothing });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1), subject(2)], settled: nothing });
    expect(m.state).toBe('dismissed');
  });

  it('a tap reopens the joint it was on, not the most recently engaged one', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1), subject(2)], settled: nothing });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1), subject(2), subject(3)], settled: nothing });
    m.tapOutside();
    expect(m.tapOn('dowel-1')).toBe(true);
    expect(m.subject?.joint).toBe(1);
    m.step({ offered: null, engaged: [subject(1), subject(2), subject(3)], settled: nothing });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(1);
  });

  it('reset hides it and forgets the engagement order', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1), subject(2)], settled: nothing });
    m.reset();
    expect(m.state).toBe('hidden');
    expect(m.subject).toBeNull();
    m.step({ offered: null, engaged: [subject(2), subject(1)], settled: nothing });
    expect(m.subject?.joint).toBe(1);
  });

  describe('settled dowels', () => {
    const pressed = (joint: number) => subject(joint, { pressed: true, progress: 1 });

    it('a subject that goes from engaged to settled stays active, pressed', () => {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      expect(m.state).toBe('active');
      expect(m.subject?.pressed).toBe(true);
    });

    it('a settled joint never seen engaged in this inset is not picked', () => {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      expect(m.state).toBe('hidden');
      expect(m.subject).toBeNull();
    });

    it('a new offer outranks a settled subject, which comes back when the offer goes', () => {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      m.step({ offered: seat(), engaged: [], settled: pressedOf(pressed(1)) });
      expect(m.state).toBe('offered');
    });

    it('settled plus engaged: the engaged one shows', () => {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      m.step({ offered: null, engaged: [subject(2)], settled: pressedOf(pressed(1)) });
      expect(m.subject?.joint).toBe(2);
    });

    it('pulled back to engaged, it is the engaged subject again', () => {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      expect(m.subject?.pressed).toBe(false);
    });

    it('a tap outside dismisses a settled subject; a tap on its dowel reopens it', () => {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      expect(m.tapOutside()).toBe(true);
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      expect(m.state).toBe('dismissed');
      expect(m.tapOn('dowel-1')).toBe(true);
      expect(m.state).toBe('active');
    });

    it('reset forgets it', () => {
      const m = createInsetModel();
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      m.reset();
      m.step({ offered: null, engaged: [], settled: pressedOf(pressed(1)) });
      expect(m.state).toBe('hidden');
    });

    // Review: `tapOutside` put every key the model knew away, and pressed dowels in the rest of the build never leave `known`.
    it('a tap outside puts away only the dowel on show: the rest of the build’s pressed dowels stay selectable and it can hide', () => {
      const m = createInsetModel();
      const all = pressedOf(pressed(1), pressed(2), pressed(3));
      m.step({ offered: null, engaged: [subject(1)], settled: nothing });
      m.step({ offered: null, engaged: [], settled: all });
      expect(m.tapOutside()).toBe(true);
      m.step({ offered: null, engaged: [], settled: all });
      expect(m.state).toBe('dismissed');
      // A tap on another pressed dowel is not the inset's to swallow.
      expect(m.tapOn('dowel-2')).toBe(false);
      // The dowel on show goes: the inset hides, with nothing left parked.
      m.step({ offered: null, engaged: [], settled: nothing });
      expect(m.state).toBe('hidden');
    });

    it('asks the router only about the joint on show', () => {
      const m = createInsetModel();
      const asked: number[] = [];
      const settled = (joint: number) => {
        asked.push(joint);
        return null;
      };
      m.step({ offered: null, engaged: [subject(4)], settled });
      m.step({ offered: null, engaged: [subject(4)], settled });
      expect(new Set(asked)).toEqual(new Set([4]));
    });
  });
});
