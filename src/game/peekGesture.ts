// The manual's press-and-hold peek (1.9.1.2) as a small state machine: a touch that rests on
// the carousel's centre page opens it, and its release puts it back. `idle` → `pressing` on
// the press; → `peeking` when the peek delay has passed; → `idle` on the release. A touch
// that moves past the tap distance before the delay is a swipe: `pressing` → `idle`, and no
// delay that fires later can peek. Once peeking, the finger's travel changes nothing — only
// its release does. Pure: the booklet sheet (src/ui/booklet.ts) owns the timer and sends
// `delay` when it fires.

export type PeekState = 'idle' | 'pressing' | 'peeking';

export type PeekEvent =
  | { type: 'press' }
  /** The touch has travelled `distance` CSS px from where it went down. */
  | { type: 'move'; distance: number }
  /** The peek delay has passed. */
  | { type: 'delay' }
  /** The touch lifted or was cancelled. */
  | { type: 'release' };

export function peekNext(state: PeekState, event: PeekEvent, tapDistance: number): PeekState {
  switch (state) {
    case 'idle':
      return event.type === 'press' ? 'pressing' : 'idle';
    case 'pressing':
      if (event.type === 'delay') return 'peeking';
      if (event.type === 'release') return 'idle';
      return event.type === 'move' && event.distance > tapDistance ? 'idle' : 'pressing';
    case 'peeking':
      return event.type === 'release' ? 'idle' : 'peeking';
  }
}
