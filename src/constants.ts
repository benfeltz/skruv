// Every tunable lives here — modules import names, never literals.
// Units: metres, seconds, radians.

import { CONTRACT } from '../tools/validate/lib/vocabulary.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';

export const ROOM = {
  width: 6,
  depth: 5,
  // The lift ceiling, well clear of the 2.02 m bookcase standing; the drawn walls are
  // shorter (see the stage's wall height).
  height: 3,
};

// Wall-clock units and the byte range of a hex colour channel, for the sky's clock and colour maths.
export const CLOCK = {
  secondsPerMinute: 60,
  minutesPerHour: 60,
  hoursPerDay: 24,
  channelMax: 255,
};

// The sky beyond the window by day: the day keyframe of STAGE.sky and COLORS.sky.
const SKY_DAY = 0x9ec9e8;

// The box's daylight in the dark: about a quarter of its midday brightness, dim but readable.
const NIGHT_LEVEL = 0.25;

// The scenery's paper tones (COLORS.scenery*): faint for the far hills, paper for the near ones, one between.
const SCENERY_FAINT = 0xd0d0d0;
const SCENERY_MID = 0xe2e0dc;
const SCENERY_PAPER = 0xf1eee6;

// The ink every outline draws in (src/scene/ink.ts): the room's and the box's edge lines in CSS pixels
// (LineMaterial linewidth against the canvas's CSS size); the parts' inverted hull in metres, world space,
// so a bolt and a panel carry the same weight; and the crease angle above which the box's edge pass
// draws a line — above the 30° facets of a 12-sided round, below the box's 90° corners. A hull
// vertex moves out far enough that every face meeting there is `hullWidth` thicker (a mitre); at
// a sharp corner that is capped at `hullMiter` hull widths, so a spike never shoots off a point.
export const INK = { lineWidth: 3, hullWidth: 0.002, boxCrease: 45, hullMiter: 2 };

