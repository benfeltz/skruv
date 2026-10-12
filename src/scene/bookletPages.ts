import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { BOOKLET, COLORS } from '../constants.js';
import { createBooklet } from '../game/bookletModel.js';
import { CONTROLS } from '../game/controlsPage.js';
import { ASSEMBLED, IDENTITY, MANIFEST, MANUAL, PART_TYPES, resolveConnector } from '../game/item.js';
import type { InstanceId } from '../game/item.js';
import type { BuildStep, PartCount } from '../game/bookletModel.js';
import type { PictogramId, Scheme } from '../game/controlsPage.js';
import type { Quat, Vec3 } from '../../tools/validate/lib/geometry.js';

// The booklet's pages, drawn from the same part models the room uses, so a page can never
// disagree with the geometry. Wordless, as the real thing is: a big step numeral, an
// outline drawing (this page's parts bold, what is already built pale), hardware count
// bubbles with their part numbers, and pictogram warning pages with faceless figures. The
// game's own controls page, before the back cover, is the one with words: a pictogram and
// a short label per row.
// WHAT each page shows is src/game/bookletModel.ts's; this module only draws. Branding is
// JOHNNY by SKRUV — black on white, no borrowed marks.

type Ctx = CanvasRenderingContext2D;
// A pictogram drawn into the rectangle [x, y, w, h].
type Draw = (ctx: Ctx, x: number, y: number, w: number, h: number) => void;
type Rect = [number, number, number, number];
type Weight = 'bold' | 'faint';

/** One part in an outline drawing: its type, its pose, and how heavily it is drawn. */
interface ViewItem {
  type: string;
  position: Vec3;
  rotation: Quat;
  weight: Weight;
}

/** A page being drawn: its canvas and that canvas's context. */
interface Sheet {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
const INK = css(COLORS.bookletInk);
const FAINT = css(COLORS.bookletFaint);
const PAPER = css(COLORS.bookletPaper);
const QUARTER_TURN = Math.SQRT1_2;
// How the carcass lies on a page. On its left side: a quarter turn about z lays -x down.
// Face down: a quarter turn about x lays the front (+z) down, back up.
const LYING = new THREE.Quaternion(0, 0, QUARTER_TURN, QUARTER_TURN);
const FACE_DOWN = new THREE.Quaternion(QUARTER_TURN, 0, 0, QUARTER_TURN);
const UPRIGHT = new THREE.Quaternion();
const ORIENTATION = { lying: LYING, faceDown: FACE_DOWN, upright: UPRIGHT };
// A loose panel is drawn lying on its largest face: the quarter turn that brings its
// thinnest axis (x, y or z) up.
const LAY_FLAT: THREE.Quaternion[] = [LYING, UPRIGHT, new THREE.Quaternion(-QUARTER_TURN, 0, 0, QUARTER_TURN)];
const font = (size: number, weight = 700) => `${weight} ${size}px ${BOOKLET.font}`;

// Render targets come back linear; the page canvas wants sRGB bytes.
const TO_SRGB = Uint8ClampedArray.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
});

/**
 * `{ count, canvas(index), prerender() }`. `canvas(index)` draws page `index` the first
 * time it is asked for and caches it; `prerender()` draws the rest one per idle slice, so
 * the first frame never waits on the booklet. Renders through `renderer` (the room's own
 * WebGL context) into an offscreen target and restores its state after every page. The
 * controls page shows `scheme`'s controls — the device in hand, as the caller reads it.
 */
