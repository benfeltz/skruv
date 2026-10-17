import { describe, expect, it } from 'vitest';
import { createInsetModel } from '../src/game/insetModel.js';
import type { InsetSubject } from '../src/game/insetModel.js';

const subject = (joint: number, over: Partial<InsetSubject> = {}): InsetSubject => ({
  joint,
  kind: 'dowel',
  hardware: `dowel-${joint}`,
  host: `side-${joint}`,
  tool: null,
  centre: [0, 0, 0],
  axis: [0, 1, 0],
  ...over,
});
const seat = (hardware = 'dowel-9', host = 'top-1') => subject(-1, { hardware, host });
const none = { offered: null, engaged: [] };

describe('the inset model', () => {
  it('starts hidden with no subject', () => {
    const m = createInsetModel();
    expect(m.state).toBe('hidden');
    expect(m.subject).toBeNull();
  });

  it('hidden → offered when carried hardware has a seat in the zone, framing that seat', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [] });
    expect(m.state).toBe('offered');
    expect(m.subject?.joint).toBe(-1);
  });

  it('offered → hidden when the hardware leaves the zone', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [] });
    m.step(none);
    expect(m.state).toBe('hidden');
    expect(m.subject).toBeNull();
  });

  it('offered → active once the parts engage', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [] });
    m.step({ offered: null, engaged: [subject(3)] });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(3);
  });

  it('hidden → active when something is engaged outright', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    expect(m.state).toBe('active');
  });

  it('active → hidden when the engagement ends', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.step(none);
    expect(m.state).toBe('hidden');
  });

  it('frames the most recently engaged of two joints', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.step({ offered: null, engaged: [subject(1), subject(2)] });
    expect(m.subject?.joint).toBe(2);
    // The order the router lists them in is irrelevant.
    m.step({ offered: null, engaged: [subject(2), subject(1)] });
    expect(m.subject?.joint).toBe(2);
  });

  it('falls back to the earlier joint when the later one ends', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.step({ offered: null, engaged: [subject(1), subject(2)] });
    m.step({ offered: null, engaged: [subject(1)] });
    expect(m.subject?.joint).toBe(1);
  });

  it('carrying hardware to a seat overrides recency while it is carried', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.step({ offered: seat(), engaged: [subject(1)] });
    expect(m.state).toBe('offered');
    expect(m.subject?.joint).toBe(-1);
    m.step({ offered: null, engaged: [subject(1)] });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(1);
  });

  it('a tap outside dismisses an offered or active inset, and changes nothing when hidden', () => {
    const m = createInsetModel();
    expect(m.tapOutside()).toBe(false);
    expect(m.state).toBe('hidden');
    m.step({ offered: seat(), engaged: [] });
    expect(m.tapOutside()).toBe(true);
    expect(m.state).toBe('dismissed');
    expect(m.tapOutside()).toBe(false);
    const a = createInsetModel();
    a.step({ offered: null, engaged: [subject(1)] });
    expect(a.tapOutside()).toBe(true);
    expect(a.state).toBe('dismissed');
  });

  it('stays dismissed while its subject is still engaged', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1)] });
    expect(m.state).toBe('dismissed');
    expect(m.subject?.joint).toBe(1);
  });

  it('a dismissed offer stays put while the seat is still on offer', () => {
    const m = createInsetModel();
    m.step({ offered: seat(), engaged: [] });
    m.tapOutside();
    m.step({ offered: seat(), engaged: [] });
    expect(m.state).toBe('dismissed');
  });

  it('a tap on the subject’s hardware, host or tool reopens a dismissed inset and is consumed', () => {
    for (const part of ['dowel-1', 'side-1', 'key-1']) {
      const m = createInsetModel();
      const s = subject(1, { tool: 'key-1' });
      m.step({ offered: null, engaged: [s] });
      m.tapOutside();
      expect(m.tapOn(part)).toBe(true);
      expect(m.state).toBe('active');
    }
  });

  it('a tap on a part that is not the subject does nothing and stays dismissed', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.tapOutside();
    expect(m.tapOn('lid')).toBe(false);
    expect(m.state).toBe('dismissed');
  });

  it('while showing, a tap on an engaged part is not consumed', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    expect(m.tapOn('dowel-1')).toBe(false);
    expect(m.state).toBe('active');
  });

  it('a dismissed inset whose engagement ends goes hidden, and a new offer shows it again', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.tapOutside();
    m.step(none);
    expect(m.state).toBe('hidden');
    m.step({ offered: seat(), engaged: [] });
    expect(m.state).toBe('offered');
  });

  it('a dismissal puts away what was there: a new offer after it shows', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.tapOutside();
    m.step({ offered: seat('dowel-9', 'top-1'), engaged: [subject(1)] });
    expect(m.state).toBe('offered');
    expect(m.subject?.joint).toBe(-1);
  });

  it('shows a joint engaged after the dismissal, and leaves the earlier one away when it ends', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1)] });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1), subject(2)] });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(2);
    m.step({ offered: null, engaged: [subject(1)] });
    expect(m.state).toBe('dismissed');
    m.step(none);
    expect(m.state).toBe('hidden');
  });

  it('puts away every joint that was engaged, not only the one it showed', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1), subject(2)] });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1), subject(2)] });
    expect(m.state).toBe('dismissed');
  });

  it('a tap reopens the joint it was on, not the most recently engaged one', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1), subject(2)] });
    m.tapOutside();
    m.step({ offered: null, engaged: [subject(1), subject(2), subject(3)] });
    m.tapOutside();
    expect(m.tapOn('dowel-1')).toBe(true);
    expect(m.subject?.joint).toBe(1);
    m.step({ offered: null, engaged: [subject(1), subject(2), subject(3)] });
    expect(m.state).toBe('active');
    expect(m.subject?.joint).toBe(1);
  });

  it('reset hides it and forgets the engagement order', () => {
    const m = createInsetModel();
    m.step({ offered: null, engaged: [subject(1), subject(2)] });
    m.reset();
    expect(m.state).toBe('hidden');
    expect(m.subject).toBeNull();
    m.step({ offered: null, engaged: [subject(2), subject(1)] });
    expect(m.subject?.joint).toBe(1);
  });
});