// The diorama stage (src/game/stageBoxes.ts, built by src/scene/room.ts and mirrored by
// src/physics/world.ts): a base slab under the floor, two walls (back and left, with windows) and a low
// lip on the open front and right edges — every collider stands outside the floor's footprint,
// so every clamp that reads ROOM is unchanged. `ROOM.height` stays the lift ceiling. The
// window's casing, sill and apron are the one visual-only exception: up to casingProud +
// sillDepth inside the footprint at window height, with no colliders (a part pushed against
// the wall there draws through the trim).
export const STAGE = {
  wallThickness: 0.1,
  // Equal to the lift ceiling (ROOM.height): the walls stand as high as a lifted part can go.
  wallHeight: 3,
  slabThickness: 0.1,
  lipHeight: 0.03,
  lipThickness: 0.03,
  // The hardwood floor (src/game/floorPlanks.ts, drawn by src/scene/room.ts): boards `plankWidth` wide and
  // `plankThickness` thick laid in a running bond along the long wall over the whole slab top, their tops the floor
  // at y = 0 (the slab's drawn base sits under them; the collider is untouched). Lengths are drawn between
  // `plankLength`'s bounds by a seeded generator, so the floor is the same on every device. Metres. `tones` are the
  // planks' wood colours, drawn by the same layout (they live here, not in COLORS, which holds single colours);
  // COLORS.floor is the slab base under them.
  floor: {
    plankWidth: 0.12,
    plankThickness: 0.02,
    plankLength: [0.9, 1.8] satisfies [number, number],
    seed: 4127,
    // No board is shorter than `minEnd` (a leftover at the edge folds into its neighbour), and a butt joint keeps
    // `jointGap` from every joint of the row before, so no two read as one seam across rows.
    minEnd: 0.06,
    jointGap: 0.12,
    tones: [0xc9b79c, 0xbfa88a, 0xd4c3a8],
  },
  // The double-hung windows, all one design, spaced evenly along their wall: one in the left
  // wall (centred, z = 0) and two in the long back wall. All in metres.
  window: {
    // How many windows each wall carries.
    count: { left: 1, back: 2 },
    // The opening: its width along the wall, its height, and the height of its bottom edge.
    width: 1.0,
    height: 1.6,
    sill: 0.8,
    // The flat casing round the opening's sides and head: its band width and how far it stands proud of the wall.
    casing: 0.08,
    casingProud: 0.02,
    // The sill board: how far it sticks into the room past the casing, and its thickness.
    sillDepth: 0.06,
    sillThickness: 0.03,
    // The apron board under the sill: its height.
    apron: 0.06,
    // The thin frame in the opening (its band width and depth) and the horizontal meeting rail between the sashes.
    frame: 0.04,
    frameDepth: 0.04,
    rail: 0.04,
  },
  // The paper theatre behind each wall's windows (src/game/scenery.ts, built by src/scene/scenery.ts): a closed box
  // `depth` deep, its mouth on the wall's outer face. Lengths are metres; `base`, `horizon` and `rise` are fractions of
  // STAGE.wallHeight above the floor; every `depth` is metres behind the mouth.
  scenery: {
    depth: 1.2,
    // Three layers of rolling hills, far to near, each further back lower in amplitude and fainter in tone. Each: a
    // paper tone, a baseline (a fraction of the wall height), an amplitude and wavelength (metres), a phase, and a
    // second, finer wave (`ratio` of the wavelength, `weight` of the profile).
    hills: [
      { depth: 1.0, tone: SCENERY_FAINT, base: 0.52, amplitude: 0.07, wavelength: 3.0, phase: 1.0, ratio: 0.5, weight: 0.2 },
      { depth: 0.8, tone: SCENERY_MID, base: 0.46, amplitude: 0.1, wavelength: 2.6, phase: 0, ratio: 0.5, weight: 0.2 },
      { depth: 0.6, tone: SCENERY_PAPER, base: 0.4, amplitude: 0.14, wavelength: 2.4, phase: 2.1, ratio: 0.5, weight: 0.2 },
    ],
    // How many times a layer's phase the finer wave is turned by.
    hillPhaseScale: 2,
    // Samples along a hill's profile per metre of box width: fine enough that a smooth hill shows no corners.
    hillSamplesPerMetre: 40,
    // Drifting clouds, in layers at different depths and speeds so they move at different rates. A layer drifts as one
    // sheet: `drift` metres per second of game time, its clouds each at a fraction `at` across the box (a layer's
    // pattern repeats once a box width, so a cloud wraps round to the far side), a `height` up the wall as a fraction
    // of its height, and a `width` in metres. The fractions put at least one cloud in view of every window at the
    // start and the layers pass every window in turn. `outline` is a cloud's silhouette in unit width (x centred, y up
    // from its flat bottom).
    clouds: {
      layers: [
        {
          depth: 0.9,
          drift: 0.02,
          clouds: [{ at: 0.1, height: 0.66, width: 0.8 }, { at: 0.45, height: 0.6, width: 0.6 }, { at: 0.78, height: 0.64, width: 0.9 }],
        },
        {
          depth: 0.7,
          drift: 0.035,
          clouds: [{ at: 0.28, height: 0.68, width: 0.5 }, { at: 0.62, height: 0.62, width: 0.7 }, { at: 0.9, height: 0.66, width: 0.55 }],
        },
      ],
      outline: [
        [-0.5, 0], [0.5, 0], [0.5, 0.06], [0.4, 0.12], [0.36, 0.22], [0.24, 0.26], [0.16, 0.38], [0.04, 0.42],
        [-0.06, 0.36], [-0.14, 0.3], [-0.26, 0.3], [-0.34, 0.22], [-0.42, 0.14], [-0.5, 0.08],
      ] satisfies [number, number][],
    },
    // The sun and moon: discs on a layer just in front of the back panel, on one arc over the horizon.
    sun: { radius: 0.12, depth: 1.1 },
    moon: { radius: 0.1, depth: 1.1 },
    // Its arc runs through the windows' visible band: from the horizon, just above the near hills' line, up to a peak
    // that clears the head of the opening.
    arc: { horizon: 0.5, rise: 0.2 },
    // Segments round a disc's rim, and how far an outline stands in front of its fill so the two never fight for depth.
    discSegments: 32,
    inkLift: 0.002,
    // The back panel stands this far in front of the backlight behind it.
    backlight: { gap: 0.03 },
    // The box's daylight at each phase, 0 to 1 (1 at midday, `NIGHT_LEVEL` in the dark); the loop closes on the first.
    // One curve, two uses: the box's contents are dimmed by it, and the starlight behind the pinholes is its inverse,
    // so the two never drift apart. Stars need dark: none above `starsBelow`, rising to full at `nightLevel`. Pinned
    // here: none at dusk (0.75 to 0.88) or dawn (0.12 to 0.25), fading in 0.88 to 0.95 and out 0.05 to 0.12.
    nightLevel: NIGHT_LEVEL,
    starsBelow: 0.5,
    daylight: [
      { at: 0, level: NIGHT_LEVEL },
      { at: 0.05, level: NIGHT_LEVEL },
      { at: 0.12, level: 0.5 },
      { at: 0.25, level: 0.65 },
      { at: 0.5, level: 1 },
      { at: 0.75, level: 0.65 },
      { at: 0.88, level: 0.5 },
      { at: 0.95, level: NIGHT_LEVEL },
    ],
    // The night sky is one texture of two stacked strips, one per wall (`strip`), each covering the wall's face: `sky`
    // metres wide and high (the room's width by the wall height, floor at the strip's bottom), `texels` wide. Every
    // panel samples its own strip once, so a constellation appears once and not repeated.
    // A star is a pinhole: a disc, or for the brightest a four-point plus. Positions are metres from the strip's
    // lower left; radii are metres.
    stars: {
      sky: { width: 6, height: 3 },
      texels: 1024,
      strip: { back: 0, left: 1 },
      // The alpha a texel needs to be paper rather than hole.
      alphaTest: 0.5,
      // The scattered field: a seeded generator, how many stars a strip gets, their closest spacing and the clear space
      // kept round a constellation's star. Most are tiny (`dim` radii, skewed small by `skew`); a few (`brightShare`)
      // are bright plus-shaped ones.
      seed: 1913,
      count: 150,
      spacing: 0.08,
      clearance: 0.14,
      dim: { min: 0.005, max: 0.011 },
      skew: 2.5,
      brightShare: 0.06,
      bright: { min: 0.016, max: 0.024 },
      // A plus: its core as a share of the radius, its arms' length and thickness as multiples of the radius.
      plus: { core: 0.5, arm: 2.6, thickness: 0.4 },
      // Constellations in their real patterns: each star as its angular offset in degrees east and north of a datum (a
      // star of the pattern), laid out `metresPerDegree` on the sky from `at`. A `bright` star is a plus.
      constellations: [
        {
          name: 'Big Dipper',
          strip: 'back',
          at: [3.55, 1.75],
          metresPerDegree: 0.04,
          stars: [
            { dx: 0, dy: 5.8, bright: true }, // Dubhe
            { dx: -0.25, dy: 0.4, bright: false }, // Merak
            { dx: 7.06, dy: -2.3, bright: false }, // Phecda
            { dx: 10.1, dy: 1.0, bright: false }, // Megrez
            { dx: 15.5, dy: 0, bright: true }, // Alioth
            { dx: 19.7, dy: -1.1, bright: false }, // Mizar
            { dx: 23.0, dy: -6.7, bright: true }, // Alkaid
          ],
        },
        {
          name: 'Cassiopeia',
          strip: 'back',
          at: [1.7, 1.7],
          metresPerDegree: 0.05,
          stars: [
            { dx: 0, dy: 0, bright: false }, // Caph
            { dx: 4.0, dy: -2.6, bright: true }, // Schedar
            { dx: 6.0, dy: 1.6, bright: false }, // Gamma
            { dx: 9.6, dy: 1.1, bright: false }, // Ruchbah
            { dx: 13.2, dy: 4.6, bright: false }, // Segin
          ],
        },
        {
          name: "Orion's belt",
          strip: 'left',
          at: [2.8, 1.8],
          metresPerDegree: 0.2,
          stars: [
            { dx: 0, dy: 0, bright: true }, // Mintaka
            { dx: 1.05, dy: -0.9, bright: true }, // Alnilam
            { dx: 2.25, dy: -1.64, bright: true }, // Alnitak
          ],
        },
      ] satisfies { name: string; strip: 'back' | 'left'; at: [number, number]; metresPerDegree: number; stars: { dx: number; dy: number; bright: boolean }[] }[],
      // A constellation star's radius: dim ones, and bright (plus) ones.
      constellationRadius: { dim: 0.013, bright: 0.02 },
      // Twinkle: only `share` of the stars twinkle. A twinkling star's light swings between full and `1 - depth` of it
      // (never out, its size unchanged) over `period` seconds, from its own random phase so none pulse together; each
      // has its own swing, a `minSwing` to full share of `depth`. The backlight carries each star's phase and swing in a
      // zone `margin` metres wider than its hole, so a slanted view through the hole still finds them.
      twinkle: { share: 0.4, period: 4, depth: 0.45, minSwing: 0.4, margin: 0.05 },
    },
  },
  // The sky beyond the windows turns on game time (src/game/skyCycle.ts). The stage's light follows the same phase
  // (`light` below); the room's colours and the camera do not.
  sky: {
    // One full night-dawn-day-dusk cycle, in minutes of game time.
    cycleMinutes: 12,
    // Scrub: setting it (the ?tune knob) jumps the cycle to this phase (0 midnight, 0.5 noon); the loop keeps advancing from there.
    phase: 0.5,
    // Colour at each phase in [0, 1), ascending; the last blends back round to the first.
    keyframes: [
      { at: 0, color: 0x0b1026 },
      { at: 0.25, color: 0xf2a679 },
      { at: 0.5, color: SKY_DAY },
      { at: 0.75, color: 0xc2566b },
    ],
  },
  // The stage's light (src/game/stageLight.ts, src/scene/stageLight.ts): one sun on one arc, following the sky's phase.
  light: {
    // How bright the room stays at night, as a share of midday: the sun and the fill never fall below it. A ?tune knob
    // (stage.nightFloor); 1 turns the night dimming off.
    nightFloor: 0.3,
    // The sun's height above the horizon, degrees: `peak` at noon, `minElevation` at the horizon. Never lower, so the
    // light is never horizontal and shadows stay finite; at night it retraces the day's path, so shadows never flip.
    peak: 60,
    minElevation: 25,
    // The sun's compass bearing, degrees: 0 straight out through the left wall (-x), 90 out through the back wall (-z).
    // It turns from `rise` at dawn through 45 (over the back-left corner) at noon to `set` at dusk.
    azimuth: { rise: -30, set: 120 },
    // How far the light takes the sky's hue as the day fades, 0 (stays white) to 1 (the sky's full hue).
    tintDepth: 0.6,
    // The window patch on the floor (src/scene/windowPatches.ts).
    patch: {
      // Its opacity under the sun at noon; it scales with the light and the sun's height.
      opacity: 0.35,
    },
  },
};
export const COLORS = {
  background: 0x1b1d22,
  floor: 0xc9b79c,
  // The ink: the manual's, so the room, the parts and the booklet draw alike.
  ink: 0x1c1c1c,
  // The stage walls: white, like the catalog's paper (COLORS.bookletPaper).
  wall: 0xffffff,
  // The window's casing, sill, apron, frame and rail: white, like the wall.
  trim: 0xffffff,
  // The sky beyond the window by day — the day keyframe of STAGE.sky; the cycle animates it.
  sky: SKY_DAY,
  skyLight: 0xffffff,
  // Scenery (src/scene/scenery.ts): the box's inside, the paper cutouts (far, near hills), and the backlight at night.
  sceneryBoxInside: 0x2c2a33,
  sceneryFaint: SCENERY_FAINT,
  sceneryMid: SCENERY_MID,
  sceneryPaper: SCENERY_PAPER,
  starlight: 0xffffff,
  groundLight: 0x8a7a66,
  sunLight: 0xffffff,
  // Parts — keyed by the catalog's `color` field.
  partPanel: 0xf1eee6,
  // Panel colourways an item's variants name (identity.variants[].color), shown on the catalog's swatches.
  partPanelBlackBrown: 0x3b2f2a,
  partPanelBlack: 0x232323,
  partPanelGray: 0x8d9094,
  partHardboard: 0x9c8466,
  partDowel: 0xd8b27a,
  partMetal: 0xa7adb3,
  partWrench: 0x2f3136,
  partScrewdriver: 0xd9a21b,
  partFitting: 0x5d5853,
  // Second tones on a shaped piece (src/game/partShapes.ts): bare metal (the screwdriver's
  // blade and shaft) reuses partMetal; a recess, like the slot across a cam lock, is dark.
  partRecess: 0x2b2826,
  cardboard: 0xb48a5a,
  // Rotate gizmo rings, one per world axis, x/y/z in the usual red/green/blue.
  gizmoX: 0xe5534b,
  gizmoY: 0x6cc04a,
  gizmoZ: 0x4a8fe5,
  // DOM overlays (src/ui).
  uiSurface: 0x2a2d34,
  uiText: 0xf1eee6,
  uiAccent: 0xe0a64a,
  // The clear's red: the open manual's cover border and its badge's ring while held (src/ui/manualFan.ts).
  uiDanger: 0xd8553f,
  // Snap preview (src/scene/ghost.ts).
  ghost: 0xe0a64a,
  // The ghost, and the glow on the hole it seats in, when a panel's fit on offer is where it
  // goes in the finished item (src/game/panelFit.ts); any other fit keeps `ghost`'s amber.
  whereItGoes: 0x6cc46a,
  // Hole markings (src/game/decals.ts) and the flash when a fastener seats in one.
  decal: 0x3a3029,
  decalFlash: 0xe0a64a,
  // Drop line under a dragged part, and the glow on the hole it would drop onto.
  dropGuide: 0xe0a64a,
  // Emissive off: what a decal glows when it isn't flashing.
  unlit: 0x000000,
  // Sprue handle on a selected small part (src/scene/sprue.ts): model-kit plastic grey.
  sprue: 0x8f9a93,
  // Booklet pages (src/scene/bookletPages.ts): black line art on white paper, earlier
  // steps' parts in a pale grey.
  bookletPaper: 0xffffff,
  bookletInk: 0x1c1c1c,
  bookletFaint: 0xbdbdbd,
  // Placeholder green for the inset's controls (the turn ring's fill, a seated push arrow): the game is ink on paper, so this changes.
  insetFill: 0x2e9e4f,
  // Per-page highlight (src/scene/highlight.ts): the warm accent, glowing softly.
  highlight: 0xe0a64a,
  // Target rings on the fasteners a carried tool can work (src/scene/targetRings.ts).
  targetRing: 0xe0a64a,
};

