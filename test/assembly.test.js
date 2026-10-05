import { describe, expect, it } from 'vitest';
import { FASTENER } from '../src/constants.js';
import { PART_TYPES } from '../src/game/catalog.js';
import { capture, carryPose, connectorInWorld, createAssembly, relativePose } from '../src/game/assembly.js';
import { KIND, STATE } from '../src/game/fasteners.js';
import { rotateVector } from '../src/game/snapMath.js';

const typeOf = (id) => id.replace(/-\d+$/, '');
const expectVec = (actual, expected, digits = 9) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));

// Catalog connector indices used below.
const SIDE_BOTTOM_DOWEL = 0; // [face, BOTTOM_Y, -0.09], +x
const SIDE_BOTTOM_DOWEL_2 = 1;
const SIDE_BOTTOM_CAM_BOLT = 2;
const SIDE_PIN = 10;
const SHELF_LEFT_DOWEL = 0; // [-end, 0, -0.09], -x
const SHELF_LEFT_RECESS = 2;
const END_LOW = 0; // a rod's bottom end
const END_HIGH = 1;
const BACK_FITTING = 0;

// The carcass's bottom-left corner, assembled orientation: side at the origin, a dowel
// seated in its lowest hole (end pointing into the hole), the bottom panel seated on it.
const SQRT1_2 = Math.SQRT1_2;
const BOTTOM_Y = PART_TYPES.sidePanel.connectors[SIDE_BOTTOM_DOWEL].position[1];
const DOWEL_HALF = PART_TYPES.dowel.size[1] / 2;
const SHELF_HALF = PART_TYPES.topBottomPanel.size[0] / 2;
const FACE = PART_TYPES.sidePanel.size[0] / 2;
const ALONG_X = [0, 0, -SQRT1_2, SQRT1_2]; // local +y onto world +x
const IDENTITY = [0, 0, 0, 1];
const POSES = {
  'sidePanel-1': { position: [0, 0, 0], rotation: IDENTITY },
  'dowel-1': { position: [FACE + DOWEL_HALF, BOTTOM_Y, -0.09], rotation: ALONG_X },
  'dowel-2': { position: [FACE + DOWEL_HALF, BOTTOM_Y, 0.09], rotation: ALONG_X },
  'topBottomPanel-1': { position: [FACE + 2 * DOWEL_HALF + SHELF_HALF, BOTTOM_Y, 0], rotation: IDENTITY },
  'camLockBolt-1': { position: [FACE + PART_TYPES.camLockBolt.size[1] / 2, BOTTOM_Y, 0], rotation: ALONG_X },
  // Upside down: body end up into the recess in the panel's underside.
  'camLock-1': { position: [0.07, BOTTOM_Y - 0.014, 0], rotation: [1, 0, 0, 0] },
};
const poseOf = (id) => POSES[id];

function corner() {
  const assembly = createAssembly(typeOf);
  const inSide = assembly.seat({ partA: 'dowel-1', connectorA: END_LOW, partB: 'sidePanel-1', connectorB: SIDE_BOTTOM_DOWEL, mover: 'dowel-1' });
  // Dragged the other way round: the panel onto the dowel, hole first.
  const inShelf = assembly.seat({ partA: 'topBottomPanel-1', connectorA: SHELF_LEFT_DOWEL, partB: 'dowel-1', connectorB: END_HIGH, mover: 'topBottomPanel-1' });
  return { assembly, inSide, inShelf };
}

describe('seat / unseat', () => {
  it('normalises every joint to hardware + host, whichever part was dragged', () => {
    const { inSide, inShelf } = corner();
    expect(inSide).toMatchObject({ hardware: 'dowel-1', host: 'sidePanel-1', kind: KIND.DOWEL, mover: 'dowel-1' });
    expect(inShelf).toMatchObject({ hardware: 'dowel-1', hardwareConnector: END_HIGH, host: 'topBottomPanel-1', mover: 'topBottomPanel-1' });
    expect(inShelf.fastener.state).toBe(STATE.SEATED);
  });

  it('lists a joint under both its parts, and forgets it on unseat', () => {
    const { assembly, inSide } = corner();
    expect(assembly.jointsOf('dowel-1')).toHaveLength(2);
    expect(assembly.jointsOf('sidePanel-1').map((j) => j.id)).toEqual([inSide.id]);
    assembly.unseat(inSide.id);
    expect(assembly.jointsOf('sidePanel-1')).toEqual([]);
    expect(assembly.get(inSide.id)).toBeNull();
  });

  it('throws on a pair no connector table allows', () => {
    const assembly = createAssembly(typeOf);
    expect(() =>
      assembly.seat({ partA: 'dowel-1', connectorA: END_LOW, partB: 'sidePanel-1', connectorB: SIDE_BOTTOM_CAM_BOLT, mover: 'dowel-1' }),
    ).toThrow();
  });
});

