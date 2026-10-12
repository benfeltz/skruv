// The corner stack (1.9.1): the paper objects docked in the corner as thumbs — the current
// item's manual in front, the catalog behind it. Pure: src/ui/booklet.ts turns an offset
// into its thumb's transform.
//
// A pointer comes to the corner from the room: from above and to the right. So the front
// thumb is the one fanned out — up and right, toward the room, by CATALOG.stack — and the
// ones behind stay in the corner, only turned. What shows of the catalog is then a strip
// below and left of the manual, out of every path from the room to the manual (Ben's 1.9.1
// test: heading for the manual must never cross the catalog).

/** Each booklet's place in the stack, front to back. Mount the back ones first: paint order is mount order. */
export const STACK_SLOT = { manual: 0, catalog: 1 } as const;

/** The deepest place: the one that stays in the corner. */
export const STACK_DEPTH = Math.max(...Object.values(STACK_SLOT));

/**
 * Where thumb `slot` sits against the corner (CSS pixels, y down): each place nearer the
 * front fanned up and right by the stack knobs, and each place back turned (radians).
 */
export function fanOffset(slot: number, { fanX, fanY, fanTurn }: { fanX: number; fanY: number; fanTurn: number }) {
  const forward = STACK_DEPTH - slot;
  return { x: forward * fanX, y: -forward * fanY, turn: slot * fanTurn };
}