export function createBookletPages(renderer: THREE.WebGLRenderer, { scheme }: { scheme: Scheme }) {
  const layout = ASSEMBLED;
  const pages = createBooklet(MANUAL.pages, {
    layout,
    manifest: MANIFEST,
    partTypes: PART_TYPES,
    resolve: resolveConnector,
    gamePages: [{ kind: 'controls', scheme }],
  });
  const [pageW, pageH] = BOOKLET.pageSize;
  const cache = new Map<number, HTMLCanvasElement>();
  const views = createViewRenderer(renderer);

  const partById = new Map(layout.parts.map((p) => [p.id, p]));
  const boldOf = (step: BuildStep) => {
    const ids = new Set(step.parts);
    for (const i of [...step.joints, ...step.turns]) {
      ids.add(layout.joints[i].hardware);
      ids.add(layout.joints[i].host);
    }
    return ids;
  };

  function newPage(): Sheet {
    const canvas = document.createElement('canvas');
    canvas.width = pageW;
    canvas.height = pageH;
    // A canvas always gives a 2D context the first time it is asked.
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, pageW, pageH);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return { canvas, ctx };
  }

  // An outline drawing of `items` into the rectangle [x, y, w, h] of the page.
  function drawView(ctx: Ctx, items: ViewItem[], [x, y, w, h]: Rect, orientation = UPRIGHT) {
    ctx.drawImage(views.render(items, Math.round(w), Math.round(h), orientation), x, y, w, h);
  }

  const itemsFor = (ids: Set<InstanceId>, bold: Set<InstanceId>): ViewItem[] =>
    // Every id drawn is a part of the layout.
    [...ids].map((id) => ({ ...partById.get(id)!, weight: bold.has(id) ? 'bold' : 'faint' }));

  // --- page kinds ---

  function cover({ ctx }: Sheet) {
    const m = BOOKLET.margin;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(124, 800);
    ctx.fillText(IDENTITY.product, m, m + 110);
    ctx.font = font(30, 600);
    ctx.fillText(IDENTITY.maker, m + 4, m + 158);
    const all = new Set(layout.parts.map((p) => p.id));
    drawView(ctx, itemsFor(all, all), [m, 240, pageW - 2 * m, pageH - 240 - m]);
  }

  function backCover({ ctx }: Sheet) {
    const m = BOOKLET.margin;
    ctx.fillStyle = INK;
    ctx.font = font(34, 800);
    ctx.fillText(IDENTITY.maker, m, pageH - m - 40);
    ctx.font = font(20, 500);
    ctx.fillText(IDENTITY.documentCode, m, pageH - m);
  }

  // Two panels side by side: what goes wrong (crossed) and what goes right (ticked).
  function doDontPanels(ctx: Ctx, drawBad: Draw, drawGood: Draw, solo = null) {
    const m = BOOKLET.margin;
    const half = (pageH - 3 * m) / 2;
    const frames: Rect[] = solo ? [[m, m, pageW - 2 * m, pageH - 2 * m]] : [[m, m, pageW - 2 * m, half], [m, 2 * m + half, pageW - 2 * m, half]];
    frames.forEach(([x, y, w, h], i) => {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      roundRect(ctx, x, y, w, h, 18);
      ctx.stroke();
      (i === 0 ? drawBad : drawGood)(ctx, x, y, w, h);
      mark(ctx, x + w - 62, y + 62, i === 0 ? 'cross' : 'tick');
    });
  }

  function warning({ ctx }: Sheet) {
    // One person wrestling a long panel alone; two people carrying it together.
    doDontPanels(
      ctx,
      (c, x, y, w, h) => {
        figure(c, x + w * 0.42, y + h * 0.82, 1.1, { lean: -0.35 });
        panelBar(c, x + w * 0.2, y + h * 0.28, x + w * 0.62, y + h * 0.78);
        c.font = font(64, 800);
        c.fillStyle = INK;
        c.fillText('?!', x + w * 0.6, y + h * 0.35);
      },
      (c, x, y, w, h) => {
        figure(c, x + w * 0.25, y + h * 0.82, 1.1);
        figure(c, x + w * 0.72, y + h * 0.82, 1.1, { flip: true });
        panelBar(c, x + w * 0.27, y + h * 0.5, x + w * 0.7, y + h * 0.5);
      },
    );
  }

  const doDont = {
    // A panel laid on the bare floor (scratched), and on its flattened box.
    protectFloor: (ctx: Ctx) =>
      doDontPanels(
        ctx,
        (c, x, y, w, h) => {
          floorLine(c, x, y, w, h);
          panelSlab(c, x + w * 0.2, y + h * 0.62, w * 0.6);
          scratches(c, x + w * 0.25, y + h * 0.72);
          scratches(c, x + w * 0.65, y + h * 0.72);
        },
        (c, x, y, w, h) => {
          floorLine(c, x, y, w, h);
          c.fillStyle = FAINT;
          c.fillRect(x + w * 0.12, y + h * 0.68, w * 0.76, 10);
          panelSlab(c, x + w * 0.2, y + h * 0.62, w * 0.6);
        },
      ),
    // A power drill, crossed; the screwdriver turned by hand, ticked.
    noPowerTools: (ctx: Ctx) =>
      doDontPanels(
        ctx,
        (c, x, y, w, h) => drill(c, x + w * 0.5, y + h * 0.55),
        (c, x, y, w, h) => {
          hand(c, x + w * 0.5, y + h * 0.58);
          turnArrow(c, x + w * 0.5, y + h * 0.3, 60);
        },
      ),
  };

  function inventory({ ctx }: Sheet, { items }: { items: PartCount[] }) {
    const m = BOOKLET.margin;
    const cols = 3;
    const cellW = (pageW - 2 * m) / cols;
    const cellH = (pageH - 2 * m) / Math.ceil(items.length / cols);
    items.forEach(({ type, count, partNumber }, i) => {
      const x = m + (i % cols) * cellW;
      const y = m + Math.floor(i / cols) * cellH;
      drawView(ctx, [single(type)], [x + 8, y + 4, cellW - 16, cellH - 58]);
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.font = font(30, 800);
      ctx.fillText(`${count}×`, x + cellW / 2, y + cellH - 26);
      ctx.font = font(18, 500);
      ctx.fillText(partNumber, x + cellW / 2, y + cellH - 4);
      ctx.textAlign = 'left';
    });
  }

  function step({ ctx }: Sheet, page: BuildStep) {
    const m = BOOKLET.margin;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(BOOKLET.numeralSize, 800);
    ctx.fillText(String(page.number), m - 6, m + BOOKLET.numeralSize * 0.78);

    // Count bubbles along the top, right of the numeral; the tool in hand after them.
    const r = BOOKLET.bubbleRadius;
    let bx = m + 190 + r;
    for (const { type, count, partNumber } of page.hardware) {
      bubble(ctx, bx, m + r, r);
      drawView(ctx, [single(type)], [bx - r * 0.62, m + r * 0.28, r * 1.24, r * 0.95]);
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.font = font(28, 800);
      ctx.fillText(`${count}×`, bx, m + 2 * r + 34);
      ctx.font = font(17, 500);
      ctx.fillText(partNumber, bx, m + 2 * r + 56);
      ctx.textAlign = 'left';
      bx += 2 * r + 28;
    }
    if (page.tool) {
      bubble(ctx, bx, m + r, r);
      drawView(ctx, [single(page.tool)], [bx - r * 0.7, m + r * 0.3, r * 1.4, r * 1.4]);
    }

    const frame: Rect = [m, m + 2 * r + 80, pageW - 2 * m, pageH - (2 * m + 2 * r + 80)];
    if (page.pose === 'parts') drawView(ctx, looseParts(page), frame);
    else drawView(ctx, itemsFor(new Set(page.shown), page.tip ? new Set() : boldOf(page)), frame, ORIENTATION[page.pose]);
    if (page.turns.length) turnArrow(ctx, frame[0] + frame[2] - 80, frame[1] + 70, 46);
    if (page.tip) {
      // Two people tip it up together: an arc over the drawing, a figure at each side.
      tipArrow(ctx, frame[0] + frame[2] * 0.5, frame[1] + frame[3] * 0.45, frame[2] * 0.36);
      figure(ctx, frame[0] + 60, frame[1] + frame[3] - 10, 1);
      figure(ctx, frame[0] + frame[2] - 60, frame[1] + frame[3] - 10, 1, { flip: true });
    }
  }

  // The controls page: a title, then each row's pictogram with its label beside it, in
  // columns down the page.
  function controls({ ctx }: Sheet, { scheme }: { scheme: Scheme }) {
    const m = BOOKLET.margin;
    const { titleSize, titleGap, columns, pictogram, pictogramLine, labelGap, labelSize, labelLeading } = BOOKLET.controls;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(titleSize, 800);
    ctx.fillText('Controls', m, m + titleSize);
    const rows = CONTROLS[scheme];
    const top = m + titleSize + titleGap;
    // Down the first column, then the next.
    const perColumn = Math.ceil(rows.length / columns);
    const cellW = (pageW - 2 * m) / columns;
    const cellH = (pageH - m - top) / perColumn;
    const labelW = cellW - pictogram - labelGap;
    rows.forEach(({ pictogram: id, label }, i) => {
      const x = m + Math.floor(i / perColumn) * cellW;
      const y = top + (i % perColumn) * cellH;
      const py = y + (cellH - pictogram) / 2;
      ctx.save();
      ctx.translate(x, py);
      ctx.scale(pictogram / PICTOGRAM_GRID, pictogram / PICTOGRAM_GRID);
      ctx.lineWidth = pictogramLine;
      ctx.strokeStyle = INK;
      ctx.fillStyle = PAPER;
      PICTOGRAMS[id](ctx, scheme);
      ctx.restore();
      ctx.fillStyle = INK;
      ctx.font = font(labelSize, 700);
      ctx.textBaseline = 'middle';
      const lines = wrap(ctx, label, labelW);
      const lineH = labelSize * labelLeading;
      lines.forEach((line, n) => ctx.fillText(line, x + pictogram + labelGap, y + cellH / 2 + (n - (lines.length - 1) / 2) * lineH));
      ctx.textBaseline = 'alphabetic';
    });
  }

  // A loose-parts page: each panel the page works on laid flat with its own hardware in it,
  // the panels fanned out one behind another.
  function looseParts(page: BuildStep) {
    const panels = [...new Set(page.joints.map((i) => layout.joints[i].host)), ...page.parts].filter(
      (id, i, all) => all.indexOf(id) === i,
    );
    const items: ViewItem[] = [];
    const pose = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const inverse = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let offset = 0;
    for (const id of panels) {
      const panel = partById.get(id)!;
      const size = PART_TYPES[panel.type].size;
      const flat = LAY_FLAT[size.indexOf(Math.min(...size))];
      inverse.compose(p.set(...panel.position), q.set(...panel.rotation), s.set(1, 1, 1)).invert();
      const hardware = page.joints.map((i) => layout.joints[i]).filter((j) => j.host === id).map((j) => partById.get(j.hardware)!);
      // Flat extent across the fan: this panel starts half of it past the last one's edge.
      const depth = Math.min(...size.filter((d) => d !== Math.min(...size)));
      offset += depth / 2;
      for (const part of [panel, ...hardware]) {
        local.compose(p.set(...part.position), q.set(...part.rotation), s.set(1, 1, 1));
        pose.makeRotationFromQuaternion(flat).multiply(inverse).multiply(local);
        pose.decompose(p, q, s);
        items.push({ ...part, position: [p.x, p.y, p.z + offset], rotation: q.toArray(), weight: 'bold' });
      }
      offset += depth / 2 + BOOKLET.fanGap;
    }
    return items;
  }

  const single = (type: string): ViewItem & { id: string } => ({ id: type, type, position: [0, 0, 0], rotation: [0, 0, 0, 1], weight: 'bold' });

  function draw(index: number) {
    const page = pages[index];
    const sheet = newPage();
    if (page.kind === 'cover') cover(sheet);
    else if (page.kind === 'backCover') backCover(sheet);
    else if (page.kind === 'warning') warning(sheet);
    // A doDont page's subject is one of these (the schema's key; the pack names it).
    else if (page.kind === 'doDont') doDont[page.subject as keyof typeof doDont](sheet.ctx);
    else if (page.kind === 'inventory') inventory(sheet, page);
    else if (page.kind === 'controls') controls(sheet, page);
    else step(sheet, page);
    return sheet.canvas;
  }

  function canvas(index: number) {
    if (!cache.has(index)) cache.set(index, draw(index));
    return cache.get(index)!;
  }

  function prerender() {
    const idle: (fn: () => void) => unknown = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1));
    const next = (i: number) => {
      if (i >= pages.length) return;
      idle(() => {
        canvas(i);
        next(i + 1);
      });
    };
    next(0);
  }

  return { count: pages.length, pages, canvas, prerender };
}

