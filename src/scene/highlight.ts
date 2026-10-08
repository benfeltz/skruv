import { COLORS, HIGHLIGHT } from '../constants.js';
import type { Part } from '../game/partMesh.js';

/**
 * A slow glow on the parts the open booklet page is about — so a glance from page to room
 * finds them. An aid only: it checks nothing and blocks nothing. `parts` is the set it may
 * light (the player's own; main.ts leaves the display shelf out); `show(types)` lights every
 * one of those types, `show([])` turns it off. `update(delta)` once per frame.
 */
export function createHighlight(parts: Part[]) {
  let lit: Part[] = [];
  let time = 0;

  function clear() {
    for (const { mesh } of lit) {
      mesh.material.emissive.setHex(COLORS.unlit);
      mesh.material.emissiveIntensity = 1;
    }
    lit = [];
  }

  function show(types: Iterable<string>) {
    clear();
    const wanted = new Set(types);
    lit = parts.filter((part) => wanted.has(part.type));
    for (const { mesh } of lit) mesh.material.emissive.setHex(COLORS.highlight);
    time = 0;
  }

  function update(delta: number) {
    if (lit.length === 0) return;
    time += delta;
    const glow = HIGHLIGHT.intensity * (0.5 - 0.5 * Math.cos((2 * Math.PI * time) / HIGHLIGHT.period));
    for (const { mesh } of lit) mesh.material.emissiveIntensity = glow;
  }

  return { show, update };
}
