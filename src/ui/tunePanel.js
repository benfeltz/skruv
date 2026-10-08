import { COLORS, TUNE } from '../constants.js';

// The tuning drawer, only on a ?tune URL: a gear tab top-left opens a bottom sheet of
// sliders over the running game, one per live knob, grouped as the registry groups them.
// A slider moved is felt on the next frame. It also restores the defaults, saves and loads
// feel profiles, and exports the session's events — the telemetry sink. The panel renders
// the registry's schema and knows no knob of its own. Follows the src/ui pattern (own
// element, own style, colours from COLORS).

const STYLE_ID = 'skruv-tune-panel';
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .tune-tab {
      position: fixed;
      left: calc(16px + env(safe-area-inset-left));
      top: calc(16px + env(safe-area-inset-top));
      width: 44px;
      height: 44px;
      padding: 0;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 22px;
      background: ${css(COLORS.uiSurface)}e6;
      color: ${css(COLORS.uiText)};
      font: 600 22px/1 system-ui, -apple-system, sans-serif;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      cursor: pointer;
    }
    .tune-tab[aria-expanded='true'] {
      border-color: ${css(COLORS.uiAccent)};
      color: ${css(COLORS.uiAccent)};
    }
    .tune {
      position: fixed;
      left: 50%;
      bottom: 0;
      z-index: 10;
      transform: translate(-50%, 100%);
      width: min(100vw, ${TUNE.panelMaxWidth}px);
      max-height: ${TUNE.panelMaxHeight * 100}dvh;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 12px 16px calc(14px + env(safe-area-inset-bottom));
      border-radius: 18px 18px 0 0;
      background: ${css(COLORS.uiSurface)};
      color: ${css(COLORS.uiText)};
      font: 500 14px/1.3 system-ui, -apple-system, sans-serif;
      box-shadow: 0 -8px 30px #0008;
      transition: transform 220ms ease-out, visibility 0s linear 220ms;
      visibility: hidden;
    }
    .tune[data-open='true'] {
      transform: translate(-50%, 0);
      transition: transform 220ms ease-out;
      visibility: visible;
    }
    @media (prefers-reduced-motion: reduce) {
      .tune, .tune[data-open='true'] { transition: none; }
    }
    .tune-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-bottom: 10px; }
    .tune-bar h2 { margin: 0 auto 0 0; font: 700 16px/1 system-ui, -apple-system, sans-serif; }
    .tune button {
      min-height: 44px;
      padding: 0 14px;
      border: 2px solid ${css(COLORS.uiText)}33;
      border-radius: 22px;
      background: none;
      color: ${css(COLORS.uiText)};
      font: 600 14px/1 system-ui, -apple-system, sans-serif;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      cursor: pointer;
    }
    .tune-tab:focus-visible, .tune button:focus-visible, .tune input:focus-visible {
      outline: 2px solid ${css(COLORS.uiAccent)};
      outline-offset: 3px;
    }
    .tune-status { min-height: 1.3em; margin: 0 0 6px; color: ${css(COLORS.uiAccent)}; font-size: 13px; }
    .tune-knobs { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    .tune fieldset { margin: 0 0 12px; padding: 0; border: 0; }
    .tune legend {
      padding: 0 0 4px;
      color: ${css(COLORS.uiText)}99;
      font: 700 12px/1 system-ui, -apple-system, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .tune-knob { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 6px 0; }
    .tune-knob label { font-weight: 600; overflow-wrap: anywhere; }
    .tune-knob output { font-variant-numeric: tabular-nums; }
    .tune-knob[data-changed='true'] output { color: ${css(COLORS.uiAccent)}; }
    .tune-knob input { grid-column: 1 / -1; width: 100%; min-height: 32px; margin: 0; accent-color: ${css(COLORS.uiAccent)}; }
    .tune-knob small { grid-column: 1 / -1; color: ${css(COLORS.uiText)}99; }
  `;
  document.head.append(style);
}

// Enough decimals to show one slider step.
const decimals = (step) => Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));

// Radians read as degrees; every other unit as stored.
function format(value, { unit, step }) {
  if (unit === 'rad') return `${(value * DEGREES_PER_RADIAN).toFixed(decimals(step * DEGREES_PER_RADIAN))}°`;
  return `${value.toFixed(decimals(step))}${unit ? ` ${unit}` : ''}`;
}

function download(name, json) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), TUNE.downloadRevokeMs);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function button(label, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

/**
 * `{ tab, element }` to mount. `tunables` is the registry (src/game/tunables.ts);
 * `exportSession()` returns the session buffer's JSON for download.
 */
export function createTunePanel({ tunables, exportSession }) {
  injectStyle();

  const element = document.createElement('section');
  element.className = 'tune';
  element.id = 'skruv-tune';
  element.setAttribute('aria-label', 'Tuning');

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'tune-tab';
  tab.textContent = '⚙';
  tab.setAttribute('aria-label', 'Tuning');
  tab.setAttribute('aria-controls', element.id);

  const status = document.createElement('p');
  status.className = 'tune-status';
  status.setAttribute('role', 'status');
  const say = (text) => (status.textContent = text);

  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (!file) return;
    try {
      const { skipped } = tunables.applyProfile(JSON.parse(await file.text()));
      say(skipped.length ? `Profile loaded; skipped ${skipped.join(', ')}` : 'Profile loaded');
    } catch (error) {
      say(`Not loaded: ${error.message}`);
    }
  });

  const title = document.createElement('h2');
  title.textContent = 'Tune';
  const bar = document.createElement('div');
  bar.className = 'tune-bar';
  bar.append(
    title,
    button('Defaults', () => {
      tunables.reset();
      say('Defaults restored');
    }),
    button('Save profile', () => download(`skruv-profile-${stamp()}.json`, JSON.stringify(tunables.toProfile(), null, 2))),
    button('Load profile', () => fileInput.click()),
    button('Export session', () => download(`skruv-session-${stamp()}.json`, exportSession())),
    button('Close', () => setOpen(false)),
  );

  // One row per knob: name, readout, slider, description.
  const rows = new Map();
  const knobs = document.createElement('div');
  knobs.className = 'tune-knobs';
  const groups = new Map();
  for (const knob of tunables.list()) {
    if (!groups.has(knob.group)) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = knob.group;
      fieldset.append(legend);
      groups.set(knob.group, fieldset);
      knobs.append(fieldset);
    }
    const row = document.createElement('div');
    row.className = 'tune-knob';
    const id = `tune-${knob.key.replace('.', '-')}`;
    const label = Object.assign(document.createElement('label'), { htmlFor: id, textContent: knob.key });
    const output = Object.assign(document.createElement('output'), { htmlFor: id });
    const input = Object.assign(document.createElement('input'), { type: 'range', id, min: knob.min, max: knob.max, step: knob.step });
    const desc = Object.assign(document.createElement('small'), { textContent: knob.desc });
    input.addEventListener('input', () => tunables.set(knob.key, Number(input.value)));
    row.append(label, output, input, desc);
    groups.get(knob.group).append(row);
    rows.set(knob.key, { row, output, input, knob });
  }

  function show(key, value) {
    const { row, output, input, knob } = rows.get(key);
    input.value = String(value);
    output.textContent = format(value, knob);
    row.dataset.changed = String(value !== knob.default);
  }
  for (const { key, value } of tunables.list()) show(key, value);
  // Every change, however it came (slider, defaults, a profile, the dev socket), shows here.
  tunables.subscribe(show);

  element.append(bar, status, knobs, fileInput);

  function setOpen(open) {
    element.dataset.open = String(open);
    tab.setAttribute('aria-expanded', String(open));
    if (open) say('');
  }
  tab.addEventListener('click', () => setOpen(element.dataset.open !== 'true'));
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      tab.focus();
    }
  });
  setOpen(false);

  return { tab, element };
}
