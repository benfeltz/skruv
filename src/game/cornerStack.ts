// The corner stack (1.9.1): the paper objects docked in the corner as thumbs — the current
// item's manual in front, the catalog behind it — each one back fanned out by CATALOG.stack.
// Pure: src/ui/booklet.ts turns an offset into its thumb's transform.

/** Each booklet's place in the stack, front to back. Mount the back ones first: paint order is mount order. */
export const STACK_SLOT = { manual: 0, catalog: 1 } as const;

/** How far a thumb `slot` places back sits from the front one: right and up (CSS pixels, y down) and turned (radians). */
export function fanOffset(slot: number, { fanX, fanY, fanTurn }: { fanX: number; fanY: number; fanTurn: number }) {
  return { x: slot * fanX, y: -slot * fanY, turn: slot * fanTurn };
}