// Per-page highlight (src/scene/highlight.ts): the parts the open booklet page is about
// glow up and down — an aid for matching page to room, never a gate.
export const HIGHLIGHT = {
  // Seconds per glow cycle, and the peak emissive intensity — subtle.
  period: 1.6,
  intensity: 0.35,
};

// Booklet pages (src/scene/bookletPages.ts), in page-canvas pixels: a portrait sheet drawn
// at twice the size it shows on a phone, so lines and numerals stay crisp.
export const BOOKLET = {
  pageSize: [720, 1000] satisfies [number, number],
  margin: 44,
  // Line weights of the outline renders: this page's parts, and earlier ones.
  boldLine: 3.2,
  faintLine: 1.6,
  // Isometric-ish view the outline renders are drawn from (towards the origin).
  viewDirection: [1.1, 0.9, 1.5] satisfies Vec3,
  // Space left round the drawing inside its frame, as a fraction.
  framePadding: 0.08,
  // Room between loose panels fanned out on a loose-parts page, in metres of the drawing.
  fanGap: 0.12,
  numeralSize: 150,
  // Exploded step drawings (src/game/explode.ts), in metres of the drawing along a hole's
  // axis: how far hardware floats out of its hole, how far a part pressed onto hardware is
  // pulled away, and (sub-assembly install pages, PR 2) a built assembly held off its place.
  // `leaderLine` is the weight of the faint line back from a floated fastener to its hole.
  // `cancel` is the length below which a part's pulls from opposing joints count as none.
  // `installDirection` is the way an install page holds its assembly off: with no joints to
  // give a direction, an assembly comes in from the front.
  explode: { hardware: 0.05, part: 0.2, assembly: 0.35, installDirection: [0, 0, 1] satisfies Vec3, leaderLine: 1, cancel: 1e-9 },
  // Detail insets (src/scene/bookletPages.ts `step`), page-canvas pixels except `focus`: one
  // circle per fastener type across the top, shrunk to fit the row. `float` is how far an inset
  // floats its fastener out of the hole, and `focus` how far it frames beyond the hole mouth and
  // the floated fastener, both as multiples of the fastener's longest side. `tool` is the tool's share of
  // the circle, drawn in its lower right; `toolOnly` its radius when a step fastens nothing.
  inset: {
    radius: 72,
    gap: 24,
    float: 0.5,
    focus: 0.55,
    ringLine: 3,
    tailLine: 2,
    tailDot: 5,
    tailBow: 0.12,
    tool: 0.46,
    toolOnly: 64,
    // Where the tool sits in the first inset, as a fraction of its radius from the centre, and
    // how much of the tool's own disc its drawing fills.
    // Below the ring's foot: the count's and the part number's baselines, and where a tail starts
    // (under both, so it never crosses them).
    countDrop: 34,
    partDrop: 56,
    tailFrom: 68,
    toolAt: 0.6,
    toolFill: 0.7,
    // The way an inset turns its hole's axis on the page: up, a little towards the viewer, so
    // the fastener always floats up off a face the viewer sees.
    lift: [0, 1, 0.35] satisfies Vec3,
  },
  // Action insets (src/game/explode.ts `actionFor`, drawn in src/scene/bookletPages.ts `step`): a
  // second circle linked to the first detail inset, the joint seated with the tool on it. `size` is
  // its radius as a share of the detail inset's; `at` the direction (times the two radii) from the
  // first slot's centre to its centre; `ring` the ring arrow's radius as a share of the circle's and
  // `sweep` its (from, to) angles in radians, drawn at `ringLine`; `focus` how far the view frames
  // beyond the tool's held tip, in multiples of the larger of the fastener's longest side and the tool's cross-section (a tool's own length would frame a screwdriver's whole shaft); `hold` how far the tool is held off the drive along its axis, as a share of the fastener's longest side, so the fastener shows under it.
  action: { size: 0.85, at: [0.95, 0.6] satisfies [number, number], ring: 0.42, sweep: [Math.PI * 0.15, Math.PI * 1.55] satisfies [number, number], ringLine: 4, focus: 1.6, hold: 0.6 },
  // Sequence panels (`panelsFor`): a cam-turn page's row of boxed frames under the drawing, one per
  // cam turned. `height` is a panel's side, `gap` the space between, `max` how many a page shows at
  // most, `line` the box's line weight.
  sequence: { height: 150, gap: 16, max: 4, line: 3 },
  // The solid motion arrow (`solidArrow`): shaft and head widths, the head's length, and the paper outline's weight.
  arrow: { shaft: 14, head: 34, headLength: 30, outline: 2 },
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  // The controls page (src/game/controlsPage.ts): a title, then rows in columns — each a
  // square pictogram, drawn on a 100-unit grid at `pictogramLine`, and its label beside it,
  // wrapped onto as many lines as it needs.
  controls: {
    titleSize: 44,
    titleGap: 28,
    columns: 2,
    pictogram: 96,
    pictogramLine: 4,
    labelGap: 16,
    labelSize: 27,
    labelLeading: 1.2,
  },
};

