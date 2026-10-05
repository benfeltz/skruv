import { COLORS, HIGHLIGHT } from '../constants.js';

/**
 * A slow glow on the parts the open booklet page is about — so a glance from page to room
 * finds them. An aid only: it checks nothing and blocks nothing. `parts` is the set it may
 * light (the player's own; main.js leaves the display shelf out); `show(types)` lights every
 * one of those types, `show([])` turns it off. `update(delta)` once per frame.
 */
export function createHighlight(parts) {
  let lit = [];
  let time = 0;

  function clear() {
    for (const { mesh } of lit) {
      mesh.material.emissive.setHex(COLORS.unlit);
      mesh.material.emissiveIntensity = 1;
    }
    lit = [];
  }

  function show(types) {
    clear();
    const wanted = new Set(types);
    lit = parts.filter((part) => wanted.has(part.type));
    for (const { mesh } of lit) mesh.material.emissive.setHex(COLORS.highlight);
    time = 0;
  }

  function update(delta) {
    if (lit.length === 0) return;
    time += delta;
    const glow = HIGHLIGHT.intensity * (0.5 - 0.5 * Math.cos((2 * Math.PI * time) / HIGHLIGHT.period));
    for (const { mesh } of lit) mesh.material.emissiveIntensity = glow;
  }

  return { show, update };
}