describe('tap, pull and canRelease', () => {
  it('presses every tap-kind fastener touching the tapped part', () => {
    const { assembly, inSide, inShelf } = corner();
    expect(assembly.tap('sidePanel-1')).toEqual([inSide.id]);
    expect(assembly.tap('dowel-1')).toEqual([inShelf.id]);
    expect(assembly.tap('dowel-1')).toEqual([]);
  });

  it('offers a fastened joint for pulling only to the part that was pushed in', () => {
    const { assembly, inSide, inShelf } = corner();
    assembly.tap('dowel-1');
    expect(assembly.pullable('topBottomPanel-1').map((j) => j.id)).toEqual([inShelf.id]);
    expect(assembly.pullable('dowel-1').map((j) => j.id)).toEqual([inSide.id]);
    expect(assembly.pullable('sidePanel-1')).toEqual([]);
  });

  it('lets a part go only once its fasteners are back to plain seated', () => {
    const { assembly, inShelf } = corner();
    assembly.tap('dowel-1');
    expect(assembly.canRelease('topBottomPanel-1')).toBe(false);
    expect(assembly.apply(inShelf.id, { type: 'pull' })).toBe(true);
    expect(assembly.canRelease('topBottomPanel-1')).toBe(true);
    expect(assembly.canRelease('dowel-1')).toBe(false);
  });

  it('records the part a pressed back fitting lands in, and forgets it on the pull', () => {
    const assembly = createAssembly(typeOf);
    const fitting = assembly.seat({ partA: 'backFitting-1', connectorA: END_LOW, partB: 'backPanel-1', connectorB: BACK_FITTING, mover: 'backFitting-1' });
    expect(fitting.kind).toBe(KIND.FITTING);
    expect(assembly.get(fitting.id).through).toBeNull();
    assembly.tap('backFitting-1', () => ({ through: 'sidePanel-1' }));
    expect(assembly.get(fitting.id)).toMatchObject({ through: 'sidePanel-1', fastener: { state: STATE.PRESSED } });
    expect([...assembly.compoundOf('backPanel-1')].sort()).toEqual(['backFitting-1', 'backPanel-1', 'sidePanel-1']);
    expect(assembly.pullable('backFitting-1').map((j) => j.id)).toEqual([fitting.id]);
    assembly.apply(fitting.id, { type: 'pull' });
    expect(assembly.get(fitting.id).through).toBeNull();
    expect(assembly.canRelease('backFitting-1')).toBe(true);
  });
});

describe('capture', () => {
  const recess = { position: [0, 0, 0] };

  it('picks the nearest bolt head within the radius, whichever instance', () => {
    const heads = [
      { id: 'camLockBolt-5', position: [0.01, 0, 0] },
      { id: 'camLockBolt-2', position: [0, 0.004, 0] },
    ];
    expect(capture(recess, heads).id).toBe('camLockBolt-2');
  });

  it('ignores heads beyond the radius', () => {
    expect(capture(recess, [{ id: 'camLockBolt-1', position: [FASTENER.captureRadius + 1e-6, 0, 0] }])).toBeNull();
    expect(capture(recess, [])).toBeNull();
  });
});

describe('compoundOf', () => {
  it('walks fastened joints transitively and stops at merely seated ones', () => {
    const { assembly } = corner();
    const right = assembly.seat({ partA: 'dowel-3', connectorA: END_LOW, partB: 'topBottomPanel-1', connectorB: 3, mover: 'dowel-3' });
    expect([...assembly.compoundOf('sidePanel-1')]).toEqual(['sidePanel-1']);
    assembly.tap('dowel-1');
    assembly.tap('sidePanel-1');
    assembly.apply(right.id, { type: 'tap' });
    expect([...assembly.compoundOf('sidePanel-1')].sort()).toEqual(['dowel-1', 'dowel-3', 'sidePanel-1', 'topBottomPanel-1']);
  });
});