// The booklet in hand (src/ui/booklet.ts): CSS pixels.
export const BOOKLET_UI = {
  // The collapsed thumbnail of the open page, bottom-left — small enough to leave the room
  // to the fingers.
  thumbWidth: 64,
  // A horizontal swipe this long flips a page; a downward one this long closes it.
  swipeDistance: 48,
  // The open page never grows taller than this share of the screen.
  maxHeight: 0.92,
  // A notice on the page (a pick that would not build): laid over its head, out of the flow
  // — its type size and line height, and its inset, padding and corner radius (CSS pixels).
  notice: { size: 14, lineHeight: 1.3, inset: 8, padding: 8, radius: 8 },
  // After a tap on the room puts the booklet down, the scrim stays this long to catch the
  // click a touch synthesises after the lift.
  scrimLingerMs: 400,
  // A mouse over the docked thumbnail grows it to fit this share of the screen's width and
  // height (a quarter of the screen), big enough to read the page.
  thumbHoverShare: 0.5,
  // ...but only once the pointer has rested on it this long (ms): a pointer passing over a
  // thumb on its way elsewhere — the manual's, past the catalog's — never grows it.
  thumbHoverDelayMs: 400,
  // A thumb's inset from its screen corner (CSS pixels), as src/ui/booklet.ts docks it.
  cornerInset: 16,
  // The open page (src/ui/booklet.ts): the page alone over the room, with a soft shadow,
  // growing out of its docked thumb. `gutter` keeps its shadow
  // clear of a narrow screen's edges; `growMs` is the grow to the centre and the shrink
  // back; `radius` rounds the page's corners. index.html's pre-splash mirrors the fit,
  // the shadow and the radius.
  page: { shadow: '0 12px 40px #0008', gutter: 12, growMs: 220, radius: 6 },
  // The manual's docked strip (src/ui/booklet.ts `docked: 'strip'`, laid out by
  // src/game/carouselModel.ts): a band edge to edge along the bottom of the screen in portrait
  // (its height `page` x pageH / pageW plus two `page.gutter`s and the name row: 142 px) and down the
  // right edge in landscape (its width `page` plus two gutters and the name row: 114 px). Every page in it is `page` CSS px
  // wide, the centre one current and told by its gold border; the band shows as many as its
  // long side takes (an odd count) plus hidden slots, one for every page, drawn when they
  // come into view, so a drag shows the next page arriving from under the edge and never empty paper
  // (src/game/carouselModel.ts `slotCount`). `gap` is the space between slots, `rule` the ink
  // line (px, the inset ring's weight) on the band's view side, `snapMs` the slide to a page
  // after a drag, a tap or a key. `peekDelayMs` is how long a touch rests on a page before it
  // pops open (a touch that moves past the tap distance first is a drag, never a peek).
  // `openGap` is the space between the band and the open page above it in portrait.
  // A slot's corner `radius` (px) and `shadow`.
  // `name` is the open manual's name (Ben, 2026-10-23): a row of its own along the band's view side,
  // `row` px deep (above the pages upright, beside them down the right edge), in `size` px bold type
  // spaced `tracking` em; the band is that much thicker (142 px upright, 114 px down the right).
  // `pocket` is the band's far end (px along it) kept for the manuals' pocket (src/ui/manualFan.ts):
  // the right end upright, the foot down the right edge; the pages never run under it.
  strip: {
    name: { row: 18, size: 12, tracking: 0.04 },
    pocket: 26,
    page: 72,
    gap: 8,
    openGap: 12,
    peekDelayMs: 280,
    radius: 6,
    shadow: '0 4px 14px #0006',
    rule: 3,
    snapMs: 180,
    // A fast release carries the pages past the nearest (tuned on a phone): `velocity` is the px/ms
    // at release for each page it carries, `maxPages` the most it carries, `sampleMs` the window of
    // recent moves the speed is read over.
    flick: { velocity: 0.6, maxPages: 2, sampleMs: 100 },
    // The wheel over the band (tuned on a device): `threshold` is the accumulated delta (px) that
    // makes one step (a mouse notch is 100-120), `stepMs` the rest between steps so a trackpad's
    // fling steps once per this, `linePx` the px a line-mode delta (Firefox) counts for.
    wheel: { threshold: 40, stepMs: 200, linePx: 16 },
  },
};

// The catalog (1.9.1): the game's front door, a second booklet of items to build
// (src/game/catalogModel.ts lays it out). Its items' names and part counts are their packs'.
export const CATALOG = {
  // Which items this build lets you build: a comma list of ids from the build-time flag
  // VITE_PICKABLE (`VITE_PICKABLE=johnny npm run build`), or every item when it is unset or
  // empty. Every build ships every pack; the rest show SOLD OUT. (vite.config.ts reads this
  // file in plain Node, where import.meta.env doesn't exist.)
  pickable: import.meta.env?.VITE_PICKABLE ?? '',
  // An item's printed size is its built extent in metres times this, rounded.
  cmPerMetre: 100,
  // Its pages (src/scene/catalogPages.ts), in page-canvas pixels on BOOKLET.pageSize paper.
  page: {
    wordmarkSize: 156,
    taglineSize: 30,
    detailSize: 30,
    // The cover's setting, as fractions of a type size: a title's baseline sits this far
    // down its size; the line under it (the tagline) this many of its own sizes below
    // that baseline; the drawing starts this many of them below the title's full size. The
    // line under is indented this far (page pixels) to sit optically flush under the title.
    baseline: 0.8,
    subtitleDrop: 1.6,
    drawingDrop: 2.4,
    taglineIndent: 6,
    // An item page's lines (src/game/catalogLayout.ts), top to bottom: the heavy rule's
    // weight; the category heading's size, and the gap between the rule and its cap line;
    // the thin rule's weight; the name line's size (name bold, category and size beside
    // it); a variant row's type size and its height as a multiple of that size; the thin
    // rule under each row. `lineGap` separates the blocks; the part count (detailSize) sits
    // `countGap` below the rows and `tagGap` above the tag.
    heavyRule: 8,
    headingSize: 40,
    headingGap: 12,
    // ...and the gap between the heading's descender and the thin rule under it.
    ruleGap: 6,
    thinRule: 2,
    nameLineSize: 34,
    rowSize: 26,
    rowHeight: 1.7,
    lineGap: 14,
    countGap: 34,
    tagGap: 34,
    // Type's cap-line and descender depth as fractions of its size, for stacking lines
    // without measuring them.
    capHeight: 0.75,
    descender: 0.25,
    // The swatches, one filled circle per variant right of the drawing's foot: radius, gap
    // between them, and the ink ring's weight.
    swatchRadius: 15,
    swatchGap: 12,
    swatchRing: 3,
    // The OWN IT NOW! tag, or the SOLD OUT stamp in its place: [x, y, w, h], also the hit
    // target src/ui/booklet.ts lays over the page, its foot on the page margin (pageSize
    // height 1000 less margin 44 less its own 104). The item page's lines stack up from it.
    action: [160, 852, 400, 104] satisfies [number, number, number, number],
    // The corner arrows, printed on the page: [x, y, w, h], level with the tag, in the lower
    // corners — ‹ at the left margin, › at the right — and clear of the tag's columns by 16.
    prev: [44, 852, 100, 104] satisfies [number, number, number, number],
    next: [576, 852, 100, 104] satisfies [number, number, number, number],
    // The clear buttons over them (src/ui/booklet.ts): each printed arrow's rect grown out
    // to the page's edge and down its foot, stopping 8 short of the tag's column. At the
    // smallest page a phone shows (about 258 CSS px wide, held sideways) 152 page px is
    // 54 CSS px — over the 44 a thumb needs — and a tap beside the arrow turns the page
    // rather than putting the catalog down.
    prevHit: [0, 836, 152, 164] satisfies [number, number, number, number],
    nextHit: [568, 836, 152, 164] satisfies [number, number, number, number],
    // An arrow drawn as a chevron at its rect's centre: this far up and down from it, this
    // far across, in this stroke weight (page pixels).
    arrowHalfHeight: 22,
    arrowHalfWidth: 13,
    arrowStroke: 7,
    // The page number, bottom centre, in the margin under the tag: its type size, and its
    // baseline this far up from the page's foot.
    pageNumberSize: 24,
    pageNumberFoot: 12,
    // Sized so OWN IT NOW! sits at its natural width between the hole and the tag's right
    // edge (src/game/catalogLayout.ts `tagWords`); the scene squeezes it only if a font runs wide.
    actionTextSize: 34,
    // The tag's corners and punched hole; the stamp's outline and tilt (radians).
    tagRadius: 18,
    // Clear space kept each side of the tag's words: from the hole's edge and from the tag's right edge.
    tagInset: 18,
    tagHole: 12,
    stampLine: 6,
    stampTurn: -0.08,
  },
  // The cover's wire-drawn room corner (metres): the items stand on its floor this far
  // apart and this far in from its walls, which rise this many times the tallest item.
  cover: {
    gap: 0.5,
    margin: 0.6,
    wallRise: 1.5,
    slab: 0.03,
  },
  words: {
    brand: 'SKRUV',
    tagline: 'Catalog',
    parts: 'parts',
    cm: 'cm',
    build: 'OWN IT NOW!',
    soldOut: 'SOLD OUT',
    // On the sheet when the tag's item could not be built (src/ui/catalogSheet.ts).
    buildFailed: "That one couldn't be built. Try again, or pick another.",
    // On the sheet when a saved room existed and could not be put back (src/main.ts).
    restoreFailed: "Your room couldn't be put back, so it starts empty.",
    // The corner arrows' accessible names (the buttons laid over the printed chevrons).
    prev: 'Previous page',
    next: 'Next page',
  },
};