// Hidden-line outline renders: every part a white box (faces hide what lies behind) with
// its edges drawn as fat lines, bold or faint. Geometry is built once per part type.
function createViewRenderer(renderer: THREE.WebGLRenderer) {
  const fill = new THREE.MeshBasicMaterial({
    color: COLORS.bookletPaper,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const lines = {
    bold: new LineMaterial({ color: COLORS.bookletInk, linewidth: BOOKLET.boldLine }),
    faint: new LineMaterial({ color: COLORS.bookletFaint, linewidth: BOOKLET.faintLine }),
  };
  const geometries = new Map<string, { box: THREE.BoxGeometry; edges: LineSegmentsGeometry }>();
  const geometryOf = (type: string) => {
    if (!geometries.has(type)) {
      const box = new THREE.BoxGeometry(...PART_TYPES[type].size);
      geometries.set(type, { box, edges: new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(box)) });
    }
    return geometries.get(type)!;
  };
  const camera = new THREE.OrthographicCamera();
  const direction = new THREE.Vector3(...BOOKLET.viewDirection).normalize();
  const corner = new THREE.Vector3();
  const clearColor = new THREE.Color();

  function render(items: ViewItem[], width: number, height: number, orientation: THREE.Quaternion) {
    const scene = new THREE.Group();
    const root = new THREE.Group();
    root.quaternion.copy(orientation);
    scene.add(root);
    for (const { type, position, rotation, weight } of items) {
      const { box, edges } = geometryOf(type);
      const part = new THREE.Group();
      part.position.set(...position);
      part.quaternion.set(...rotation);
      part.add(new THREE.Mesh(box, fill), new LineSegments2(edges, lines[weight]));
      root.add(part);
    }
    scene.updateMatrixWorld(true);

    // Frame the drawing: every box corner in the camera's view, padded, at the frame's aspect.
    camera.position.copy(direction).multiplyScalar(50);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const view = new THREE.Box3();
    for (const part of root.children) {
      // Each part's first child is its box.
      const half = (part.children[0] as THREE.Mesh<THREE.BoxGeometry>).geometry.parameters;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        corner.set((sx * half.width) / 2, (sy * half.height) / 2, (sz * half.depth) / 2);
        view.expandByPoint(corner.applyMatrix4(part.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
      }
    }
    const centre = view.getCenter(new THREE.Vector3());
    const size = view.getSize(new THREE.Vector3());
    const pad = 1 + 2 * BOOKLET.framePadding;
    const span = Math.max(size.x / width, size.y / height) * pad;
    Object.assign(camera, {
      left: centre.x - (span * width) / 2,
      right: centre.x + (span * width) / 2,
      top: centre.y + (span * height) / 2,
      bottom: centre.y - (span * height) / 2,
      near: -view.max.z - 1,
      far: -view.min.z + 1,
    });
    camera.updateProjectionMatrix();
    for (const material of Object.values(lines)) material.resolution.set(width, height);

    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    const previous = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.setRenderTarget(target);
    renderer.setClearColor(COLORS.bookletPaper, 1);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clearColor, alpha);
    target.dispose();

    // Flip rows (GL reads bottom-up) and encode to sRGB.
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const image = new ImageData(width, height);
    for (let row = 0; row < height; row++) {
      const from = (height - 1 - row) * width * 4;
      for (let i = 0; i < width * 4; i += 4) {
        const to = row * width * 4 + i;
        image.data[to] = TO_SRGB[pixels[from + i]];
        image.data[to + 1] = TO_SRGB[pixels[from + i + 1]];
        image.data[to + 2] = TO_SRGB[pixels[from + i + 2]];
        image.data[to + 3] = 255;
      }
    }
    out.getContext('2d')!.putImageData(image, 0, 0);
    return out;
  }

  return { render };
}

// --- pictograms, canvas 2D ---

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function bubble(ctx: Ctx, x: number, y: number, r: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.stroke();
}

// A ticked or crossed circle: the do / don't marks.
function mark(ctx: Ctx, x: number, y: number, kind: 'tick' | 'cross') {
  const r = 38;
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  if (kind === 'tick') {
    ctx.moveTo(x - 18, y + 2);
    ctx.lineTo(x - 5, y + 16);
    ctx.lineTo(x + 19, y - 14);
  } else {
    ctx.moveTo(x - 16, y - 16);
    ctx.lineTo(x + 16, y + 16);
    ctx.moveTo(x + 16, y - 16);
    ctx.lineTo(x - 16, y + 16);
  }
  ctx.stroke();
}

// A faceless figure standing with its feet at (x, y): round blank head, rounded body.
function figure(ctx: Ctx, x: number, y: number, scale: number, { lean = 0, flip = false } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -scale : scale, scale);
  ctx.rotate(lean);
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.5 / scale;
  // Legs, body, arm reaching forward, head.
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.lineTo(-8, -70);
  ctx.moveTo(12, 0);
  ctx.lineTo(8, -70);
  ctx.stroke();
  roundRect(ctx, -22, -150, 44, 86, 20);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(14, -130);
  ctx.lineTo(48, -110);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -178, 22, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function panelBar(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 9;
  ctx.stroke();
}

function floorLine(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.06, y + h * 0.75);
  ctx.lineTo(x + w * 0.94, y + h * 0.75);
  ctx.stroke();
}

