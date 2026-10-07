import { DEV_WS } from '../constants.js';
import { ANY } from '../game/events.js';

// Dev only: the page's end of the dev stream (the hub is the plugin in vite.config.js).
// Every bus event goes out; knob sets, knob listings and screenshots come in. Reached only
// through main.js's import.meta.env.DEV-guarded dynamic import, so a build never contains
// it (pinned by the dist hygiene check in test/conventions.test.js).

const { kinds } = DEV_WS;

/**
 * Connects to the dev hub and keeps reconnecting. `events` is the bus, `tunables` the
 * registry, `screenshot()` returns a PNG data URL of the canvas.
 */
export function connectDevStream({ events, tunables, screenshot }) {
  let socket = null;

  const send = (message) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  events.on(ANY, (event) => send({ kind: kinds.event, event }));

  function handle({ kind, id, key, value }) {
    try {
      if (kind === kinds.list) send({ kind: kinds.knobs, id, knobs: tunables.list() });
      else if (kind === kinds.set) {
        tunables.set(key, value);
        send({ kind: kinds.knobs, id, knobs: tunables.list() });
      } else if (kind === kinds.screenshot) send({ kind: kinds.image, id, dataUrl: screenshot() });
    } catch (error) {
      send({ kind: kinds.error, id, message: error.message });
    }
  }

  function connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${scheme}://${location.host}${DEV_WS.path}`);
    socket.addEventListener('open', () => send({ kind: kinds.hello, role: DEV_WS.gameRole }));
    socket.addEventListener('message', ({ data }) => {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      handle(message);
    });
    socket.addEventListener('close', () => setTimeout(connect, DEV_WS.retryMs));
  }

  connect();
}