export const LIGHTS = {
  // At midday; the stage's light scales both down with the sky (STAGE.light).
  hemisphereIntensity: 1.2,
  sunIntensity: 1.6,
  // How far out the sun stands along its arc; the shadow camera's extent covers the room from there.
  sunDistance: 8.3,
  shadowMapSize: 1024,
  shadowExtent: 4.2,
  // Offsets shadow lookups along the normal so millimetre-thin parts don't self-shadow
  // into stripes (acne); small enough that contact shadows stay attached.
  shadowNormalBias: 0.02,
};

export const CAMERA = {
  fov: 50,
  // Close enough to zoom in on millimetre hardware without clipping it.
  near: 0.02,
  far: 100,
  startPosition: [2, 1.8, 2.4] satisfies Vec3,
  startTarget: [0, 0.6, 0] satisfies Vec3,
  // A phone (coarse pointer) starts this many times further from startTarget along the
  // same view, so a cold load frames the room without pinching out first. Dialed on
  // device through ?tune (camera.mobileStartScale) before freezing.
  mobileStartScale: 1.4,
  // Where a camera gesture pivots (src/scene/cameraControls.ts): 1, the first part (or the
  // box) along the line through the middle of the screen, else the floor, held for the
  // whole gesture; 0, today's floor pivot, re-seated every update. A 0/1 switch because
  // ?tune knobs hold numbers. Temporary: the losing mode goes once Ben picks on the phone.
  pivotOnParts: 1,
};

// Orbit limits (src/scene/cameraLimits.ts, applied by src/scene/cameraControls.ts). The
// orbit target roams the whole floor so the camera can get right up to any part; as a
// gesture starts it moves along the view to the first part in the middle of the screen,
// else the floor (CAMERA.pivotOnParts), and holds there. The camera is clamped above the
// floor every frame and is otherwise free, inside the room or out (a wall it is behind is
// cut away).
export const CAMERA_LIMITS = {
  // The target stays this far inside the walls, between these heights: down to the parts
  // lying on the floor, up to just over the standing bookcase.
  targetMargin: 0.6,
  targetHeight: [0, 2.2],
  // The camera never dips nearer the floor than this.
  floorClearance: 0.05,
  // Close enough that a dowel and the hole it goes in fill much of a phone screen.
  minDistance: 0.15,
  // Far enough to take in the whole room from over the walls. Landscape's: a taller-than-wide view zooms out further
  // by its aspect (cameraLimits.ts `zoomOutLimit`).
  maxDistance: 8,
  // Panning slows with zoom; closer than panReference (m) it is sped back up, by at most
  // maxPanBoost, so moving around a close-up doesn't crawl.
  panReference: 1.2,
  maxPanBoost: 5,
  // Stops short of straight down: the build is always seen at an angle, never as a plan.
  minPolarAngle: (40 * Math.PI) / 180,
  maxPolarAngle: (80 * Math.PI) / 180,
  dampingFactor: 0.1,
};

// Where the flatpack the game opens on stands (src/game/boxLayout.ts, src/scene/flatpack.ts):
// a thin-walled cardboard box lying on the floor, its lid closed on top. Its inside, walls
// and lid are the item's (items/johnny `packing`). Box-local frame: length along z,
// origin on the floor at its centre.
export const BOX = {
  // On the floor in front of the start view, turned so its length runs across it.
  position: [0, 0, 0.6] satisfies Vec3,
  yaw: Math.PI / 2,
  // The box is a part the player can drag: heavy and grippy, so a panel slid out over a
  // wall scrapes past it rather than skating it across the floor (kg; Rapier friction).
  mass: 25,
  friction: 1,
};

// How far a part's drawn pose may differ from its body's before a kept world remembers the
// difference (src/scene/itemWorld.ts), per matrix element: float noise, not a sunk bolt.
export const DRAWN_EPSILON = 1e-9;

// Where a new box is set down once the room holds other worlds (src/game/roomLayout.ts): the
// first free spot along a row across the room, then a second row back. `pitch` (m) is the step
// between spots along the room's width, `rowDepth` (m) the step back (toward -z) to the next
// row, `pad` (m) the clear space kept around every footprint, `margin` (m) how close to a wall
// a box may stand. Sized from the largest box (SÖMNLÖS's, 2.14 × 1.66 m on the floor): a row
// back clears it and JOHNNY's (0.86 m deep) with both pads between, and a row still takes it
// and a smaller box beside it.
export const LAYOUT = {
  pitch: 0.8,
  rowDepth: 1.5,
  pad: 0.1,
  margin: 0.1,
};

// The control cluster (src/ui/controlCluster.ts): the row in the upper right — the menu
// button in the corner (first added, at the right), the ?tune gear to its left — the one
// owner of that corner. Its inset from the screen corner and the gap between its controls
// (CSS pixels).
export const CLUSTER = {
  inset: 16,
  gap: 8,
};

// The menu button (src/ui/menuButton.ts): a hamburger holding Repack and Snap rotate. Its
// square size and glyph size, and the drop hung from it — one card of full-width rows (Ben,
// 2026-10-23): the gap to the button, the card's width and corner radius, a row's height and
// side padding, and the Snap rotate switch's track (CSS pixels).
export const MENU = {
  size: 44,
  glyph: 22,
  drop: { gap: 8, width: 168, radius: 14, row: 48, pad: 16, track: { width: 34, height: 20 } },
};

// Repack and recovery (src/ui/resetButton.ts, src/main.ts).
export const RESET = {
  // The button's height (CSS pixels); its place is the control cluster's (CLUSTER).
  height: 44,
  // The repack button is a hold: a bar fills inside it over this many ms of unbroken press,
  // and the repack runs when it is full — cheap insurance against a fat finger wiping a build.
  holdMs: 900,
  // Every this many seconds, any loose player part found outside the room (by more than
  // `escapeMargin` m) is set down again beside the box.
  sweepInterval: 2,
  escapeMargin: 0.05,
  // Where: laid flat in a patch starting this far out from the box's long side and this
  // deep, running the box's length, a gap between pieces; each dropped from this clearance
  // above the floor. Pieces that don't fit go in again `layerHeight` higher, to land on top.
  respawn: { offset: 0.35, depth: 1.5, gap: 0.05, height: 0.25, layerHeight: 0.1 },
};

export const PHYSICS = {
  gravity: [0, -9.81, 0] satisfies Vec3,
  // Fixed simulation step; the render loop banks frame time and runs whole steps.
  timestep: 1 / 60,
  // Pairs with RENDER.maxFrameDelta: a clamped 1/15 s frame needs exactly 4 steps.
  maxStepsPerFrame: 4,
  // Damping bleeds off residual jitter so resting parts reach Rapier's sleep threshold.
  linearDamping: 0.1,
  angularDamping: 0.3,
  // Wood on wood: grippy, and no bounce (the design clamps restitution).
  friction: 0.6,
  restitution: 0,
  // No body simulates lighter than this (kg); the catalog keeps the true masses. Impulse
  // joints go soft at big mass ratios: a 1 g shelf pin fixed in a side spins loose under a
  // 2 kg shelf resting on it, and the shelf drops through.
  minBodyMass: 0.2,
  // Room colliders are slabs this thick, laid just outside the visible surfaces.
  roomColliderThickness: 0.5,
};

export const RENDER = {
  // Above 2 the fill-rate cost on phones outweighs the visible sharpness gain.
  maxPixelRatio: 2,
  // A backgrounded tab resumes with a huge rAF gap; cap it so nothing jumps.
  maxFrameDelta: 1 / 15,
};