function panelSlab(ctx: Ctx, x: number, y: number, w: number) {
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - 30, y + 24);
  ctx.lineTo(x - 30, y + 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function scratches(ctx: Ctx, x: number, y: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    ctx.moveTo(x + i * 12, y + 10);
    ctx.lineTo(x + 18 + i * 12, y + 26);
  }
  ctx.stroke();
}

function drill(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  roundRect(ctx, x - 90, y - 70, 150, 64, 22);
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, x - 40, y - 8, 48, 110, 14);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 60, y - 38);
  ctx.lineTo(x + 120, y - 38);
  ctx.stroke();
  // Lightning marks: it is powered.
  ctx.beginPath();
  ctx.moveTo(x - 120, y - 110);
  ctx.lineTo(x - 104, y - 84);
  ctx.lineTo(x - 116, y - 84);
  ctx.lineTo(x - 98, y - 56);
  ctx.stroke();
}

// A fist round a screwdriver handle, blade down.
function hand(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  roundRect(ctx, x - 22, y - 80, 44, 120, 16);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + 40);
  ctx.lineTo(x, y + 130);
  ctx.stroke();
  roundRect(ctx, x - 52, y - 50, 104, 64, 26);
  ctx.fill();
  ctx.stroke();
}

// A curved arrow: turn it this way.
function turnArrow(ctx: Ctx, x: number, y: number, r: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 0.15, Math.PI * 1.55);
  ctx.stroke();
  const end = Math.PI * 1.55;
  const ex = x + r * Math.cos(end);
  const ey = y + r * Math.sin(end);
  ctx.beginPath();
  ctx.moveTo(ex + 16, ey - 2);
  ctx.lineTo(ex, ey);
  ctx.lineTo(ex + 6, ey + 16);
  ctx.stroke();
}

