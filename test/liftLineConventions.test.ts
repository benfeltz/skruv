import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The elevation line's wiring (1.8.1 Step 5), pinned on the source: the seam order, the
// tap guard, every path that ends a hold, and the line's layering. How the hold feels —
// the ease, two-handed use, setting a part down upright — is the manual plan.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = read('src/main.ts');

// The body of `function name(` in `source`, up to the next top-level declaration.
function body(source: string, name: string) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.slice(start).search(/\n(?:function|const|let|document|events|window|createLoop)\b/);
  return source.slice(start, start + end);
}

describe('seam order', () => {
  it('holds over the compound seam, and hands that to both the router and the gizmo', () => {
    expect(main).toMatch(/const hold = createLiftHold\(createCompoundPhysics\(physics, parts, assembly\)\);/);
    expect(main).toMatch(/const manipulation = hold;/);
    expect(main.match(/physics: manipulation/g)).toHaveLength(2);
  });

  it('eases the hold and draws the line before the physics step', () => {
    const loop = main.slice(main.indexOf('createLoop('));
    const at = (call: string) => loop.indexOf(call);
    expect(at('hold.update(delta)')).toBeGreaterThan(-1);
    expect(at('hold.update(delta)')).toBeLessThan(at('physics.step(delta)'));
    expect(at('showLiftLine()')).toBeLessThan(at('physics.step(delta)'));
    expect(at('keepShiftHold()')).toBeGreaterThan(-1);
    expect(at('keepShiftHold()')).toBeLessThan(at('hold.update(delta)'));
  });
});

describe('which part the line shows for (review round 1)', () => {
  it('takes a dragged part only in a plain move, never a compound, crank or pull', () => {
    expect(body(main, 'liftablePart')).toMatch(/dragging \? \(dragging\.mode === 'move' \? dragging\.part : null\) : gizmo\.selected/);
  });
});

// Ben's manual pass (2026-10-09): taps switch the held part between turning and moving.
describe('taps never pick another part while the line holds', () => {
  // Review round 6: a tap on the box is a tap on the room, so it puts the rings away too.
  it('asks selectsDuringHold first thing in select(), with the box as the room', () => {
    expect(body(main, 'select')).toMatch(
      /^function select\(part: Part \| null\) \{\n\s*if \(!selectsDuringHold\(part === flatpack\.base \? null : part, hold\.held\)\) return;/,
    );
  });
});

describe('every path ends the hold (regression risk: a hold that never ends)', () => {
  it('the finger leaving the line', () => {
    expect(main).toMatch(/onRelease: \(\) => hold\.end\('line'\)/);
  });

  // Ben's manual pass (2026-10-09): Shift is the desktop's hold.
  it('Shift let go', () => {
    expect(body(main, 'onShift')).toMatch(/shiftDown = event\.type === 'keydown';\n\s*if \(!shiftDown\) hold\.end\('key'\);/);
    expect(main).toMatch(/window\.addEventListener\('keyup', onShift\);/);
  });

  it('a seat naming the held part', () => {
    expect(main).toMatch(/events\.on\(EVENT\.SEAT, \(\{ hardware, host \}\) => \{\n\s*if \(hold\.held && \(hardware === hold\.held\.id \|\| host === hold\.held\.id\)\) hold\.end\(\);/);
  });

  it('a repack, before anything else', () => {
    expect(body(main, 'repack')).toMatch(/^function repack\(\) \{\n\s*hold\.end\(\);/);
  });

  it('the app hidden or blurred — whoever keeps it, and Shift is forgotten too', () => {
    expect(main).toMatch(/document\.addEventListener\('visibilitychange', \(\) => \{\n\s*if \(document\.visibilityState === 'hidden'\) dropHold\(\);/);
    expect(main).toMatch(/window\.addEventListener\('blur', dropHold\);/);
    expect(body(main, 'dropHold')).toMatch(/shiftDown = false;\n\s*hold\.end\(\);/);
  });

  it('the control reports a release on up, cancel and lost capture', () => {
    expect(read('src/ui/liftLine.ts')).toMatch(/\['pointerup', 'pointercancel', 'lostpointercapture'\]/);
  });
});

describe('layering', () => {
  it('keeps the line control free of physics, Three and the scene', () => {
    const imports = [...read('src/ui/liftLine.ts').matchAll(/from\s+'([^']+)'/g)].map(([, path]) => path);
    expect(imports).toEqual(['../constants.js', '../game/liftLine.js']);
  });

  it('keeps the hold seam free of Three', () => {
    expect(read('src/scene/liftHold.ts')).not.toMatch(/from\s+['"]three/);
  });

  it('reads the router only through a read-only dragging getter that hands out a copy', () => {
    const router = read('src/scene/gestureRouter.ts');
    expect(router).toMatch(/readonly dragging: \{ part: Part; mode: Drag\['mode'\] \} \| null;/);
    expect(router).toMatch(/get dragging\(\) \{\n\s*return drag && \{ part: drag\.part, mode: drag\.mode \};\n\s*\},/);
    expect(router).not.toMatch(/set dragging/);
    expect(router.match(/\bdragging\b(?!\s+it)/g)).toHaveLength(2);
    expect(main).not.toMatch(/router\.dragging\.\w+\s*=/);
  });
});
