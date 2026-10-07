import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 1.5 game-flow rules that live in wiring (main.js) and DOM/scene modules — checked at the
// source, since the behaviour itself is a manual device check.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = read('src/main.js');
const router = read('src/scene/gestureRouter.js');

describe('repack reset (decision 9)', () => {
  const repack = main.slice(main.indexOf('function repack()'), main.indexOf('document.body.append(createResetButton'));

  it("tears down through the router's own unseat and reconcile — no parallel delete path", () => {
    expect(repack).toMatch(/router\.unseatAll\(playerParts\.map/);
    const unseatAll = router.slice(router.indexOf('unseatAll(ids) {'), router.indexOf('dispose() {'));
    expect(unseatAll).toMatch(/unseat\(joint\)/);
    expect(unseatAll).toMatch(/reconcile\(\)/);
    expect(unseatAll).not.toMatch(/physics\.unjoin|assembly\.unseat/);
  });

  it("puts back only the player's parts and the lid, never the display shelf", () => {
    expect(main).toMatch(/const playerParts = parts\.filter\(\(part\) => !display\.parts\.includes\(part\) && part !== flatpack\.lid\);/);
    expect(repack).not.toMatch(/display/);
    expect(repack).toMatch(/physics\.place\(body, position, rotation\)/);
  });

  it('asks for a confirming second tap, inside the RESET window', () => {
    const button = read('src/ui/resetButton.js');
    expect(button).toMatch(/setTimeout\(\(\) => arm\(false\), RESET\.confirmMs\)/);
    expect(button).toMatch(/if \(element\.dataset\.armed !== 'true'\) return arm\(true\);/);
  });
});

describe('recovery sweep (Feedback #9)', () => {
  const sweep = main.slice(main.indexOf('function sweep('), main.indexOf('createLoop('));

  it('judges escape against the ROOM constants, on the RESET interval', () => {
    expect(sweep).toMatch(/hasEscaped\(\[x, y, z\], ROOM, RESET\.escapeMargin\)/);
    expect(sweep).toMatch(/sweepIn = RESET\.sweepInterval;/);
  });

  it('respawns only loose player parts, never the display shelf', () => {
    expect(sweep).toMatch(/\[\.\.\.playerParts, flatpack\.lid\]/);
    expect(sweep).toMatch(/compoundOf\(id\)\.size === 1/);
    // One batch per sweep, so the parts recovered together are laid out together.
    expect(sweep).toMatch(/respawnSpots\(escaped\.map\(\(part\) => part\.type\)\)/);
  });
});

describe('highlight and booklet stay aids (decision 8)', () => {
  it("lights only the player's set, and only while the booklet is open", () => {
    expect(main).toMatch(/createHighlight\(playerParts\)/);
    expect(main).toMatch(/expanded && shown\.kind === 'step' \? shown\.types : \[\]/);
  });

  it('keeps the highlight out of the booklet DOM — main passes the page', () => {
    const highlight = read('src/scene/highlight.js');
    expect(highlight).not.toMatch(/from '[^']*booklet/);
    expect(highlight).not.toMatch(/\b(document|window)\./);
  });

  it('never feeds the booklet or highlight back into the assembly', () => {
    for (const path of ['src/ui/booklet.js', 'src/scene/highlight.js', 'src/scene/bookletPages.js']) {
      expect(read(path)).not.toMatch(/assembly|\.seat\(|\.apply\(|\.tap\(/);
    }
  });
});

describe('no audio (0.0.1)', () => {
  it.each(['src/main.js', 'src/ui/booklet.js', 'src/ui/resetButton.js', 'src/scene/highlight.js', 'src/scene/flatpack.js', 'src/scene/displayShelf.js', 'src/scene/bookletPages.js'])(
    '%s plays nothing',
    (path) => {
      expect(read(path)).not.toMatch(/\bAudio(Context|Listener)?\b|PositionalAudio|\.play\(/);
    },
  );
});

describe('branding (decision 4)', () => {
  // What a player sees: the booklet, its sheet, and the brand constants.
  it('names JOHNNY by SKRUV, and no real maker or document number, on anything the player sees', () => {
    const constants = read('src/constants.js');
    expect(constants).toMatch(/product: 'JOHNNY'/);
    expect(constants).toMatch(/maker: 'SKRUV'/);
    for (const path of ['src/constants.js', 'src/scene/bookletPages.js', 'src/ui/booklet.js', 'src/ui/resetButton.js', 'src/game/buildSteps.js']) {
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
  const booklet = read('src/ui/booklet.js');
  const setOpen = booklet.slice(booklet.indexOf('function setOpen('), booklet.indexOf("thumb.addEventListener('click'"));

  it('opens onto a control that is never disabled at that moment, the handle as the last resort', () => {
    expect(setOpen).toMatch(/\[next, prev, handle\]\.find\(\(control\) => !control\.disabled\)/);
    expect(setOpen).not.toMatch(/\(open \? next : thumb\)/);
    // The handle is never disabled anywhere.
    expect(booklet).not.toMatch(/handle\.disabled\s*=/);
  });
});

describe('boot with the manual up (1.6.1)', () => {
  const booklet = read('src/ui/booklet.js');

  it('opens on the cover, without moving focus onto a control', () => {
    expect(booklet).toMatch(/let page = 0;\s*let open = true;/);
    expect(booklet).toMatch(/element\.dataset\.splash = 'true'/);
  });

  it('puts the scrim over the room and under the sheet, mounted by main', () => {
    expect(booklet).toMatch(/\.booklet-scrim \{[^}]*position: fixed;[^}]*inset: 0;[^}]*z-index: 1;/);
    expect(booklet).toMatch(/\.booklet\[data-splash='true'\] \{ z-index: 2; \}/);
    expect(main).toMatch(/document\.body\.append\(booklet\.scrim, booklet\.thumb, booklet\.element\)/);
  });

  it('swallows the dismiss tap in the booklet, never in the gesture router', () => {
    const scrimUp = booklet.slice(booklet.indexOf("scrim.addEventListener('pointerup'"), booklet.indexOf("thumb.addEventListener('click'"));
    expect(booklet).toMatch(/pointerdown', \(event\) => \{\s*pressed\.add\(event\.pointerId\);/);
    expect(scrimUp).toMatch(/endSplash\(BOOKLET_UI\.splashLingerMs\);\s*setOpen\(false, \{ focus: false \}\);/);
    // Only a press that began on the scrim: a mouse pressed on the sheet and released off it
    // must not put the booklet down (PR #17 review).
    expect(scrimUp).toMatch(/if \(!pressed\.delete\(event\.pointerId\)\) return;\s*endSplash\(/);
    expect(router).not.toMatch(/booklet|splash|scrim/i);
  });

  it('ends the splash on any close, so the booklet is ordinary from then on', () => {
    const setOpen = booklet.slice(booklet.indexOf('function setOpen('), booklet.indexOf('// The tap that puts'));
    expect(setOpen).toMatch(/if \(!open\) endSplash\(\);/);
    const endSplash = booklet.slice(booklet.indexOf('function endSplash('), booklet.indexOf('function setOpen('));
    expect(endSplash).toMatch(/if \(!splash\) return;/);
    expect(endSplash).toMatch(/scrim\.remove\(\)/);
  });
});