// Pointer gestures: who owns a touch (src/game/gestureState.ts) and how a dragged part
// moves (src/game/dragMath.ts). Distances in CSS pixels where noted, else metres.
export const GESTURE = {
  // A press that moves no further than this (CSS px) and lifts within tapMaxMs is a tap;
  // moving further starts a drag. Generous enough for a fingertip's wobble.
  tapMaxDistance: 10,
  tapMaxMs: 350,
  // A grabbed part rides this far above where it was picked up, so it clears neighbours.
  hoverLift: 0.03,
  // Dragged parts stay this far inside the walls.
  wallMargin: 0.05,
  // Rotate-gizmo detent — behind the snap-rotate toggle; rotation is free by default.
  detentStep: Math.PI / 2,
  // Lift channel (second finger on a phone): metres per CSS px of travel.
  liftRate: 0.004,
  // Desktop lift (the wheel mid-drag, or Shift + scroll): gentler, since trackpad scrolls and mouse
  // sweeps run to hundreds of px where a phone's second finger travels tens.
  desktopLiftRate: 0.0025,
  // A lifted part's top stays this far below the walls' tops.
  ceilingMargin: 0.1,
};

// Elevation line (src/ui/liftLine.ts, src/game/liftLine.ts, src/scene/liftHold.ts): a
// vertical line with a knob for the held part's height, floor at the bottom to the lift
// ceiling at the top. A finger on it holds the part in mid-air; touching the line eases the
// part there, the knob drags it 1:1. Read at use time, so the ?tune knobs act live.
export const LIFT_LINE = {
  // Across the screen as a fraction of its width, 0 = left edge.
  x: 0.08,
  // Top and bottom of the line as fractions of the screen's height, top down.
  top: 0.22,
  bottom: 0.78,
  // Knob radius, the drawn line's width and the line's touch band, CSS px — a fingertip.
  knobRadius: 22,
  lineWidth: 4,
  hitWidth: 48,
  // How fast the part eases toward a touched height, 1/s (exponential, like seat assist).
  easeRate: 8,
};

// Rotate gizmo (src/scene/gizmo.ts): rings sized from the selected part's bounding sphere.
export const GIZMO = {
  radiusPadding: 1.15,
  // Hardware is millimetres long; rings never shrink below a fingertip-sized target.
  minRadius: 0.08,
  // Tube thickness as a fraction of ring radius: drawn, and the fatter invisible hit band.
  tube: 0.025,
  hitTube: 0.12,
  opacity: 0.85,
  // Direction arrowheads: a pair of cones on each ring, on opposite sides, pointing the way
  // a counter-clockwise screen sweep turns the part. Fractions of ring radius; the angle
  // is where the first cone sits around its ring, from the ring's local +X.
  arrowLength: 0.14,
  arrowRadius: 0.05,
  arrowAngle: Math.PI / 4,
};

// Drop guide (src/scene/dropGuide.ts): a line from a dragged part straight down to where it
// would land, a ring there, and the hole marking under it lit when it is a free hole that
// takes the part.
export const DROP = {
  ringRadius: 0.012,
  ringWidth: 0.003,
  opacity: 0.7,
  // A landing spot this close to a hole's centre is "over the hole" (a dowel hole's
  // marking is 5 mm across, so a little slack beyond it).
  holeReach: 0.012,
  // Glow of a hole under the drop line, or the seat the ghost shows; the seat flash is 1.
  glowIntensity: 0.6,
};

// Fat-finger picking (src/game/pickMath.ts, src/scene/gestureRouter.ts). Hardware is
// millimetres across; an invisible proxy box never thinner than proxyMinSize surrounds each
// small part, and the preference rule decides when a press on it means the part.
export const PICK = {
  // A part whose longest side is under this is "small": every fastener and both tools,
  // never a panel (the narrowest is ~0.77 m long).
  smallPartMax: 0.25,
  proxyMinSize: 0.04,
  // The finger's angular radius from the camera (radians): ~20 CSS px on a phone.
  fingerRadius: 0.025,
};

// Sprue handle (src/scene/sprue.ts) on a selected small part. The ball stands far enough
// above the part to clear its gizmo rings (the screwdriver's are the widest, ~0.12 m), so a
// press on it is never a ring's.
export const SPRUE = {
  length: 0.15,
  stickRadius: 0.003,
  ballRadius: 0.012,
  // The invisible hit sphere round the ball: a fingertip-sized target.
  hitRadius: 0.03,
};

// Connector snapping (src/game/snapMath.ts). Generous first, per the Design doc: a snap
// that fires too eagerly is a nuisance, one that never fires reads as broken. Tighten
// from playtest feedback.
export const SNAP = {
  maxDistance: 0.08,
  maxAngle: (40 * Math.PI) / 180,
  // A seated pose may graze the floor or a wall by this much; any deeper and the snap is
  // refused (the part would be held kinematic inside a static collider).
  roomTolerance: 0.002,
  ghostOpacity: 0.45,
  // Seat assist: while a seat is on offer, the held part eases toward it this fast (1/s —
  // about 90% of the way in a quarter second). Zero pull whenever no seat is on offer.
  assistStrength: 9,
  // How long the hole's decal glows after a fastener seats in it.
  flashMs: 450,
};

// Panel fit (src/game/panelFit.ts, driven by src/scene/gestureRouter.ts): a carried panel
// seats by all its holes at once onto free fastener ends — a dowel standing in another
// panel. Its own window, wider than SNAP's: a small finger move swings a panel's holes a
// long way. SNAP stays hardware's.
export const PANEL = {
  // A hole this near a free end (metres), and its axis this far off (radians), seeds a fit.
  maxDistance: 0.15,
  maxAngle: (60 * Math.PI) / 180,
  // With the fit seated, any other hole this near a compatible end across its axis (metres),
  // up to seatSlack along it, axis against axis within matchAngle (radians), seats on it too.
  // The slack is a dowel sink and a little: one dowel tapped home stands a sink lower than
  // one only seated at its hole's mouth, and a panel over both still seats on both.
  matchTolerance: 0.01,
  seatSlack: 0.02,
  matchAngle: (5 * Math.PI) / 180,
  // Where it goes: a fit is the panel's place in the finished item when it sits there within
  // matchTolerance across the dowels and matchAngle, and up to this far (metres) along them —
  // a dowel not yet pushed home in either panel stands that much proud (two dowel sinks).
  preferSlide: 0.035,
  // Magnetism: within `zone` metres (panel centre to where it goes), a carried panel with no
  // fit on offer turns toward where it goes, at `rate` (1/s) at full strength.
  zone: 0.4,
  rate: 6,
  // A fit on offer holds (hysteresis) until the finger has moved the panel more than
  // holdReach metres, or turned it more than holdTurn radians, since the offer was taken, or a
  // better fit comes in reach — where it goes, or more pairs; another fit as good takes over
  // only once the panel is offerMargin metres nearer it. The same fit found again stays as
  // first offered (what it seats on is held still under it). So a trembling finger, the line
  // easing, or a carcass the panel nudges never flips the offer frame to frame (1.8.3.4 phone
  // finding 1).
  holdReach: 0.08,
  holdTurn: (20 * Math.PI) / 180,
  offerMargin: 0.02,
};

// Self-aim (src/game/toolAim.ts, driven by src/scene/gestureRouter.ts): dragged hardware —
// a tool, a dowel, a bolt, a cam lock, a pin, a fitting — whose fastener end comes within
// `zone` of a seat that takes it turns that end to point in, harder the nearer it is, so
// SNAP's 40° window is reached without the gizmo. Outside the zone the part keeps whatever
// orientation it has; panels never aim.
export const AIM = {
  // Fasteners — a dowel, bolt, cam lock, pin or fitting into its hole: metres from the end
  // at which aiming starts (strength 0 there, 1 at the seat), and the turn rate at full
  // strength (1/s, the seat assist's exponential law).
  zone: 0.3,
  rate: 8,
  // Tools — a tip onto a bolt head or cam slot — the same, tuned apart.
  toolZone: 0.3,
  toolRate: 8,
  // An end this close (radians) to pointing straight in is left as it is.
  settled: 0.001,
};

// Target rings (src/game/toolTargets.ts picks them, src/scene/targetRings.ts draws them):
// while hardware is carried, each place it can go right now — a free hole that takes a
// fastener, a fastener a tool can turn — lights a ring as the finger nears it on screen,
// never one across the room from the part, the nearest brightest. Letting go over a lit
// ring seats the part there.
export const RING = {
  // CSS px from the finger at which a ring starts to fade in.
  screenRadius: 120,
  // CSS px from a lit ring within which letting go seats the part: a fingertip.
  hitRadius: 36,
  // Metres from the carried part's ends beyond which nothing lights, however close it looks.
  maxDistance: 0.5,
  // The ring lying round a head or slot (m), and its look at full strength.
  radius: 0.012,
  width: 0.004,
  opacity: 0.9,
  // Rings drawn at once, nearest first: plenty for the holes around one finger.
  pool: 12,
};

