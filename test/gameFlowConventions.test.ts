import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOKLET, BOOKLET_UI, CATALOG } from '../src/constants.js';

// 1.5 game-flow rules that live in wiring (main.ts, and the item world it builds since
// 1.9.1: src/scene/itemWorld.ts) and DOM/scene modules — checked at the source, since the
// behaviour itself is a manual device check.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const world = read('src/scene/itemWorld.ts');
const main = read('src/main.ts');
const router = read('src/scene/gestureRouter.ts');

describe('repack reset (decision 9)', () => {
  const repack = world.slice(world.indexOf('function repack()'), world.indexOf('function liftablePart()'));

  it("tears down through the router's own unseat and reconcile — no parallel delete path", () => {
    expect(repack).toMatch(/router\.unseatAll\(playerParts\.map/);
    const unseatAll = router.slice(router.indexOf('unseatAll(ids) {'), router.indexOf('dispose() {'));
    expect(unseatAll).toMatch(/unseat\(joint\)/);
    expect(unseatAll).toMatch(/reconcile\(\)/);
    expect(unseatAll).not.toMatch(/physics\.unjoin|assembly\.unseat/);
  });

  it("puts back the player's parts and the lid; the box is only stood upright in place", () => {
    expect(world).toMatch(/const playerParts = parts\.filter\(\(part\) => part !== flatpack\.base && part !== flatpack\.lid\);/);
    expect(repack).toMatch(/physics\.place\(body, position, rotation\)/);
  });

  it('stands a tilted box upright where it is before repacking into it (1.7.1)', () => {
    expect(repack).toMatch(/const upright = baseRest\(box\);\n\s+physics\.place\(flatpack\.base\.body, upright\.position, upright\.rotation\);/);
  });

  it('runs only when a hold of RESET.holdMs completes — no tap-again label, no enlarged state', () => {
    const button = read('src/ui/resetButton.ts');
    expect(button).toMatch(/\}, RESET\.holdMs\);/);
    expect(button).not.toMatch(/Tap again|ARMED_LABEL|data-armed/);
  });
});

describe('recovery sweep (Feedback #9)', () => {
  const sweep = world.slice(world.indexOf('function sweep('), world.indexOf('bookletPages.prerender()'));

  it('judges escape against the ROOM constants, on the RESET interval', () => {
    expect(sweep).toMatch(/hasEscaped\(\[x, y, z\], ROOM, RESET\.escapeMargin\)/);
    expect(sweep).toMatch(/sweepIn = RESET\.sweepInterval;/);
  });

  it('respawns only loose player parts, the lid and the box', () => {
    expect(sweep).toMatch(/\[\.\.\.playerParts, flatpack\.lid, flatpack\.base\]/);
    expect(sweep).toMatch(/compoundOf\(id\)\.size === 1/);
    // One batch per sweep, so the parts recovered together are laid out together.
    expect(sweep).toMatch(/respawnSpots\(loose\.map\(\(part\) => part\.type\), boxPose\(\)\)/);
  });

  it('sends an escaped box back where it last sat in the room, not into the respawn patch (1.7.1)', () => {
    expect(sweep).toMatch(/if \(!escaped\.includes\(flatpack\.base\)\) lastBox = boxPose\(\);/);
    expect(sweep).toMatch(/const back = baseRest\(lastBox\);\n\s+physics\.place\(flatpack\.base\.body, back\.position, back\.rotation\);/);
  });
});

