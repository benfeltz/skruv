import * as THREE from 'three';
import { BOOKLET, CATALOG, COLORS } from '../constants.js';
import { itemPageLayout } from '../game/catalogLayout.js';
import { coverLayout, extentOf } from '../game/coverLayout.js';
import { itemById } from '../game/item.js';
import { createViewRenderer } from './bookletPages.js';
import { createPageCache, css, FAINT, font, INK, newPage, PAPER } from './pagePaper.js';
import type { CatalogPage, ItemPage } from '../game/catalogModel.js';
import type { ViewItem } from './bookletPages.js';
import { placeLayout } from '../../tools/validate/lib/geometry.js';
import type { Size, Vec3 } from '../../tools/validate/lib/geometry.js';

// The catalog's pages (1.9.1), drawn live from the real packs in the booklet's own register:
// black line art on white paper, the same hidden-line renders as the manual
// (bookletPages.ts `createViewRenderer`). The cover is SKRUV over a wire-drawn room corner
// with every item standing in it, built; an item page is the item, its name, how many parts
// is laid out like a catalog spread (1.9.1.1): a heavy rule, the category as the heading, the
// item's line drawing with a swatch per colourway, its bold name with category and size, a
// ruled row per colourway with its article number, the part count, and the OWN IT NOW! tag —
// or a SOLD OUT stamp, with the space under it held for a store link. WHAT the pages say is
// src/game/catalogModel.ts's and WHERE is src/game/catalogLayout.ts's; this module only
// draws. The tag's hit target is the booklet sheet's (src/ui/booklet.ts), laid over
// CATALOG.page.action, which the lines above never move.

type Ctx = CanvasRenderingContext2D;

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

  // Item `id` built, as its pack poses it, moved by `offset`: its parts, drawn `weight`.
  const built = (id: string, offset: Vec3, weight: ViewItem['weight']): ViewItem[] =>
    placeLayout(itemById(id).assembled.parts, { position: offset, rotation: [0, 0, 0, 1] }).map(({ type, position, rotation }) => ({
      type: typeOf(id, type),
      position,
      rotation,
      weight,
    }));

  // SKRUV over a room corner — floor, back wall, left wall, all faint — with every item
  // standing in it, built and bold, side by side along the back wall.
  function cover(ctx: Ctx) {
    ctx.fillStyle = INK;
    ctx.font = font(layout.wordmarkSize, 800);
    ctx.fillText(words.brand, m, m + layout.wordmarkSize * layout.baseline);
    ctx.font = font(layout.taglineSize, 600);
    ctx.fillText(words.tagline, m + layout.taglineIndent, m + layout.wordmarkSize * layout.baseline + layout.taglineSize * layout.subtitleDrop);

    const { offsets, room } = coverLayout(
      items.map((id) => {
        const { assembled, partTypes } = itemById(id);
        return extentOf(assembled.parts, (type) => partTypes[type].size);
      }),
      CATALOG.cover,
    );
    const viewItems: ViewItem[] = items.flatMap((id, i) => built(id, offsets[i], 'bold'));
    for (const { name, size, at } of room) {
      sizes.set(typeOf('room', name), size);
      viewItems.push({ type: typeOf('room', name), position: at, rotation: [0, 0, 0, 1], weight: 'faint' });
    }
    const top = m + layout.wordmarkSize + layout.taglineSize * layout.drawingDrop;
    views.draw(ctx, viewItems, [m, top, pageW - 2 * m, pageH - top - m]);
  }

  // A rule across the page's margins: its top edge and weight.
  function rule(ctx: Ctx, y: number, weight: number, left: number, right: number) {
    ctx.fillStyle = INK;
    ctx.fillRect(left, y, right - left, weight);
  }

  // The category as the heading, a heavy rule over it and a thin one under.
  function heading(ctx: Ctx, page: ItemPage, at: ReturnType<typeof itemPageLayout>) {
    rule(ctx, at.heavyRule, layout.heavyRule, at.left, at.right);
    ctx.fillStyle = INK;
    ctx.font = font(layout.headingSize, 800);
    ctx.fillText(page.category, at.left, at.headingBaseline);
    rule(ctx, at.thinRule, layout.thinRule, at.left, at.right);
  }

  // One filled circle per variant in its colour, ink-ringed, stacked up from the drawing's
  // foot at the right margin — beside the drawing, never over the item.
  function swatches(ctx: Ctx, page: ItemPage, at: ReturnType<typeof itemPageLayout>) {
    const [, y, , h] = at.drawing;
    const { swatchRadius: r, swatchGap, swatchRing } = layout;
    page.variants.forEach(({ color }, i) => {
      const cx = at.right - r;
      const cy = y + h - r - i * (2 * r + swatchGap);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fillStyle = css(COLORS[color as keyof typeof COLORS]);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = swatchRing;
      ctx.stroke();
    });
  }

  // The bold name, then category and `W×D×H cm` in regular weight, on one line.
  function nameLine(ctx: Ctx, page: ItemPage, at: ReturnType<typeof itemPageLayout>) {
    ctx.fillStyle = INK;
    ctx.font = font(layout.nameLineSize, 800);
    ctx.fillText(page.name, at.left, at.nameBaseline);
    const nameW = ctx.measureText(`${page.name} `).width;
    ctx.font = font(layout.nameLineSize, 500);
    ctx.fillText(`${page.category} ${page.size.join('×')} ${words.cm}`, at.left + nameW, at.nameBaseline);
  }

  // A row per variant: its name left, its article number right, a thin rule under it.
  function variantRows(ctx: Ctx, page: ItemPage, at: ReturnType<typeof itemPageLayout>) {
    ctx.fillStyle = INK;
    ctx.font = font(layout.rowSize, 600);
    page.variants.forEach(({ name, article }, i) => {
      const { baseline, rule: ruleY } = at.rows[i];
      ctx.textAlign = 'start';
      ctx.fillText(name, at.left, baseline);
      ctx.textAlign = 'right';
      ctx.fillText(article, at.right, baseline);
      rule(ctx, ruleY, layout.thinRule, at.left, at.right);
    });
    ctx.textAlign = 'start';
  }

  // Our own line, kept: how many parts are in the box.
  function partCount(ctx: Ctx, page: ItemPage, at: ReturnType<typeof itemPageLayout>) {
    ctx.fillStyle = INK;
    ctx.font = font(layout.detailSize, 600);
    ctx.fillText(`${page.partCount} ${words.parts}`, at.left, at.partCountBaseline);
  }

  // The item page: heading, the item built in its frame, swatches, name line, rows, the
  // part count, then the tag — or the SOLD OUT stamp in its place.
  function item(ctx: Ctx, page: ItemPage) {
    const at = itemPageLayout(page.variants.length);
    heading(ctx, page, at);
    views.draw(ctx, built(page.id, [0, 0, 0], 'bold'), at.drawing);
    swatches(ctx, page, at);
    nameLine(ctx, page, at);
    variantRows(ctx, page, at);
    partCount(ctx, page, at);
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
    // Centred on the tag right of the hole's square, [x + h, x + w], squeezed to fit it.
    ctx.fillText(text, x + (w + h) / 2, y + h / 2, w - h);
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

  return { count: pages.length, pages, ...createPageCache(pages.length, draw, views.dispose) };
}

export type CatalogPages = ReturnType<typeof createCatalogPages>;
