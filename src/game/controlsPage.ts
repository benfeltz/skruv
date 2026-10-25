// The booklet's controls page: what the hands do, as rows of a pictogram and a short label,
// one scheme per kind of device. Pure data — src/scene/bookletPages.ts draws it, and the
// wiring (src/main.ts) picks the scheme from the pointer: `(pointer: coarse)` is touch.
//
// Read off the gestures the code has (1.8.3.3):
//   camera   one finger on empty space orbits, two pinch and pan (src/scene/cameraControls.ts);
//            on a desktop a left drag orbits, a right drag pans, scroll zooms
//   parts    a tap selects a part and puts turn rings round it; a drag moves it; carried
//            hardware let go over a hole it takes seats there; a tap pushes home what is
//            seated in the tapped part; a drag out of a seat pulls it free
//            (src/scene/gestureRouter.ts)
//   height   the lift line, or a second finger mid-drag (touch); Shift holds the part up and
//            Shift + scroll sets its height (desktop: src/main.ts, the router's wheel)
//   tools    on a fastener, circle the tool (or its turn ring) to turn it, or hold it still
//            to drive it home
//   drawers  drag any part of a drawer along its runners (items with a slide only); dragged
//            past the end, it comes off
//   legs     a part set onto its stud is circled itself, no tool (items with studs only)
//   booklet  swipe to flip (touch); the arrows or arrow keys (desktop) — src/ui/booklet.ts
//   repack   press and hold the button until its bar fills (src/ui/resetButton.ts)

import { KIND } from '../../tools/validate/lib/vocabulary.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';

/** The device a controls page is for. */
export type Scheme = 'touch' | 'desktop';

/** A pictogram on the controls page; how each is drawn is src/scene/bookletPages.ts's. */
export type PictogramId =
  | 'orbit'
  | 'zoomPan'
  | 'pan'
  | 'zoom'
  | 'select'
  | 'move'
  | 'lift'
  | 'hold'
  | 'height'
  | 'seat'
  | 'pushHome'
  | 'turnTool'
  | 'turnPart'
  | 'pullApart'
  | 'slide'
  | 'flip'
  | 'repack';

/** One row: what to do, drawn, and what it does, in a few words. */
export interface ControlRow {
  pictogram: PictogramId;
  label: string;
  /** Shown only for an item whose fasteners include this kind (see `rowsFor`); absent: always. */
  needs?: FastenerKind;
}

// The gestures both schemes share, after the camera's and the height's: the booklet is
// swiped or flipped.
const SHARED_ROWS = (flip: string): ControlRow[] => [
  { pictogram: 'seat', label: 'Drop to seat' },
  { pictogram: 'pushHome', label: 'Push home' },
  { pictogram: 'turnTool', label: 'Circle or hold', needs: KIND.TOOL },
  { pictogram: 'turnPart', label: 'Circle to screw', needs: KIND.STUD },
  { pictogram: 'pullApart', label: 'Pull apart' },
  { pictogram: 'slide', label: 'Pull to open', needs: KIND.SLIDE },
  { pictogram: 'flip', label: flip },
  { pictogram: 'repack', label: 'Repack: hold' },
];

/** Each scheme's rows, top to bottom, for an item that uses every fastener there is — see `rowsFor`. */
export const CONTROLS: Readonly<Record<Scheme, readonly ControlRow[]>> = Object.freeze({
  touch: Object.freeze<ControlRow[]>([
    { pictogram: 'orbit', label: 'Turn view' },
    { pictogram: 'zoomPan', label: 'Zoom and pan' },
    { pictogram: 'select', label: 'Tap to turn' },
    { pictogram: 'move', label: 'Drag to move' },
    { pictogram: 'lift', label: 'Lift' },
    ...SHARED_ROWS('Swipe pages'),
  ]),
  desktop: Object.freeze<ControlRow[]>([
    { pictogram: 'orbit', label: 'Turn view' },
    { pictogram: 'pan', label: 'Pan' },
    { pictogram: 'zoom', label: 'Zoom' },
    { pictogram: 'select', label: 'Click to turn' },
    { pictogram: 'move', label: 'Drag to move' },
    { pictogram: 'hold', label: 'Hold up' },
    { pictogram: 'height', label: 'Set height' },
    ...SHARED_ROWS('Flip pages'),
  ]),
});

/**
 * The rows `scheme` shows for an item whose fasteners are `kinds`: every row, but one that
 * needs a kind the item lacks (leg screwing on an item with no studs) is left out. Order kept.
 */
export const rowsFor = (scheme: Scheme, kinds: ReadonlySet<FastenerKind>): ControlRow[] =>
  CONTROLS[scheme].filter((row) => row.needs === undefined || kinds.has(row.needs));