describe('highlight and booklet stay aids (decision 8)', () => {
  it("lights only the player's set, from the centre page, open or not (1.9.1.2)", () => {
    expect(world).toMatch(/createHighlight\(playerParts\)/);
    expect(world).toMatch(/highlight\.show\(shown\.kind === 'step' \? shown\.types : \[\]\)/);
    // Never conditioned on the page being open.
    expect(world).not.toMatch(/expanded && shown/);
  });

  it('keeps the highlight out of the booklet DOM — main passes the page', () => {
    const highlight = read('src/scene/highlight.ts');
    expect(highlight).not.toMatch(/from '[^']*booklet/);
    expect(highlight).not.toMatch(/\b(document|window)\./);
  });

  it('never feeds the booklet or highlight back into the assembly', () => {
    for (const path of ['src/ui/booklet.ts', 'src/scene/highlight.ts', 'src/scene/bookletPages.ts']) {
      expect(read(path)).not.toMatch(/assembly|\.seat\(|\.apply\(|\.tap\(/);
    }
  });
});

describe('no audio (0.0.1)', () => {
  it.each(['src/main.ts', 'src/scene/itemWorld.ts', 'src/ui/booklet.ts', 'src/ui/resetButton.ts', 'src/scene/highlight.ts', 'src/scene/flatpack.ts', 'src/scene/bookletPages.ts'])(
    '%s plays nothing',
    (path) => {
      expect(read(path)).not.toMatch(/\bAudio(Context|Listener)?\b|PositionalAudio|\.play\(/);
    },
  );
});

describe('branding (decision 4)', () => {
  // What a player sees: the booklet, its sheet, and the pack's identity (1.7).
  it('names JOHNNY by SKRUV, and no real maker or document number, on anything the player sees', () => {
    const { identity } = JSON.parse(read('items/johnny/flatpack.json'));
    expect(identity.product).toBe('JOHNNY');
    expect(identity.maker).toBe('SKRUV');
    for (const path of ['items/johnny/flatpack.json', 'src/constants.ts', 'src/scene/bookletPages.ts', 'src/ui/booklet.ts', 'src/ui/resetButton.ts', 'src/game/bookletModel.ts', 'web/index.html']) {
      expect(read(path)).not.toMatch(/IKEA|Billy|BILLY|AA-\d/);
    }
  });
});

describe('repack frees the player\'s parts from anything holding them (PR #12 review)', () => {
  it('has other joints let go of the repacked parts before unseating', () => {
    const unseatAll = router.slice(router.indexOf('unseatAll(ids) {'), router.indexOf('dispose() {'));
    expect(unseatAll.indexOf('assembly.letGoOf(ids)')).toBeGreaterThan(-1);
    expect(unseatAll.indexOf('assembly.letGoOf(ids)')).toBeLessThan(unseatAll.indexOf('unseat(joint)'));
  });
});

describe('booklet focus (PR #12 review)', () => {
  const booklet = read('src/ui/booklet.ts');
  const setOpen = booklet.slice(booklet.indexOf('function setOpen('), booklet.indexOf("thumb.addEventListener('click'"));

  it('opens onto the next arrow, which is only ever aria-disabled — focus is never lost at the last page', () => {
    expect(setOpen).toMatch(/\(open \? arrows\.next : \(carousel\?\.centre\(\) \?\? thumb\)\)\?\.focus/);
    expect(booklet).not.toMatch(/\.disabled\s*=/);
  });
});

describe('boot with the catalog up (1.9.1); tap off to put a booklet down (1.6.1)', () => {
  const booklet = read('src/ui/booklet.ts');

  it('opens on the cover, without moving focus onto a control', () => {
    // A sheet starts on its cover, open unless told otherwise. Since 1.9.1 the catalog is the
    // one that boots up; a manual arrives docked, since a pick goes straight into the room.
    expect(booklet).toMatch(/open: startsOpen = true/);
    expect(booklet).toMatch(/let page = 0;\s*let open = startsOpen;/);
    expect(main).toMatch(/createCatalogSheet\(\{\s*pages: catalogPages,\s*open: true,/);
    expect(world).toMatch(/createBookletSheet\(\{ pages: bookletPages, open: false, docked: 'strip', blocking: false \}\)/);
    // After BUILD IT, focus lands on the manual's strip, never the catalog thumb behind it.
    expect(main).toMatch(/catalog\.setOpen\(false\);\s*\/\/[^\n]*\n\s*world\.booklet\.focus\(\);/);
  });

  // Each booklet has a corner of its own (1.9.1.5): no stack to fan, so no knob to re-place.
  it('has no corner stack to re-place on a tune change', () => {
    expect(main).not.toMatch(/\.place\(\)|group === 'catalog'/);
  });

  it('grows and raises a hovered thumb only after the pointer rests thumbHoverDelayMs, and undoes it at once', () => {
    const delay = '${BOOKLET_UI.thumbHoverDelayMs}ms';
    const hover = booklet.slice(booklet.indexOf('.booklet-thumb:hover {'), booklet.indexOf('.booklet-scrim {'));
    expect(hover).toContain(`transition: width 160ms ease-out ${delay}, z-index 0s ${delay};`);
    // Leaving: the base rule's transition has no delay.
    const base = booklet.slice(booklet.indexOf('.booklet-thumb {'), booklet.indexOf('.booklet-thumb:hover {'));
    expect(base).toMatch(/transition: width 160ms ease-out, z-index 0s;/);
    // Reduced motion: no animation, the same wait.
    expect(booklet).toContain(`.booklet-thumb:hover { transition: width 0s ${delay}, z-index 0s ${delay}; }`);
  });

  it('raises a hovered thumb over its neighbours, never over the scrim or sheet', () => {
    const hover = booklet.slice(booklet.indexOf('.booklet-thumb:hover {'), booklet.indexOf('.booklet-scrim {'));
    expect(hover).toMatch(/z-index: 1;/);
  });

  // A notice (a pick that would not build) must never push the controls off a short screen,
  // nor take a tap meant for BUILD IT: laid over the head of the page, out of the flow, deaf
  // to the pointer — and clear of the tag's rows even on a small phone held sideways.
  it('lays the notice over the head of the page, out of the flow, never over BUILD IT', () => {
    const notice = booklet.slice(booklet.indexOf('.booklet-notice {'), booklet.indexOf('\n    }', booklet.indexOf('.booklet-notice {')));
    expect(booklet.slice(booklet.indexOf('.booklet-page {'), booklet.indexOf('.booklet-page canvas {'))).toMatch(/position: relative;/);
    expect(notice).toMatch(/position: absolute;/);
    expect(notice).toMatch(/top: \$\{BOOKLET_UI\.notice\.inset\}px;/);
    expect(notice).not.toMatch(/bottom:/);
    expect(notice).toMatch(/pointer-events: none;/);
    expect(booklet).toMatch(/view\.append\(notice\);/);

    // The page as drawn on a small phone sideways (320 CSS px tall), height-limited.
    const SCREEN_HEIGHT = 320;
    const [pageW, pageH] = BOOKLET.pageSize;
    const pageHeight = BOOKLET_UI.maxHeight * SCREEN_HEIGHT;
    const pageWidth = (pageHeight * pageW) / pageH;
    const { size, lineHeight, inset, padding } = BOOKLET_UI.notice;
    // Wrapped at about half an em a character (system-ui runs narrower), every line counted.
    const perLine = Math.floor((pageWidth - 2 * inset - 2 * padding) / (size / 2));
    const lines = Math.ceil(CATALOG.words.buildFailed.length / perLine);
    const noticeBottom = inset + 2 * padding + lines * size * lineHeight;
    const tagTop = (CATALOG.page.action[1] / pageH) * pageHeight;
    expect(noticeBottom).toBeLessThan(tagTop);
  });

  it('puts the scrim over the room and the sheet over the scrim, mounted by the item world', () => {
    expect(booklet).toMatch(/\.booklet-scrim \{[^}]*position: fixed;[^}]*inset: 0;[^}]*z-index: 2;/);
    expect(booklet.slice(booklet.indexOf('    .booklet-leaf {'), booklet.indexOf(".booklet-leaf[data-open='true'] {"))).toMatch(/z-index: 3;/);
    // The catalog is blocking and mounts its scrim; the manual is not, and has none to mount.
    expect(main).toMatch(/document\.body\.append\(catalog\.scrim, catalog\.thumb, catalog\.element\)/);
    expect(world).toMatch(/document\.body\.append\(booklet\.thumb, booklet\.element\)/);
    expect(world).not.toMatch(/booklet\.scrim/);
  });

  it('swallows the put-down tap in the booklet, never in the gesture router', () => {
    const scrimUp = booklet.slice(booklet.indexOf("scrim?.addEventListener('pointerup'"), booklet.indexOf("thumb.addEventListener('click'"));
    expect(booklet).toMatch(/pointerdown', \(event\) => \{\s*pressed\.add\(event\.pointerId\);/);
    // Only a press that began on the scrim, and only while open (PR #17 review, test plan).
    expect(scrimUp).toMatch(/if \(!pressed\.delete\(event\.pointerId\) \|\| !open\) return;\s*setOpen\(false, \{ byRoomTap: true \}\);/);
    expect(router).not.toMatch(/booklet|splash|scrim/i);
  });

  it('raises the scrim on every open and drops it on every close', () => {
    const setOpen = booklet.slice(booklet.indexOf('function setOpen('), booklet.indexOf('// The tap that puts'));
    expect(setOpen).toMatch(/showScrim\(open, byRoomTap \? BOOKLET_UI\.scrimLingerMs : 0\);/);
  });

  it('grows the docked thumbnail to a readable quarter of the screen under a mouse only — never a sticky hover on touch', () => {
    const hover = booklet.slice(booklet.indexOf('@media (hover: hover)'), booklet.indexOf('.booklet-scrim {'));
    expect(hover).toMatch(/\.booklet-thumb:hover \{\s*width: min\(\$\{BOOKLET_UI\.thumbHoverShare \* 100\}vw, \$\{BOOKLET_UI\.thumbHoverShare \* 100\}vh \* \$\{pageW\} \/ \$\{pageH\}\);/);
    // Grown from its corner (it is anchored left/bottom), animated, and drawn at full page
    // resolution so it reads when grown.
    const thumbRule = booklet.slice(booklet.indexOf('    .booklet-thumb {'), booklet.indexOf('@media (hover: hover)'));
    // Animated; since 1.9.1 the raise (z-index) rides along, both undone at once on leave.
    expect(thumbRule).toMatch(/transition: width 160ms ease-out, z-index 0s;/);
    expect(booklet).toMatch(/const thumbCanvas = stripped \? null : pageCanvas\(pageW, pageH\);/);
    // Nothing transforms the scrim (PR #17 round-4 review).
    const scrimRule = booklet.slice(booklet.indexOf('.booklet-scrim {'), booklet.indexOf('.booklet-thumb canvas'));
    expect(scrimRule).not.toMatch(/transform|transition/);
  });
});

describe('tap the open manual to put it down, swipe to flip (1.6.2)', () => {
  const booklet = read('src/ui/booklet.ts');
  const sheetTap = booklet.slice(booklet.indexOf('let sheetPress: '), booklet.indexOf("thumb.addEventListener('click'"));

  it('tells a tap from a swipe by the GESTURE tap thresholds, never a number of its own', () => {
    expect(booklet).toMatch(/import \{[^}]*\bGESTURE\b[^}]*\} from '\.\.\/constants\.js';/);
    expect(sheetTap).toMatch(/<= GESTURE\.tapMaxDistance/);
    expect(sheetTap).toMatch(/<= GESTURE\.tapMaxMs/);
    expect(sheetTap).not.toMatch(/swipeDistance/);
    expect(sheetTap.replace(/event\.button === 0/, '')).not.toMatch(/\b\d+\b/);
  });

  it("leaves every button on the sheet its own job, and closes as the room's tap does", () => {
    expect(sheetTap).toMatch(/\(event\.target as Element\)\.closest\('button'\)/);
    expect(sheetTap).toMatch(/setOpen\(false, \{ byRoomTap: true \}\)/);
  });
});

// 1.9.7.1.1: Repack and Snap rotate are reached through the menu button in the upper-right row.
describe('the menu button wiring', () => {
  it('holds Repack and Snap rotate, and sits in the cluster', () => {
    expect(main).toMatch(/const repack = createResetButton\(/);
    expect(main).toMatch(/menu\.add\(repack\.element, \{ onClose: repack\.cancel \}\)/);
    expect(main).toMatch(/menu\.add\(snapRotate\.element\)/);
    expect(main).toMatch(/cluster\.add\(menu\.element\)/);
  });

  it("closes the menu after Repack's confirming tap, and adds the gear after the menu", () => {
    expect(main).toMatch(/items\.current\?\.repack\(\);\s+menu\.close\(\);/);
    expect(main.indexOf('cluster.add(menu.element)')).toBeLessThan(main.indexOf('cluster.add(panel.tab)'));
  });
});

describe("the manual's band shrinks the room's view (1.9.7.1.2)", () => {
  const booklet = read('src/ui/booklet.ts');
  const cluster = read('src/ui/controlCluster.ts');

  it("names the root variables once, and #app, the cluster and the lift line read exactly those", () => {
    expect(booklet).toContain("const STRIP_VARS = { bottom: '--strip-bottom', left: '--strip-left', right: '--strip-right', backdrop: '--backdrop' } as const;");
    const html = read('web/index.html');
    expect(html).toContain('inset: 0 var(--strip-right, 0px) var(--strip-bottom, 0px) var(--strip-left, 0px);');
    expect(html).toContain('background: var(--backdrop, #1b1d22);');
    // The cluster sits just inside the view, past the notch's margin, never in its column (Ben's phone,
    // 2026-10-18: the Dynamic Island covered it there); the lift line, hung under the menu, follows.
    expect(cluster).toContain('env(safe-area-inset-left)');
    expect(cluster).not.toContain('--rail-x');
    expect(read('src/ui/liftLine.ts')).not.toContain('--rail-x');
    // The cluster is always upper left, so the drop always opens rightward, into the room.
    expect(read('src/ui/menuButton.ts')).not.toContain('data-strip');
  });

  it('has no arrow buttons on the strip: it is dragged, tapped and keyed', () => {
    expect(booklet).not.toContain('booklet-arrow');
  });
});

describe("the room's save wiring (1.9.9.5)", () => {
  it('writes through the web store under the SAVE key', () => {
    expect(main).toMatch(/createWebStore\(localStorage, SAVE\.key\)/);
  });

  it('snapshots every world the slot holds, never a current one alone', () => {
    expect(main).toMatch(/items\.all\(\)\.map\(/);
    expect(main).not.toMatch(/items\.current\?\.snapshot/);
  });

  it("flushes when the page goes hidden, and subscribes the saver to rest points, not to ANY", () => {
    expect(main).toMatch(/visibilitychange', \(\) => \{\n\s+if \(document\.visibilityState === 'hidden'\) saver\.flush\(\);/);
    expect(main).toMatch(/events\.on\(type, saver\.changed\)/);
    expect(main).not.toMatch(/events\.on\(ANY, saver/);
  });

  it('saves after a pick', () => {
    expect(main).toMatch(/function pickItem\(id: string\) \{[^}]*saver\.changed\(\);/);
  });
});

describe('the room restores at boot (1.9.9.1)', () => {
  it('restores before the loop starts', () => {
    expect(main.indexOf('planRestore(')).toBeGreaterThan(-1);
    expect(main.indexOf('planRestore(')).toBeLessThan(main.indexOf('createLoop('));
  });

  it('says so on the catalog with the CATALOG word, and in the console, never silently', () => {
    expect(main.match(/catalog\.notify\(CATALOG\.words\.restoreFailed\)/g)).toHaveLength(2);
    expect(main.match(/console\.info\('room: no save/g)).toHaveLength(1);
    expect(main.match(/console\.warn\('room: save not restored, starting empty'/g)).toHaveLength(2);
  });

  it('a failed restore empties the slot and drops the carried objects', () => {
    expect(main).toMatch(/items\.clear\(\);\n\s+carried = \[\];/);
  });

  it('the snapshot carries unknown objects', () => {
    expect(main).toMatch(/\[\.\.\.items\.all\(\)\.map\(\(world\) => world\.snapshot\(\)\), \.\.\.carried\]/);
    expect(main).not.toMatch(/items\.current\?\.snapshot/);
  });

  it("a world's page turns are rest points once built, but a restore is not one", () => {
    expect(main).toMatch(/const adopt = \(world: ItemWorld\) => world\.booklet\.onChange\(\(\) => restoring \|\| saver\.changed\(\)\);/);
    expect(main).toMatch(/restoring = false;/);
  });

  it('sets the sky through the room, never through the constant', () => {
    expect(main).toMatch(/room\.setPhase\(/);
    expect(main).not.toMatch(/STAGE\.sky\.phase =/);
  });

  it('the store is one object, read by the restore and written by the saver', () => {
    expect(main).toMatch(/planRestore\(store\.read\(\)/);
    expect(main).toMatch(/createRoomSaver\(\{\n\s+store,/);
  });
});

describe('the room of several worlds (1.9.9.2)', () => {
  const build = main.slice(main.indexOf('build: () => {'), main.indexOf('// The room\'s save'));

  it('a pick builds on a free spot and frames the camera there', () => {
    expect(build).toMatch(/freeSpot\(items\.all\(\)\.map\(\(w\) => w\.footprint\(\)\), boxFootprintSize\(packedBox\(\)\)\)/);
    expect(build).toMatch(/cameraControls\.frame\(framedAt\(at, startPose\(\)\)\)/);
  });

  it('a world is adopted where it is built, once: not in onPick, not in the restore loop', () => {
    expect(build).toMatch(/adopt\(world\);/);
    const onPick = main.slice(main.indexOf('function pickItem('), main.indexOf('// The restore (src/game/roomRestore.ts)'));
    expect(onPick).toMatch(/items\.pick\(id\)/);
    expect(onPick).not.toMatch(/adopt\(/);
    const restore = main.slice(main.indexOf('for (const record of plan.items)'), main.indexOf('cameraControls.frame(plan.world.camera)'));
    expect(restore).not.toMatch(/adopt\(/);
  });

  it('the camera pivots about any world', () => {
    expect(main).toMatch(/items\.all\(\)\.map\(\(w\) => w\.pickDistance/);
    expect(main).not.toMatch(/items\.current\?\.pickDistance/);
  });

  it('only the active world runs, renders and repacks', () => {
    expect(main).toMatch(/items\.current\?\.update\(delta\)/);
    expect(main).toMatch(/items\.current\?\.render\(/);
    expect(main).toMatch(/items\.current\?\.repack\(\)/);
    const loop = main.slice(main.indexOf('createLoop('), main.indexOf('}).start()'));
    // The kept worlds get the pack-free keep pass after the step, and nothing else.
    expect(loop).toMatch(/for \(const world of items\.all\(\)\) if \(world !== items\.current\) world\.keep\(\);/);
    expect(loop.match(/items\.all\(\)/g)).toHaveLength(1);
  });

  it('the restore takes every record, one world each, in the save order', () => {
    expect(main).not.toMatch(/capacity/);
    expect(read('src/game/roomRestore.ts')).not.toMatch(/capacity/);
    expect(main).toMatch(/for \(const record of plan\.items\) items\.pick\(record\.id\)\.restore\(record\);/);
  });
});

describe('the manuals are the switcher (1.9.9.3)', () => {
  it('the catalog and the fan share one pick path, the slot\'s, with the focus and the save', () => {
    expect(main.match(/items\.pick\(id\)/g)).toHaveLength(1);
    expect(main).toMatch(/function pickItem\(id: string\) \{\s*const world = items\.pick\(id\);\s*catalog\.setOpen\(false\);\s*\/\/[^\n]*\n\s*world\.booklet\.focus\(\);\s*saver\.changed\(\);\s*fan\.refresh\(\);/);
    expect(main.match(/onPick: \(id\) => pickItem\(id\)/g)).toHaveLength(2);
  });

  it('the fan is mounted, refreshed after the restore and the clear, and folded when the catalog opens', () => {
    expect(main).toMatch(/createManualFan\(\{ worlds: \(\) => items\.all\(\)/);
    expect(main).toMatch(/document\.body\.append\(fan\.element\)/);
    expect(main).toMatch(/catalog\.setOpen\(false\);\n\s+fan\.refresh\(\);/);
    expect(main).toMatch(/items\.clear\(\);\n\s+carried = \[\];\n\s+fan\.refresh\(\);/);
    expect(main).toMatch(/catalog\.onChange\(\(\{ expanded \}\) => \{\s*if \(expanded\) fan\.fold\(\);/);
  });

  it('the fan never touches a world beyond its cover and the slot\'s pick', () => {
    const fan = read('src/ui/manualFan.ts');
    expect(fan).not.toMatch(/\.(activate|deactivate|setShown|dispose)\(\)|from '\.\.\/scene/);
    expect(fan).not.toMatch(/\.pick\(/);
  });
});
