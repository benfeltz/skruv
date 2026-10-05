// The telemetry sink: the session's most recent events, kept in a fixed-size ring and
// exported as one JSON file (the ?tune panel's session export). Local only — nothing
// is sent anywhere. Pure.

/** Bumped whenever the export's shape changes, so old exports stay readable. */
export const SESSION_FORMAT = 1;

/**
 * A ring of the last `size` events. `push(event)` adds one, dropping the oldest when full;
 * `events()` lists them oldest first; `toExportJson()` is the export, as JSON:
 * `{ format, session, startedAt, dropped, events }` — `dropped` counts events the ring
 * has let go of, so a truncated trace says so.
 */
export function createSessionBuffer({ size, session, startedAt }) {
  const ring = new Array(size);
  let count = 0;

  function push(event) {
    ring[count % size] = event;
    count++;
  }

  function events() {
    if (count <= size) return ring.slice(0, count);
    const start = count % size;
    return [...ring.slice(start), ...ring.slice(0, start)];
  }

  function toExport() {
    return { format: SESSION_FORMAT, session, startedAt, dropped: Math.max(0, count - size), events: events() };
  }

  return { push, events, toExport, toExportJson: () => JSON.stringify(toExport(), null, 2) };
}