describe('cam lock', () => {
  function locked() {
    const { assembly } = corner();
    assembly.tap('dowel-1');
    assembly.tap('sidePanel-1');
    const bolt = assembly.seat({ partA: 'camLockBolt-1', connectorA: END_LOW, partB: 'sidePanel-1', connectorB: SIDE_BOTTOM_CAM_BOLT, mover: 'camLockBolt-1' });
    const cam = assembly.seat({ partA: 'camLock-1', connectorA: END_LOW, partB: 'topBottomPanel-1', connectorB: SHELF_LEFT_RECESS, mover: 'camLock-1' });
    assembly.apply(bolt.id, { type: 'crank', radians: FASTENER.screwRadians });
    return { assembly, bolt, cam };
  }

  it('locks only with a bolt caught, and then holds that bolt in', () => {
    const { assembly, bolt, cam } = locked();
    expect(assembly.screwedBolts().map((j) => j.id)).toEqual([bolt.id]);
    assembly.apply(cam.id, { type: 'crank', radians: FASTENER.quarterTurn }, { captured: null });
    expect(assembly.get(cam.id).fastener.state).toBe(STATE.SEATED);
    assembly.apply(cam.id, { type: 'crank', radians: 0.1 }, { captured: 'camLockBolt-1' });
    expect(assembly.get(cam.id)).toMatchObject({ captured: 'camLockBolt-1', fastener: { state: STATE.LOCKED } });
    expect(assembly.apply(bolt.id, { type: 'crank', radians: -FASTENER.screwRadians })).toBe(false);
  });

  it('turns the dowel connection rigid and refuses to pull it apart', () => {
    const { assembly, cam } = locked();
    const bridge = () => assembly.bonds(poseOf).find((b) => b.key.startsWith('bridge:'));
    expect(bridge().mode).toBe('play');
    expect(assembly.pullable('topBottomPanel-1')).toHaveLength(1);
    assembly.apply(cam.id, { type: 'crank', radians: FASTENER.quarterTurn }, { captured: 'camLockBolt-1' });
    expect(bridge().mode).toBe('rigid');
    expect(assembly.pullable('topBottomPanel-1')).toEqual([]);
    // Turning it back open reverses it all.
    assembly.apply(cam.id, { type: 'crank', radians: -FASTENER.quarterTurn });
    expect(bridge().mode).toBe('play');
    expect(assembly.pullable('topBottomPanel-1')).toHaveLength(1);
  });

  it('finds the fastener a seated tool turns', () => {
    const { assembly, bolt } = locked();
    assembly.seat({ partA: 'allenWrench-1', connectorA: 0, partB: 'camLockBolt-1', connectorB: END_HIGH, mover: 'allenWrench-1' });
    expect(assembly.crankTarget('allenWrench-1').target.id).toBe(bolt.id);
    expect(assembly.crankTarget('screwdriver-1')).toBeNull();
  });
});