// A long arc over the drawing: tip it up.
function tipArrow(ctx: Ctx, x: number, y: number, r: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y + r, r, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  const end = Math.PI * 1.85;
  const ex = x + r * Math.cos(end);
  const ey = y + r + r * Math.sin(end);
  ctx.beginPath();
  ctx.moveTo(ex - 22, ey - 6);
  ctx.lineTo(ex, ey);
  ctx.lineTo(ex - 4, ey + 22);
  ctx.stroke();
}

// --- controls-page pictograms: drawn on a PICTOGRAM_GRID-unit square, ink on paper ---

const PICTOGRAM_GRID = 100;

// `text` broken into lines no wider than `width` in the context's font, at its spaces.
function wrap(ctx: Ctx, text: string, width: number) {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines.at(-1);
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function arrow(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 10;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1 - head * Math.cos(angle - 0.5), y1 - head * Math.sin(angle - 0.5));
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(angle + 0.5), y1 - head * Math.sin(angle + 0.5));
  ctx.stroke();
}

// Round (cx, cy) from angle `from` to `to`, its head at `to`.
function arcArrow(ctx: Ctx, cx: number, cy: number, r: number, from: number, to: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, from, to);
  ctx.stroke();
  const ex = cx + r * Math.cos(to);
  const ey = cy + r * Math.sin(to);
  // Along the tangent, a short step back from the end: the head's tail.
  const back = 0.3;
  arrow(ctx, cx + r * Math.cos(to - back), cy + r * Math.sin(to - back), ex, ey);
}

