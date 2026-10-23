import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOX, RESET, ROOM } from '../src/constants.js';
import { boxPlacement, lidRest, packedBox } from '../src/game/boxLayout.js';
import { rotatedHalfExtents } from '../src/game/dragMath.js';
import { boxFootprintSize } from '../src/game/roomLayout.js';
import { ITEM_IDS, itemById, PART_TYPES, setItem } from '../src/game/item.js';
import { pickableSet } from '../src/game/pickable.js';
import { checkPack } from '../tools/validate/lib/checks.js';
import { rotateVector } from '../tools/validate/lib/geometry.js';
import type { Vec3 } from '../tools/validate/lib/geometry.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';
import { CONNECTOR, KIND } from '../tools/validate/lib/vocabulary.js';

// 1.9.0.4 acceptance, against the plan's criteria. AC5, the part budget on a phone, is
// manual (stated in the PR body, never faked here).

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pack = (item: string): FlatpackFile => JSON.parse(read(`items/${item}/flatpack.json`));
const SOMNLOS = pack('somnlos');

describe('AC1: SÖMNLÖS validates and ships in the catalog as the fourth item, buildable on every build', () => {
  it('passes the validator, and the shipped items still do', () => {
    for (const item of ['johnny', 'blank', 'overkall', 'somnlos']) expect(checkPack(pack(item)), item).toEqual([]);
  });

  it("is the registry's fourth entry, after ÖVERKÄLL, JOHNNY first, and pickable under an empty flag", () => {
    expect([...ITEM_IDS]).toEqual(['johnny', 'blank', 'overkall', 'somnlos']);
    expect(itemById('somnlos').identity.product).toBe('SÖMNLÖS');
    expect(pickableSet('', ITEM_IDS).has('somnlos')).toBe(true);
  });

  it("is validated by CI, deploy and the app build, on its own line after ÖVERKÄLL's", () => {
    for (const file of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml', '.github/workflows/app.yml']) {
      const lines = read(file).split('\n').map((l) => l.trim());
      const at = (item: string) => lines.indexOf(`- run: npx tsx tools/validate/index.ts items/${item}`);
      expect(at('overkall'), file).toBeGreaterThan(-1);
      expect(at('somnlos'), file).toBe(at('overkall') + 1);
    }
  });
});

describe('AC2: only vocabulary already on main — no new connector, kind or tool', () => {
  it('declares exactly the kinds bolt, cam, dowel, pin, screw and tool', () => {
    expect([...SOMNLOS.vocabulary.fasteners].sort()).toEqual([KIND.BOLT, KIND.CAM, KIND.DOWEL, KIND.PIN, KIND.SCREW, KIND.TOOL]);
    expect([...itemById('somnlos').kinds].sort()).toEqual([KIND.BOLT, KIND.CAM, KIND.DOWEL, KIND.PIN, KIND.SCREW, KIND.TOOL]);
  });

  it('uses only connector types the shipped items already use', () => {
    const shipped = new Set(['johnny', 'blank', 'overkall'].flatMap((item) => Object.values(pack(item).parts).flatMap((p) => p.connectors.map((c) => c.type))));
    for (const part of Object.values(SOMNLOS.parts)) for (const c of part.connectors) expect(shipped, c.type).toContain(c.type);
    expect(Object.values(CONNECTOR)).toEqual(expect.arrayContaining(SOMNLOS.vocabulary.connectors));
  });

  it("brings JOHNNY's hex key and screwdriver as its only tools", () => {
    const johnny = pack('johnny');
    for (const tool of ['allenWrench', 'screwdriver']) expect(SOMNLOS.parts[tool].connectors, tool).toEqual(johnny.parts[tool].connectors);
    expect(Object.keys(SOMNLOS.parts).filter((t) => SOMNLOS.parts[t].connectors.some((c) => c.type === CONNECTOR.WRENCH_TIP || c.type === CONNECTOR.SCREWDRIVER_TIP))).toEqual(['allenWrench', 'screwdriver']);
  });
});

describe('AC4: the slats rest loose; the beam is dowelled in, its legs screwed on', () => {
  const item = itemById('somnlos');
  const typeOf = new Map(item.manifest.map((p) => [p.id, p.type]));

  it('gives the fifteen slats no joint of any kind', () => {
    expect(item.manifest.filter((p) => p.type === 'slat')).toHaveLength(15);
    for (const j of item.assembled.joints) {
      expect([j.hardware, j.host, j.through].some((id) => id !== null && typeOf.get(id) === 'slat'), j.hardware).toBe(false);
    }
  });

  it('fixes the beam with dowels alone and the legs with screws into the beam alone', () => {
    const touching = (type: string) => item.assembled.joints.filter((j) => [j.host, j.through].some((id) => id !== null && typeOf.get(id) === type));
    expect(new Set(touching('beam').map((j) => j.kind))).toEqual(new Set([KIND.DOWEL, KIND.SCREW]));
    expect(touching('beam').filter((j) => j.kind === KIND.SCREW).every((j) => typeOf.get(j.host) === 'leg')).toBe(true);
    expect(touching('leg').every((j) => j.kind === KIND.SCREW && j.through === 'beam-1')).toBe(true);
    expect(touching('leg')).toHaveLength(4);
  });
});

const inRoom = ([x, , z]: number[], [hx, hz]: number[]) => Math.abs(x) + hx <= ROOM.width / 2 && Math.abs(z) + hz <= ROOM.depth / 2;

describe('AC3: the box, its opening and the respawn patch fit the stage', () => {
  beforeAll(() => setItem('somnlos'));
  afterAll(() => setItem('johnny'));

  it('stands the box, lid on or lifted straight off, inside the room where the room puts it', () => {
    const [sx, sz] = boxFootprintSize(packedBox());
    expect(inRoom(BOX.position, [sx / 2, sz / 2])).toBe(true);
    // The lid closes over the walls: its footprint is the box's.
    const lid = lidRest();
    const [hx, , hz] = rotatedHalfExtents(PART_TYPES.boxLid.size.map((d) => d / 2), lid.rotation);
    expect(inRoom(lid.position, [hx, hz])).toBe(true);
  });

  it("lays the respawn patch, on the box's first side, wholly inside the room", () => {
    const { inner, wall } = packedBox();
    const { offset, depth } = RESET.respawn;
    const near = inner[0] / 2 + wall + offset;
    const along = inner[2] / 2 + wall + offset;
    // The patch's four corners, box-local, carried into the room.
    const pose = boxPlacement();
    for (const [x, z] of [[near, -along], [near, along], [near + depth, -along], [near + depth, along]]) {
      const [wx, , wz] = rotateVector(pose.rotation, [x, 0, z] as Vec3).map((v, i) => v + pose.position[i]);
      expect(inRoom([wx, 0, wz], [0, 0]), `corner ${x}, ${z}`).toBe(true);
    }
  });
});