describe('bonds', () => {
  const pose = (frame) => ({ anchor: frame.anchorA.map((v, i) => v - rotateVector(frame.rotation, frame.anchorB)[i]), rotation: frame.rotation });

  it('makes no bond for merely seated parts', () => {
    expect(corner().assembly.bonds(poseOf)).toEqual([]);
  });

  it('embeds a pressed dowel its sink depth inside the hole', () => {
    const { assembly } = corner();
    assembly.tap('dowel-1');
    assembly.tap('sidePanel-1');
    const [embed] = assembly.bonds(poseOf).filter((b) => b.key === 'embed:dowel-1');
    expect(embed).toMatchObject({ a: 'sidePanel-1', b: 'dowel-1', mode: 'embed' });
    const dowelInSide = pose(embed.frame);
    const end = connectorInWorld(PART_TYPES.dowel.connectors[END_LOW], { position: dowelInSide.anchor, rotation: dowelInSide.rotation });
    const hole = PART_TYPES.sidePanel.connectors[SIDE_BOTTOM_DOWEL];
    expectVec(end.position, hole.position.map((v, i) => v - hole.axis[i] * FASTENER.sinkDepth.dowel));
  });

  it('bridges the two hosts of a doweled joint flush, with play', () => {
    const { assembly } = corner();
    assembly.tap('dowel-1');
    const bridge = assembly.bonds(poseOf).find((b) => b.key.startsWith('bridge:'));
    expect(bridge).toMatchObject({ a: 'sidePanel-1', b: 'topBottomPanel-1', mode: 'play' });
    // Shelf end against the side's inner face: dowel half in each.
    const shelfInSide = pose(bridge.frame);
    expectVec(shelfInSide.anchor, [FACE + SHELF_HALF, BOTTOM_Y, 0]);
    expectVec(shelfInSide.rotation, IDENTITY);
    // It bends where the shelf meets the side.
    expectVec(bridge.frame.anchorB, PART_TYPES.topBottomPanel.connectors[SHELF_LEFT_DOWEL].position);
  });

  it('keeps a shelf pin solid (rigid) so a shelf can rest on it', () => {
    const assembly = createAssembly(typeOf);
    assembly.seat({ partA: 'shelfPin-1', connectorA: END_LOW, partB: 'sidePanel-1', connectorB: SIDE_PIN, mover: 'shelfPin-1' });
    assembly.tap('shelfPin-1');
    expect(assembly.bonds((id) => (id === 'sidePanel-1' ? POSES['sidePanel-1'] : { position: [0.1, 0, 0], rotation: ALONG_X }))).toMatchObject([
      { key: 'embed:shelfPin-1', mode: 'rigid' },
    ]);
  });

  it('changes signature when fastener state moves a bond, and not otherwise', () => {
    const { assembly } = corner();
    assembly.tap('dowel-1');
    const before = assembly.bonds(poseOf).map((b) => b.signature);
    const moved = { ...POSES, 'sidePanel-1': { position: [1, 0, 0], rotation: IDENTITY } };
    expect(assembly.bonds((id) => moved[id]).map((b) => b.signature)).toEqual(before);
  });

  it('accepts a wrong-but-workable pairing exactly like the right one', () => {
    // A second side panel doweled where the bottom panel belongs: wrong, but it fits.
    const right = corner().assembly;
    right.tap('dowel-1');
    const wrong = createAssembly(typeOf);
    wrong.seat({ partA: 'dowel-1', connectorA: END_LOW, partB: 'sidePanel-1', connectorB: SIDE_BOTTOM_DOWEL, mover: 'dowel-1' });
    wrong.seat({ partA: 'sidePanel-2', connectorA: SIDE_BOTTOM_DOWEL_2, partB: 'dowel-1', connectorB: END_HIGH, mover: 'sidePanel-2' });
    wrong.tap('dowel-1');
    const wrongPoses = { ...POSES, 'sidePanel-2': { position: [0.2, 0, 0], rotation: [0, 1, 0, 0] } };
    const shape = (bonds) => bonds.map(({ key, mode }) => [key.split(':')[0], mode]);
    expect(shape(wrong.bonds((id) => wrongPoses[id]))).toEqual(shape(right.bonds(poseOf)));
    expect(wrong.canRelease('sidePanel-2')).toBe(false);
  });
});

describe('restPose', () => {
  it('puts the hardware back at the hole mouth, wherever its host now is', () => {
    const { assembly, inSide } = corner();
    const moved = { ...POSES, 'sidePanel-1': { position: [1, 2, 3], rotation: [0, 1, 0, 0] } };
    const rest = assembly.restPose(inSide.id, (id) => moved[id]);
    const end = connectorInWorld(PART_TYPES.dowel.connectors[END_LOW], rest);
    const hole = connectorInWorld(PART_TYPES.sidePanel.connectors[SIDE_BOTTOM_DOWEL], moved['sidePanel-1']);
    expectVec(end.position, hole.position);
    expectVec(end.axis, hole.axis.map((v) => -v));
  });
});

describe('carryPose', () => {
  it('moves an attached pose by the same rigid motion', () => {
    const from = { position: [0, 0, 0], rotation: IDENTITY };
    const to = { position: [1, 0, 0], rotation: [0, SQRT1_2, 0, SQRT1_2] }; // +90° about y
    const carried = carryPose(from, to, { position: [0, 0, -1], rotation: IDENTITY });
    expectVec(carried.position, [0, 0, 0]);
    expectVec(carried.rotation, to.rotation);
  });

  it('is a pure translation when the rotation is unchanged', () => {
    const from = { position: [1, 2, 3], rotation: [0, 0, SQRT1_2, SQRT1_2] };
    const to = { position: [1.5, 2, 3], rotation: [0, 0, SQRT1_2, SQRT1_2] };
    const pose = { position: [0, 0, 0], rotation: [1, 0, 0, 0] };
    const carried = carryPose(from, to, pose);
    expectVec(carried.position, [0.5, 0, 0]);
    expectVec(carried.rotation, pose.rotation);
  });
});

describe('relativePose', () => {
  it('expresses b in a’s frame', () => {
    const a = { position: [1, 0, 0], rotation: [0, SQRT1_2, 0, SQRT1_2] };
    const b = { position: [1, 0, -1], rotation: [0, SQRT1_2, 0, SQRT1_2] };
    const rel = relativePose(a, b);
    expectVec(rel.anchor, [1, 0, 0]);
    expectVec(rel.rotation, IDENTITY);
  });
});
