import { describe, expect, it, vi } from 'vitest';
import {
  ANY,
  createBus,
  EVENT,
  EVENT_FIELDS,
  fastenEvent,
  fpsEvent,
  grabEvent,
  recoveryEvent,
  releaseEvent,
  resetEvent,
  seatEvent,
  sessionEvent,
  snapCandidateEvent,
  tuneEvent,
  unfastenEvent,
  unseatEvent,
} from '../src/game/events.js';
import type { StampedEvent } from '../src/game/events.js';
import type { AssemblyJoint } from '../src/game/assembly.js';

// A stub of just the fields the factories read; its id is a label, not the assembly's number.
const joint = { id: 'j1', kind: 'cam', hardware: 'cam-1', host: 'side-l', fastener: { state: 'locked', progress: 1 } } as unknown as AssemblyJoint;
const offer = { from: { part: { id: 'dowel-1' }, index: 0 }, to: { part: { id: 'side-l' }, index: 3 } };

describe('event factories', () => {
  const made = [
    sessionEvent('start'),
    grabEvent('dowel-1', 'move'),
    releaseEvent('dowel-1', 'move', { seated: true }),
    snapCandidateEvent('dowel-1', offer),
    seatEvent(joint),
    unseatEvent(joint),
    fastenEvent(joint),
    unfastenEvent(joint),
    resetEvent(),
    recoveryEvent(['pin-2']),
    fpsEvent(58.2, false),
    tuneEvent('snap.maxDistance', 0.05),
  ];

  it('cover every event type exactly once', () => {
    expect(made.map((e) => e.type).sort()).toEqual(Object.values(EVENT).sort());
  });

  it.each(made.map((e) => [e.type, e]))('%s carries exactly its schema fields, in order', (type, event) => {
    expect(Object.keys(event)).toEqual(['type', ...EVENT_FIELDS[type]]);
  });

  it('fill a field the emitter left out with null, never leave it absent', () => {
    const event = snapCandidateEvent('dowel-1', null);
    expect(event).toEqual({ type: 'snapCandidate', part: 'dowel-1', target: null, connector: null, targetConnector: null });
  });

  it('take the joint fields from an assembly joint record', () => {
    expect(fastenEvent(joint)).toEqual({ type: 'fasten', joint: 'j1', kind: 'cam', hardware: 'cam-1', host: 'side-l', state: 'locked' });
    expect(snapCandidateEvent('dowel-1', offer)).toMatchObject({ target: 'side-l', connector: 0, targetConnector: 3 });
  });

  it('default a release to neither seated nor cancelled', () => {
    expect(releaseEvent('p', 'crank')).toMatchObject({ seated: false, cancelled: false });
  });

  it('copy the recovered parts, so a later change to the caller list never rewrites history', () => {
    const parts = ['a'];
    const event = recoveryEvent(parts);
    parts.push('b');
    expect(event.parts).toEqual(['a']);
  });
});

describe('createBus', () => {
  it('delivers to listeners of the type and to ANY, stamped with t and seq', () => {
    let clock = 100;
    const bus = createBus({ now: () => clock });
    const grabs: StampedEvent[] = [];
    const all: StampedEvent[] = [];
    bus.on(EVENT.GRAB, (e) => grabs.push(e));
    bus.on(ANY, (e) => all.push(e));
    bus.emit(grabEvent('p', 'move'));
    clock = 250;
    bus.emit(resetEvent());
    expect(grabs).toEqual([{ type: 'grab', part: 'p', mode: 'move', t: 100, seq: 0 }]);
    expect(all.map((e) => [e.type, e.t, e.seq])).toEqual([
      ['grab', 100, 0],
      ['reset', 250, 1],
    ]);
  });

  it('unsubscribes through the returned function and through off', () => {
    const bus = createBus();
    const a = vi.fn();
    const b = vi.fn();
    const stop = bus.on(EVENT.RESET, a);
    bus.on(EVENT.RESET, b);
    stop();
    bus.off(EVENT.RESET, b);
    bus.emit(resetEvent());
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('never mutates the emitted event', () => {
    const bus = createBus();
    const event = resetEvent();
    bus.emit(event);
    expect(event).toEqual({ type: 'reset' });
  });

  it('isolates a throwing listener: the rest still hear the event, and emit never throws', () => {
    const errors: string[] = [];
    const bus = createBus({ onError: (e) => errors.push((e as Error).message) });
    const after = vi.fn();
    bus.on(ANY, () => {
      throw new Error('boom');
    });
    bus.on(ANY, after);
    expect(() => bus.emit(resetEvent())).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    expect(errors).toEqual(['boom']);
  });
});
