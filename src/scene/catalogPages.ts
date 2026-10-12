import * as THREE from 'three';
import { BOOKLET, CATALOG } from '../constants.js';
import { coverLayout, extentOf } from '../game/coverLayout.js';
import { itemById } from '../game/item.js';
import { createViewRenderer } from './bookletPages.js';
import { createPageCache, FAINT, font, INK, newPage, PAPER } from './pagePaper.js';
import type { CatalogPage } from '../game/catalogModel.js';
import type { ViewItem } from './bookletPages.js';
import { placeLayout } from '../../tools/validate/lib/geometry.js';
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

  // The item built, its name and box count, and BUILD IT or SOLD OUT.
  function item(ctx: Ctx, page: Extract<CatalogPage, { kind: 'item' }>) {
    ctx.fillStyle = INK;
    ctx.font = font(layout.nameSize, 800);
    ctx.fillText(page.name, m, m + layout.nameSize * layout.baseline);
    ctx.font = font(layout.detailSize, 600);
    ctx.fillText(`${page.partCount} ${words.parts}`, m + layout.detailIndent, m + layout.nameSize * layout.baseline + layout.detailSize * layout.subtitleDrop);
    const top = m + layout.nameSize + layout.detailSize * layout.drawingDrop;
    const [, actionY] = layout.action;
    views.draw(ctx, built(page.id, [0, 0, 0], 'bold'), [m, top, pageW - 2 * m, actionY - top - m]);
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
    // Centred on the tag right of the hole's square, [x + h, x + w].
    ctx.fillText(text, x + (w + h) / 2, y + h / 2);
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
