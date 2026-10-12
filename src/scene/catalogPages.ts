import * as THREE from 'three';
import { BOOKLET, CATALOG, COLORS } from '../constants.js';
import { rotatedHalfExtents } from '../game/dragMath.js';
import { itemById } from '../game/item.js';
import { createViewRenderer } from './bookletPages.js';
import type { CatalogPage } from '../game/catalogModel.js';
import type { ViewItem } from './bookletPages.js';
import type { Size, Vec3 } from '../../tools/validate/lib/geometry.js';

// The catalog's pages (1.9.1), drawn live from the real packs in the booklet's own register:
// black line art on white paper, the same hidden-line renders as the manual
// (bookletPages.ts `createViewRenderer`). The cover is SKRUV over a wire-drawn room corner
// with every item standing in it, built; an item page is the item, its name, how many parts
// are in its box, and the BUILD IT tag — or a SOLD OUT stamp, with the space under it held
// for a store link. WHAT the pages are is src/game/catalogModel.ts's; this module only
// draws. The BUILD IT hit target is the booklet sheet's (src/ui/booklet.ts), laid over
// CATALOG.page.action.

type Ctx = CanvasRenderingContext2D;
type Rect = [number, number, number, number];

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const INK = css(COLORS.bookletInk);
const FAINT = css(COLORS.bookletFaint);
const PAPER = css(COLORS.bookletPaper);
const font = (size: number, weight = 700) => `${weight} ${size}px ${BOOKLET.font}`;
// A view item's type names its item too: `johnny/sidePanel`, or `room/floor` for the cover's walls.
const typeOf = (item: string, type: string) => `${item}/${type}`;

/**
 * `{ count, pages, canvas(index), prerender(), dispose() }` for the catalog `pages`, the
 * shape the booklet sheet takes. `canvas(index)` draws page `index` the first time it is
 * asked for and caches it; `prerender()` draws the rest one per idle slice. Renders through
 * `renderer` (the room's WebGL context), as the manual's pages do.
 */
