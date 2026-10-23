import type { FAN } from '../constants.js';

// The manuals' pocket (1.9.9.3, option B): the band's far end holds every world's manual. At rest it
// shows only the covers' edges, a spine; tapped, the covers come out as a row. Pure: src/ui/manualFan.ts
// applies the numbers.

type Fan = typeof FAN;

/**
 * Where each cover's edge lies across the spine (CSS px from its start), in the room's order, the open
 * manual's last and on top. They step `edgeStep` apart, closer when the spine (`room` px across) is too
 * narrow for that, and the run is centred in it.
 */
export function spineEdges(count: number, room: number, fan: Fan): number[] {
  if (count <= 0) return [];
  const free = room - 2 * fan.edgePad - fan.edge;
  const step = count === 1 ? 0 : Math.max(0, Math.min(fan.edgeStep, free / (count - 1)));
  const start = (room - fan.edge - step * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => start + i * step);
}

/** The spread row's length: every cover a pitch apart. */
export function rowLength(count: number, fan: Fan): number {
  return count <= 0 ? 0 : count * fan.cover + (count - 1) * fan.gap;
}

/** The pocket's accessible name. */
export function fanLabel(count: number): string {
  return `${count} ${count === 1 ? 'manual' : 'manuals'} in the room`;
}
