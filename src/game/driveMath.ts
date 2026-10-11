// Hold-to-drive and the ratchet: how far one held frame turns a fastener, and how many
// ratchet clicks a turn crosses. Pure — radians and seconds in, radians and counts out.

/** Radians one frame of `delta` seconds adds so a whole `span` takes `seconds`. */
export const driveRadians = (span: number, seconds: number, delta: number) => (span * delta) / seconds;

/**
 * Whole `step` boundaries crossed going from `before` to `after` radians, either way: a
 * fastener turned back clicks too. Positions are measured from fully out, so a boundary
 * clicks once however the turn is sliced into frames.
 */
export function ratchetTicks(before: number, after: number, step: number) {
  // A float landing a hair under a boundary (16 eighths of 4π) still counts as on it.
  const notch = (radians: number) => Math.floor(radians / step + Number.EPSILON * 64);
  return Math.abs(notch(after) - notch(before));
}