export function createCatalogPages(renderer: THREE.WebGLRenderer, pages: readonly CatalogPage[]) {
  const [pageW, pageH] = BOOKLET.pageSize;
  const m = BOOKLET.margin;
  const { page: layout, words } = CATALOG;

  // Every box the drawings use, by view type: each item's part types, and the cover's room.
  const sizes = new Map<string, Size>();
  const items = pages.flatMap((page) => (page.kind === 'item' ? [page.id] : []));
  for (const id of items) for (const [type, { size }] of Object.entries(itemById(id).partTypes)) sizes.set(typeOf(id, type), size);
  const views = createViewRenderer(renderer, (type) => sizes.get(type)!);

  const cache = new Map<number, HTMLCanvasElement>();

  function newPage() {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    // A canvas always gives a 2D context the first time it is asked.
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, pageW, pageH);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'alphabetic';
    return { canvas, ctx };
  }

  function drawView(ctx: Ctx, viewItems: ViewItem[], [x, y, w, h]: Rect) {
    ctx.drawImage(views.render(viewItems, Math.round(w), Math.round(h)), x, y, w, h);
  }

  // Item `id` built, as its pack poses it, moved by `offset`: its parts, drawn `weight`.
  const built = (id: string, offset: Vec3, weight: ViewItem['weight']): ViewItem[] =>
    itemById(id).assembled.parts.map(({ type, position, rotation }) => ({
      type: typeOf(id, type),
      position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]],
      rotation,
      weight,
    }));

  // Item `id` built: how far it reaches either way along x and z, and how tall it stands.
  function bounds(id: string) {
    const { assembled, partTypes } = itemById(id);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const { type, position, rotation } of assembled.parts) {
      const half = rotatedHalfExtents(partTypes[type].size.map((d) => d / 2), rotation);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], position[i] - half[i]);
        max[i] = Math.max(max[i], position[i] + half[i]);
      }
    }
    return { min, max };
  }

  // SKRUV over a room corner — floor, back wall, left wall, all faint — with every item
  // standing in it, built and bold, side by side along the back wall.
  function cover(ctx: Ctx) {
    ctx.fillStyle = INK;
    ctx.font = font(layout.wordmarkSize, 800);
    ctx.fillText(words.brand, m, m + layout.wordmarkSize * 0.8);
    ctx.font = font(layout.taglineSize, 600);
    ctx.fillText(words.tagline, m + 6, m + layout.wordmarkSize * 0.8 + layout.taglineSize * 1.6);

    const { gap, margin, wallRise, slab } = CATALOG.cover;
    const viewItems: ViewItem[] = [];
    let x = 0;
    let depth = 0;
    let height = 0;
    for (const id of items) {
      const { min, max } = bounds(id);
      // Back face against the line z = 0, left edge at x.
      viewItems.push(...built(id, [x - min[0], -min[1], -min[2]], 'bold'));
      x += max[0] - min[0] + gap;
      depth = Math.max(depth, max[2] - min[2]);
      height = Math.max(height, max[1] - min[1]);
    }
    const width = Math.max(0, x - gap) + 2 * margin;
    const floorDepth = depth + 2 * margin;
    const wall = height * wallRise;
    const room: { name: string; size: Size; at: Vec3 }[] = [
      { name: 'floor', size: [width, slab, floorDepth], at: [width / 2 - margin, -slab / 2, floorDepth / 2 - margin] },
      { name: 'back', size: [width, wall, slab], at: [width / 2 - margin, wall / 2, -margin - slab / 2] },
      { name: 'left', size: [slab, wall, floorDepth], at: [-margin - slab / 2, wall / 2, floorDepth / 2 - margin] },
    ];
    for (const { name, size, at } of room) {
      sizes.set(typeOf('room', name), size);
      viewItems.push({ type: typeOf('room', name), position: at, rotation: [0, 0, 0, 1], weight: 'faint' });
    }
    const top = m + layout.wordmarkSize + layout.taglineSize * 2.4;
    drawView(ctx, viewItems, [m, top, pageW - 2 * m, pageH - top - m]);
  }

  // The item built, its name and box count, and BUILD IT or SOLD OUT.
  function item(ctx: Ctx, page: Extract<CatalogPage, { kind: 'item' }>) {
    ctx.fillStyle = INK;
    ctx.font = font(layout.nameSize, 800);
    ctx.fillText(page.name, m, m + layout.nameSize * 0.8);
    ctx.font = font(layout.detailSize, 600);
    ctx.fillText(`${page.partCount} ${words.parts}`, m + 4, m + layout.nameSize * 0.8 + layout.detailSize * 1.6);
    const top = m + layout.nameSize + layout.detailSize * 2.4;
    const [, actionY] = layout.action;
    drawView(ctx, built(page.id, [0, 0, 0], 'bold'), [m, top, pageW - 2 * m, actionY - top - m]);
    if (page.pickable) tag(ctx, words.build);
    else stamp(ctx, words.soldOut);
  }

  // The price tag in the catalog's fiction: a filled ink tag with a punched hole, the words in paper.
  function tag(ctx: Ctx, text: string) {
    const [x, y, w, h] = layout.action;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, layout.tagRadius);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(x + h / 2, y + h / 2, layout.tagHole, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = font(layout.actionTextSize, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + (w + h / 2) / 2, y + h / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // A rubber stamp where the tag would be, tilted, outlined, faint ink; the link space under it stays blank.
  function stamp(ctx: Ctx, text: string) {
    const [x, y, w, h] = layout.action;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(layout.stampTurn);
    ctx.strokeStyle = FAINT;
    ctx.fillStyle = FAINT;
    ctx.lineWidth = layout.stampLine;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, layout.tagRadius);
    ctx.stroke();
    ctx.font = font(layout.actionTextSize, 800);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function draw(index: number) {
    const sheet = newPage();
    const page = pages[index];
    if (page.kind === 'cover') cover(sheet.ctx);
    else item(sheet.ctx, page);
    return sheet.canvas;
  }

  function canvas(index: number) {
    if (!cache.has(index)) cache.set(index, draw(index));
    return cache.get(index)!;
  }

  // Set by dispose(): a catalog put away for good stops drawing in idle time.
  let disposed = false;

  function prerender() {
    const idle: (fn: () => void) => unknown = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1));
    const next = (i: number) => {
      if (i >= pages.length) return;
      idle(() => {
        if (disposed) return;
        canvas(i);
        next(i + 1);
      });
    };
    next(0);
  }

  /** Stops any idle drawing still to come. */
  function dispose() {
    disposed = true;
  }

  return { count: pages.length, pages, canvas, prerender, dispose };
}

export type CatalogPages = ReturnType<typeof createCatalogPages>;