// Turn ring (src/game/turnRing.ts decides, src/ui/turnRing.ts draws): a flat dial facing
// the screen round the head of each fastener a seated tool is on, with arrows the
// tightening way and an arc filled to how far home it is. CSS px; it flashes this long as
// the fastener goes home.
export const TURN_RING = {
  // Radius of the drawn ring — a comfortable finger's reach from the head.
  radius: 64,
  // Half-width of the grab band either side of the ring: a fingertip.
  band: 24,
  // How long the ring flashes as its fastener goes home.
  flashMs: 400,
  // Drawn ring and arc widths, and the arrowheads' size.
  width: 4,
  arcWidth: 6,
  arrowSize: 14,
};

// Render layers: the room and the rotate gizmo's rings each on their own, which the main camera enables and the
// detail inset's camera (src/scene/inset.ts) does not, so it sees the parts on paper, free of the controls.
export const LAYER = { room: 1, gizmo: 2 };

// The live detail inset (src/game/insetModel.ts, src/game/insetView.ts, src/scene/inset.ts, src/ui/inset.ts): a circle
// of the manual's paper showing the engaged joint and its tool from a fixed orthographic close-up.
export const INSET = {
  // The close-up: how tall its frame is (metres) and how far its view direction tilts off the hole's axis (degrees):
  // 0 looks straight down the hole, 90 side-on. The camera sits `distance` metres out along that direction.
  camera: { frameHeight: 0.14, tilt: 55, distance: 1 },
  // Portrait (height > width): the circle in the top centre, between the catalog thumb and the control cluster.
  // Landscape: the lower right of the view, clear of the catalog's thumb above it and the band beside it (the band is
  // outside the view). `share` is the circle's diameter as a share of the shorter side, clamped to [min, max] (CSS px);
  // `top` (portrait), `right` and `bottom` are insets from the view's edges less the safe insets that reach into it.
  portrait: { share: 0.42, min: 140, max: 280, top: 16 },
  landscape: { share: 0.36, min: 140, max: 260, right: 16, bottom: 16 },
  // The ring's weight (CSS px) and its alpha while offered and while active; the tail's weight and the dot at the
  // joint; and the ms the ring takes to fade between states.
  ring: { width: 3, offeredAlpha: 0.4, activeAlpha: 1 },
  tail: { width: 2, dot: 5 },
  fadeMs: 160,
  // How far behind and in front of the joint the orthographic camera keeps (metres), so a long tool shaft never clips.
  depth: 0.6,
  // The render target's multisampling, and the circle's rim segments.
  samples: 4,
  segments: 64,
  // The controls (src/game/insetControls.ts, src/ui/insetControls.ts) are sub-bubbles attached to the circle as the
  // manual's tool bubble is attached to its first detail inset (BOOKLET.inset): a paper disc `share` of the circle's
  // radius, its centre `at` of the radius out along the lower-right diagonal, so it sits partly on the rim and partly
  // off it, ringed at the circle's own line weight. `min` is its smallest radius, so a finger can grab it (CSS px).
  // The turn bubble holds a ring `mark.radius` of its radius with an arc of progress and an arrowhead each way; the
  // push bubble a down arrow, `arrow.length` and `arrow.head` of its radius, onto a baseline `arrow.base.gap` of the
  // radius under its tip and `arrow.base.width` of it wide: the download-to-surface icon, pressing onto a surface.
  controls: {
    bubble: { share: BOOKLET.inset.tool, at: BOOKLET.inset.toolAt, min: 26 },
    mark: { radius: 0.62, width: 2.5, arcWidth: 5, arrowSize: 0.3 },
    arrow: { length: 0.9, head: 0.34, width: 3, base: { gap: 0.14, width: 0.8 } },
  },
};

// Hole markings (src/game/decals.ts, drawn by src/game/partMesh.ts). Radii are keyed by
// the catalog's socket connector type and sized a touch wider than what fills them, so a
// seated fastener still shows a rim.
export const DECAL = {
  radius: {
    dowelHole: 0.005,
    camBoltHole: 0.0045,
    shelfPinHole: 0.0035,
    backFittingHole: 0.0045,
    camLockRecess: 0.009,
    // A threaded insert in a table top or leg: a hole a hair wider than the stud it takes.
    studHole: 0.0035,
    // A pilot hole through the part a wood screw attaches: a hair wider than its thread.
    screwHole: 0.002,
    // The pilot a wood screw's tip lands in, in the part behind the one it attaches.
    screwPilot: 0.002,
  },
  // A recess is drawn as a ring: inner radius as a fraction of the outer.
  recessInner: 0.55,
  // Laid this far proud of the face, so it never z-fights the panel.
  surfaceOffset: 0.0004,
  segments: 24,
};

// Hardware and tool shapes (src/game/partShapes.ts): visual only, each drawn inside its
// pack box. Radii are fractions of the box's half-width across the piece's axis; lengths
// are fractions of its length along it, measured from the end that goes in first.
export const MODELS = {
  // Round faces: low, because these are a few millimetres on screen.
  segments: 12,
  // The Allen key's hexagonal rod.
  hexSides: 6,
  // The key's rod, as a fraction of half the box's thickness: under 1 keeps the short
  // leg's axis close to the tip connector on the box's edge.
  wrenchRod: 0.75,
  // Screwdriver: the handle's share of the length, the shaft's radius, and the flat blade
  // at the tip (its length; its thickness as a fraction of the shaft's diameter).
  screwdriverHandle: 0.45,
  screwdriverShaft: 0.2,
  screwdriverBlade: 0.05,
  screwdriverBladeThickness: 0.35,
  // Cam bolt: the thread's radius, and the head's share of the length.
  boltShaft: 0.55,
  boltCap: 0.14,
  // A drive slot (a cam lock's top, a wood screw's head): its depth (share of the piece's
  // length), and its width and length across the end face (shares of the piece's diameter).
  driveSlotDepth: 0.1,
  driveSlotWidth: 0.16,
  driveSlotLength: 0.8,
  // Wood screw: the thread's radius (share of the head's), the head's share of the length (it
  // runs to the end of the box), and how far (share of the length) its drive slot's mark
  // stands proud of the head's top face.
  screwShaft: 0.45,
  screwHead: 0.15,
  screwSlotProud: 0.02,
  // Shelf pin: the rod's radius, and its collar (where it starts, how thick).
  pinRod: 0.6,
  pinCollarAt: 0.5,
  pinCollar: 0.12,
  // Back fitting: the plug's radius, and the head's share of the length.
  fittingShaft: 0.5,
  fittingHead: 0.25,
  // Double-ended stud: each end's hex socket, as a dark hexagonal plug — its depth (share of
  // the length) and its radius (share of the rod's).
  studSocketDepth: 0.1,
  studSocket: 0.6,
};

// Fasteners (src/game/fasteners.ts, src/game/assembly.ts) and the joints that follow them
// (src/physics/world.ts). Distances in metres unless marked CSS px; angles in radians.
export const FASTENER = {
  // A dowel, pin or back fitting comes back out when dragged this far (CSS px) along its axis.
  pullDistance: 40,
  // Wrench crank from a seated cam bolt to a screwed one: two full turns.
  boltRadians: 4 * Math.PI,
  // Hand or key turn from a seated threaded stud end to a screwed one: two full turns, a
  // fiddly stud being a turn-and-a-bit slower to seat than a bolt on the phone (?tune it).
  studRadians: 4 * Math.PI,
  // Screwdriver turn from a seated wood screw to one driven home: two full turns (?tune it).
  screwRadians: 4 * Math.PI,
  // Screwdriver turn from an open cam lock to a locked one.
  quarterTurn: Math.PI / 2,
  // A cam catches any screwed bolt head this close to its recess, and how deep each
  // fastener sits in its hole once fully home — the Flatpack contract's, so the game and
  // the validator never disagree (tools/validate/lib/vocabulary.js).
  captureRadius: CONTRACT.captureRadius,
  sinkDepth: CONTRACT.sinkDepth,
  // Crank motion this close (CSS px) to the fastener's on-screen centre is ignored — the
  // angle swings wildly there.
  crankDeadzone: 12,
  // Hold-to-drive: a still press on a seated tool drives its fastener home in this many
  // seconds, whatever its span — the cam's quarter turn as long as the bolt's two turns.
  driveSeconds: 1.5,
  // The ratchet ticks once every this much turn (an eighth), cranked or driven.
  ratchetRadians: Math.PI / 4,
  // Dowel-stage connections: rigid in translation, this much angular play about the pivot.
  // Zero: a dowelled carcass holds square until its cams lock or its screws drive home.
  // Ben's playtest of ÖVERKÄLL's drawer (2026-10-13) showed any sag knocks the next part's
  // dowels out of line, so the slump ships off; the ?tune knob (joint.angularPlay) puts it
  // back for a feel pass. Cam-locked = rigid.
  angularPlayDegrees: 0,
  // Torque per rad/s resisting the slump (N·m·s/rad) when there is play: a sag, not a drop.
  playDamping: 1000,
};


