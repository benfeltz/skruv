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

  it("puts back only the player's parts and the lid, never the display shelf", () => {
    expect(world).toMatch(/const playerParts = parts\.filter\(\(part\) => !display\.parts\.includes\(part\) && part !== flatpack\.base && part !== flatpack\.lid\);/);
    expect(repack).not.toMatch(/display/);
    expect(repack).toMatch(/physics\.place\(body, position, rotation\)/);
  });

  it('stands a tilted box upright where it is before repacking into it (1.7.1)', () => {
    expect(repack).toMatch(/const upright = baseRest\(box\);\n\s+physics\.place\(flatpack\.base\.body, upright\.position, upright\.rotation\);/);
  });

  it('asks for a confirming second tap, inside the RESET window', () => {
    const button = read('src/ui/resetButton.ts');
    expect(button).toMatch(/setTimeout\(\(\) => arm\(false\), RESET\.confirmMs\)/);
    expect(button).toMatch(/if \(element\.dataset\.armed !== 'true'\) return arm\(true\);/);
  });
});

describe('recovery sweep (Feedback #9)', () => {
  const sweep = world.slice(world.indexOf('function sweep('), world.indexOf('bookletPages.prerender()'));

  it('judges escape against the ROOM constants, on the RESET interval', () => {
    expect(sweep).toMatch(/hasEscaped\(\[x, y, z\], ROOM, RESET\.escapeMargin\)/);
    expect(sweep).toMatch(/sweepIn = RESET\.sweepInterval;/);
  });

  it('respawns only loose player parts, never the display shelf', () => {
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
  it("lights only the player's set, and only while the booklet is open", () => {
    expect(world).toMatch(/createHighlight\(playerParts\)/);
    expect(world).toMatch(/expanded && shown\.kind === 'step' \? shown\.types : \[\]/);
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
  it.each(['src/main.ts', 'src/scene/itemWorld.ts', 'src/ui/booklet.ts', 'src/ui/resetButton.ts', 'src/scene/highlight.ts', 'src/scene/flatpack.ts', 'src/scene/displayShelf.ts', 'src/scene/bookletPages.ts'])(
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
    for (const path of ['items/johnny/flatpack.json', 'src/constants.ts', 'src/scene/bookletPages.ts', 'src/ui/booklet.ts', 'src/ui/resetButton.ts', 'src/game/bookletModel.ts', 'index.html']) {
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

  it('opens onto a control that is never disabled at that moment, the handle as the last resort', () => {
    expect(setOpen).toMatch(/\[next, prev, handle\]\.find\(\(control\) => !control\.disabled\)/);
    expect(setOpen).not.toMatch(/\(open \? next : thumb\)/);
    // The handle is never disabled anywhere.
    expect(booklet).not.toMatch(/handle\.disabled\s*=/);
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
    expect(world).toMatch(/createBookletSheet\(\{ pages: bookletPages, open: false \}\)/);
    // After BUILD IT, focus lands on the manual in front, never the catalog thumb behind it.
    expect(main).toMatch(/catalog\.setOpen\(false\);\s*\/\/[^\n]*\n\s*world\.booklet\.thumb\.focus\(\{ preventScroll: true \}\);/);
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

  it('raises a hovered thumb over the other in the corner stack, never over the scrim or sheet', () => {
    const hover = booklet.slice(booklet.indexOf('.booklet-thumb:hover {'), booklet.indexOf('.booklet-scrim {'));
    expect(hover).toMatch(/z-index: 1;/);
  });

  // A notice (a pick that would not build) must never push the controls off a short screen,
  // nor take a tap meant for BUILD IT: laid over the head of the page, out of the flow, deaf
  // to the pointer — and clear of the tag's rows even on a small phone held sideways.
  it('lays the notice over the head of the page, out of the flow, never over BUILD IT', () => {
    const notice = booklet.slice(booklet.indexOf('.booklet-notice {'), booklet.indexOf('`;', booklet.indexOf('.booklet-notice {')));
    expect(booklet).toMatch(/\.booklet-page \{ position: relative; \}/);
    expect(notice).toMatch(/position: absolute;/);
    expect(notice).toMatch(/top: \$\{BOOKLET_UI\.notice\.inset\}px;/);
    expect(notice).not.toMatch(/bottom:/);
    expect(notice).toMatch(/pointer-events: none;/);
    expect(booklet).toMatch(/view\.append\(notice\);/);

    // The page as drawn on a small phone sideways (320 CSS px tall), height-limited.
    const SCREEN_HEIGHT = 320;
    const [pageW, pageH] = BOOKLET.pageSize;
    const pageHeight = BOOKLET_UI.maxHeight * SCREEN_HEIGHT - BOOKLET_UI.chromeHeight;
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
    expect(booklet.slice(booklet.indexOf('    .booklet {'), booklet.indexOf(".booklet[data-open='true'] {"))).toMatch(/z-index: 3;/);
    expect(world).toMatch(/document\.body\.append\(booklet\.scrim, booklet\.thumb, booklet\.element\)/);
  });

  it('swallows the put-down tap in the booklet, never in the gesture router', () => {
    const scrimUp = booklet.slice(booklet.indexOf("scrim.addEventListener('pointerup'"), booklet.indexOf("thumb.addEventListener('click'"));
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
    expect(booklet).toMatch(/const thumbCanvas = pageCanvas\(pageW, pageH\);/);
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