// A fingertip on the glass: a dot in a ring.
function touchPoint(ctx: Ctx, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = PAPER;
}

// A mouse pointer, its tip at (x, y).
function cursor(ctx: Ctx, x: number, y: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (const [dx, dy] of [[0, 28], [7, 21], [12, 32], [18, 29], [13, 19], [22, 19]]) ctx.lineTo(x + dx, y + dy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// A press where the scheme presses: a fingertip, or the pointer.
const press = (ctx: Ctx, scheme: Scheme, x: number, y: number) => (scheme === 'touch' ? touchPoint(ctx, x, y) : cursor(ctx, x, y));

// A mouse seen from above, centred on (x, y), its pressed part (a button or the wheel) inked.
function mouse(ctx: Ctx, x: number, y: number, lit: 'left' | 'right' | 'wheel') {
  roundRect(ctx, x - 16, y - 24, 32, 48, 15);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = INK;
  if (lit === 'left') ctx.fillRect(x - 16, y - 24, 16, 18);
  if (lit === 'right') ctx.fillRect(x, y - 24, 16, 18);
  ctx.restore();
  roundRect(ctx, x - 16, y - 24, 32, 48, 15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 16, y - 6);
  ctx.lineTo(x + 16, y - 6);
  ctx.moveTo(x, y - 24);
  ctx.lineTo(x, y - 6);
  ctx.stroke();
  if (lit === 'wheel') {
    ctx.fillStyle = INK;
    roundRect(ctx, x - 4, y - 20, 8, 12, 4);
    ctx.fill();
    ctx.fillStyle = PAPER;
  }
}

// The Shift key.
function shiftKey(ctx: Ctx, x: number, y: number) {
  roundRect(ctx, x - 20, y - 14, 40, 28, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = font(20, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⇧', x, y + 1);
  ctx.textAlign = 'left';
  ctx.fillStyle = PAPER;
}

// A panel edge-on, and a dowel standing in or over it.
function slab(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
}

function floor(ctx: Ctx, x0: number, x1: number, y: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
}

function dashed(ctx: Ctx, draw: () => void) {
  ctx.save();
  ctx.setLineDash([5, 5]);
  draw();
  ctx.restore();
}

const PICTOGRAMS: Readonly<Record<PictogramId, (ctx: Ctx, scheme: Scheme) => void>> = Object.freeze({
  orbit: (ctx, scheme) => {
    if (scheme === 'touch') touchPoint(ctx, 50, 55);
    else mouse(ctx, 50, 55, 'left');
    arcArrow(ctx, 50, 55, 36, Math.PI * 0.15, Math.PI * 1.55);
  },
  zoomPan: (ctx) => {
    touchPoint(ctx, 38, 62);
    touchPoint(ctx, 62, 38);
    arrow(ctx, 28, 72, 10, 90);
    arrow(ctx, 72, 28, 90, 10);
  },
  pan: (ctx) => {
    mouse(ctx, 24, 55, 'right');
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) arrow(ctx, 72, 55, 72 + 22 * dx, 55 + 22 * dy);
  },
  zoom: (ctx) => {
    mouse(ctx, 34, 55, 'wheel');
    arrow(ctx, 74, 48, 74, 18);
    arrow(ctx, 74, 62, 74, 92);
  },
  select: (ctx, scheme) => {
    ctx.beginPath();
    ctx.ellipse(50, 64, 44, 18, 0, 0, 2 * Math.PI);
    ctx.stroke();
    slab(ctx, 20, 56, 60, 16);
    arcArrow(ctx, 50, 64, 44, Math.PI * 1.15, Math.PI * 1.5);
    press(ctx, scheme, 50, 62);
  },
  move: (ctx, scheme) => {
    slab(ctx, 8, 56, 46, 16);
    arrow(ctx, 62, 64, 94, 64);
    press(ctx, scheme, 30, 62);
  },
  lift: (ctx) => {
    floor(ctx, 4, 66, 90);
    slab(ctx, 10, 34, 50, 14);
    arrow(ctx, 35, 84, 35, 56);
    // The lift line at the screen's edge, its knob under a finger.
    ctx.beginPath();
    ctx.moveTo(84, 8);
    ctx.lineTo(84, 92);
    ctx.stroke();
    touchPoint(ctx, 84, 40);
  },
  hold: (ctx) => {
    shiftKey(ctx, 26, 20);
    floor(ctx, 6, 94, 90);
    slab(ctx, 34, 46, 56, 14);
    dashed(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(62, 62);
      ctx.lineTo(62, 88);
      ctx.stroke();
    });
  },
  height: (ctx) => {
    shiftKey(ctx, 24, 20);
    mouse(ctx, 24, 66, 'wheel');
    slab(ctx, 52, 44, 42, 12);
    arrow(ctx, 73, 38, 73, 10);
    arrow(ctx, 73, 62, 73, 92);
  },
  seat: (ctx) => {
    // Carried over the hole, its ghost already in it: let go.
    slab(ctx, 8, 68, 84, 20);
    dashed(ctx, () => ctx.strokeRect(45, 54, 10, 26));
    slab(ctx, 45, 6, 10, 32);
    arrow(ctx, 76, 14, 76, 52);
  },
  pushHome: (ctx, scheme) => {
    slab(ctx, 8, 62, 84, 20);
    slab(ctx, 45, 40, 10, 34);
    arrow(ctx, 80, 18, 80, 52);
    press(ctx, scheme, 50, 34);
  },
  turnTool: (ctx, scheme) => {
    slab(ctx, 8, 74, 84, 16);
    // An Allen key in a bolt head, and the circle that turns it.
    ctx.beginPath();
    ctx.ellipse(44, 74, 12, 5, 0, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth *= 1.8;
    ctx.beginPath();
    ctx.moveTo(44, 72);
    ctx.lineTo(44, 34);
    ctx.lineTo(80, 34);
    ctx.stroke();
    ctx.lineWidth /= 1.8;
    // The circle round the bolt, seen at a slant.
    ctx.beginPath();
    ctx.ellipse(44, 62, 36, 12, 0, Math.PI * 0.05, Math.PI * 1.75);
    ctx.stroke();
    arrow(ctx, 44 + 36 * Math.cos(Math.PI * 1.6), 62 + 12 * Math.sin(Math.PI * 1.6), 44 + 36 * Math.cos(Math.PI * 1.75), 62 + 12 * Math.sin(Math.PI * 1.75));
    press(ctx, scheme, 80, 34);
  },
  pullApart: (ctx, scheme) => {
    slab(ctx, 8, 66, 84, 20);
    ctx.fillStyle = INK;
    ctx.fillRect(45, 66, 10, 14);
    ctx.fillStyle = PAPER;
    slab(ctx, 45, 16, 10, 34);
    arrow(ctx, 80, 54, 80, 14);
    press(ctx, scheme, 50, 20);
  },
  flip: (ctx, scheme) => {
    roundRect(ctx, 26, 8, 48, 64, 4);
    ctx.fill();
    ctx.stroke();
    for (const y of [26, 38, 50]) floor(ctx, 34, 66, y);
    arrow(ctx, 80, 88, 22, 88);
    press(ctx, scheme, 80, 86);
  },
  repack: (ctx) => {
    slab(ctx, 18, 50, 64, 40);
    ctx.beginPath();
    ctx.moveTo(18, 50);
    ctx.lineTo(8, 38);
    ctx.moveTo(82, 50);
    ctx.lineTo(92, 38);
    ctx.stroke();
    arrow(ctx, 50, 6, 50, 42);
    ctx.fillStyle = INK;
    ctx.font = font(22, 800);
    ctx.fillText('×2', 62, 26);
    ctx.fillStyle = PAPER;
  },
});