// A drawer on its runners (src/game/slideMath.ts, src/game/assembly.ts, src/physics/world.ts,
// src/scene/gestureRouter.ts). Distances in metres; the motor's units are Rapier's.
export const SLIDE = {
  // Dragged this far (m) past the open limit, the drawer comes off its runners and the drag
  // carries on as a carry (?tune it).
  pullOut: 0.04,
  // The prismatic motors' position stiffness while the drawer is dragged: how hard it chases
  // the finger along the travel (?tune it).
  stiffness: 400,
  // Their damping, both while dragged and at rest: at rest it alone holds the drawer where
  // it was left (?tune it).
  damping: 40,
};

// A drawer seated off square squares up on its runners (src/game/assembly.ts): only when it is
// seated within this angle of the assembled way. Past it the drawer is the wrong way round
// (backwards, upside down) and a runner only goes on one way, so it is left as it sits.
export const SLIDE_SQUARE = {
  maxAngle: (120 * Math.PI) / 180,
};

// Telemetry and live tuning (src/game/events.ts, src/game/sessionBuffer.ts,
// src/game/tunables.ts).
export const TUNE = {
  // The session buffer keeps this many of the latest events for export — a long session's
  // worth of grabs, seats and fps samples.
  sessionBufferSize: 5000,
  // The tuning drawer (src/ui/tunePanel.ts) exists only on a URL carrying this query flag
  // (…/skruv/?tune); the plain URL is the teaser, untouched.
  queryFlag: 'tune',
  // The drawer, in CSS pixels: never wider than this, nor taller than this share of the
  // screen, so the build stays in view above it.
  panelMaxWidth: 520,
  panelMaxHeight: 0.6,
  // A download's object URL is let go only after this many ms: Safari starts blob
  // downloads asynchronously and fails on a URL already revoked (FileSaver.js waits as long).
  downloadRevokeMs: 40_000,
  // Frame-rate fallback (src/scene/fpsGuard.ts): the loop's rate is sampled every
  // fpsSampleSeconds. Below fpsFloor for fpsWindow seconds running, the room renders every
  // other frame — a steady half rate rather than a stutter — while physics and gestures
  // keep every frame. It renders every frame again once a fully rendered rate would hold at
  // fpsRecover (or the floor, if higher) for fpsWindow — or at once if rendered frames
  // cost less than fpsHelpRatio times skipped ones (a capped loop, not a loaded one, where
  // skipping buys nothing). A floor of 0 never engages it.
  fpsSampleSeconds: 1,
  fpsFloor: 40,
  fpsWindow: 3,
  fpsRecover: 55,
  fpsHelpRatio: 1.25,
  // A frame gap longer than this many seconds is a backgrounded tab, not load: the sample
  // in progress is dropped rather than read as a frame rate near zero.
  fpsMaxGap: 1,
};

// The manuals' pocket (src/ui/manualFan.ts, src/game/manualFan.ts; Ben, 2026-10-23): every world's
// manual in the band's far end (BOOKLET_UI.strip.pocket), a spine of cover edges at rest, a row of
// covers spread out of it on a tap (CSS px). `cover` is a cover's width (its height follows
// BOOKLET.pageSize), `gap` the space between spread covers, `inset` the space kept between the row and
// the band and the cluster, `edge` a cover's edge in the spine, `edgeStep` the offset between edges
// and `edgePad` the least room kept at the spine's sides, `rise` how far the row travels into the band
// as it folds, `motionMs` the fold and spread. `clearHoldMs` is the hold on the open cover that clears
// the open item (1.9.9.6): a press past GESTURE.tapMaxMs that lifts before it is a cancel; `badge` the X
// badge marking the open cover (CSS px); `dimOpacity` what the open item's parts fade to while the hold
// runs, so the player sees what is about to go.
export const FAN = {
  cover: 56,
  gap: 8,
  inset: 12,
  edge: 12,
  edgeStep: 4,
  edgePad: 4,
  rise: 24,
  motionMs: 200,
  clearHoldMs: 900,
  badge: 24,
  dimOpacity: 0.35,
};

// The room's save (src/game/roomStore.ts): the one key it is written under, and how long after the last
// change the write waits, so a run of seats and releases is one write. The page going to the
// background writes at once.
export const SAVE = { key: 'skruv.room', debounceMs: 500 };

// Android haptics (navigator.vibrate; iOS Safari has none), in ms: a tick when a part
// seats (a tool engaging too), a double tick when a cam lock locks, a buzz when a bolt goes
// home, and a ratchet tick every FASTENER.ratchetRadians a fastener turns. 0 turns one off.
// The cues they back are src/game/haptics.ts's; a native shell maps those its own way.
export const HAPTICS = {
  seatMs: 10,
  lockMs: 18,
  lockGapMs: 60,
  tickMs: 4,
  homeMs: 24,
  // The native shell's buzzer (src/shell/capacitorHaptics.ts) plays each cue as one of
  // Capacitor's impact styles, or the success notification; tuned on the phone. A cue whose
  // knob above is 0 is silent on native too.
  native: {
    seat: 'light',
    engage: 'light',
    tick: 'light',
    home: 'success',
    lock: 'heavy',
  } satisfies Record<string, NativeStyle>,
};

/** A native haptic: Capacitor's three impact styles, plus its success notification. */
export type NativeStyle = 'light' | 'medium' | 'heavy' | 'success';

// The Capacitor shell: the iOS app serves the bundled build from capacitor://localhost/ and
// can't append a query to a bundled file, so its scheme is how the page knows it is inside.
// Android's shell serves from https://localhost and is not detected yet.
export const SHELL = { protocol: 'capacitor:' };

// The metrics overlay (src/ui/metricsOverlay.ts), switched from the menu. Frame deltas land
// in fixed bins of this width (ms), up to this ceiling (a longer one counts in the last
// bin); a frame longer than `slowFrameMs` counts as a dropped-frame stall; the readout is
// redrawn every `readoutSeconds`.
export const METRICS = {
  histogramBinMs: 0.25,
  histogramMaxMs: 1000,
  slowFrameMs: 33,
  readoutSeconds: 0.5,
};

// Dev stream (dev server only — never in a build): the socket a dev session streams its
// events out of and takes knob sets in through. The hub is a plugin in vite.config.ts, the
// game's end src/dev/wsClient.ts, and tools/agent-bridge the agent's. Every message is
// JSON `{ kind, ... }`, one of `kinds`:
//   hello       any → hub      `{ role }`: 'game' for the page; anything else is a tool
//   event       game → tools   `{ event }`: one bus event (src/game/events.ts)
//   list        tool → game    `{ id }`: asks for the knobs
//   knobs       game → tools   `{ id, knobs }`: tunables.list(), answering list or set
//   set         tool → game    `{ id, key, value }`: a knob set, clamped by the registry
//   screenshot  tool → game    `{ id }`: asks for the canvas
//   image       game → tools   `{ id, dataUrl }`: a PNG of the next rendered frame
//   error       game → tools   `{ id, message }`: a request refused
// The hub relays game messages to every tool and tool messages to every game.
export const DEV_WS = {
  path: '/__skruv-dev',
  kinds: {
    hello: 'hello',
    event: 'event',
    list: 'list',
    knobs: 'knobs',
    set: 'set',
    screenshot: 'screenshot',
    image: 'image',
    error: 'error',
  },
  gameRole: 'game',
  // A dropped socket (the dev server restarted) is retried this often, in ms.
  retryMs: 2000,
};
