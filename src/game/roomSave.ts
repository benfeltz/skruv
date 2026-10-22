// The room's save, format 1 (1.9.9.5): one JSON text holding everything in the room.
// Pure: the saver (src/game/roomStore.ts) and the item world's snapshot produce a RoomSave,
// this module is its shape, its text and its reading back. Docs: docs/room-save/format-1.md.
//
//   {
//     format: 1, savedAt: <ISO string>,
//     world:   { sky: { phase }, camera: { position, target } },
//     objects: [ { kind: 'item', id, documentCode, box, lid, parts, joints, page }, … ]
//   }
//
// `objects` is the room: one record per object in it, in the order the room holds them — no
// "current" item, no limit, an empty room is `[]`. This build knows one kind, `item`. The
// extension rule: a new kind of object (scenery, decor) is a new union member, a new guard
// and a new section in the doc, never a format bump; an object whose `kind` this build does
// not know is kept as it was and reported by `parse`, so a save from a newer build survives a
// round trip through an older one. Changing the shape of an existing record is a bump, with
// its migration in `parse`.
//
// The parser checks shape, not the pack: whether `johnny` exists and its ids resolve is the
// restorer's business (1.9.9.1). A malformed `world` or `item` throws, naming the path — a
// half-read item is worse than none. Nothing reads a save yet; 1.9.9.1 restores from it.

import { STATE } from './fasteners.js';
import { KIND } from '../../tools/validate/lib/vocabulary.js';
import type { FastenerKind } from '../../tools/validate/lib/vocabulary.js';
import type { Pose, Quat, Vec3 } from '../../tools/validate/lib/geometry.js';
import type { FastenerState } from './fasteners.js';

export const ROOM_SAVE_FORMAT = 1;

/** The room-wide state: the sky's phase (0 midnight, 0.5 noon, [0, 1)) and where the camera looks from and at. */
export interface WorldState {
  sky: { phase: number };
  camera: { position: Vec3; target: Vec3 };
}

/** One seated pair, as the assembly graph holds it; the fastener's state and progress are copied, never shared. */
export interface SavedJoint {
  hardware: string;
  hardwareConnector: number;
  host: string;
  hostConnector: number;
  kind: FastenerKind;
  mover: string;
  fastener: { state: FastenerState; progress: number };
  through: string | null;
  captured: string | null;
}

/** One item in the room: which pack, where every part is, what is seated and how far fastened, and the manual's page. */
export interface ItemRecord {
  kind: 'item';
  id: string;
  documentCode: string;
  box: Pose;
  lid: Pose;
  parts: Record<string, Pose>;
  joints: SavedJoint[];
  page: number;
}

/** An object of a kind this build does not know: kept as it was. */
export type UnknownObject = { kind: string } & Record<string, unknown>;

export type SavedObject = ItemRecord | UnknownObject;

export interface RoomSave {
  format: typeof ROOM_SAVE_FORMAT;
  savedAt: string;
  world: WorldState;
  objects: SavedObject[];
}

/** The save as one line of text: the store is not for reading. */
export const serialize = (save: RoomSave): string => JSON.stringify(save);

const INSTANCE_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FASTENER_KINDS: readonly string[] = Object.values(KIND);
const FASTENER_STATES: readonly string[] = Object.values(STATE);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumbers = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((c) => Number.isFinite(c));
const isVec3 = (v: unknown): v is Vec3 => isNumbers(v, 3);
const isQuat = (v: unknown): v is Quat => isNumbers(v, 4);
const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isIdOrNull = (v: unknown) => v === null || typeof v === 'string';

/** Throws `path: expected …` unless `ok`. */
function expect(ok: boolean, path: string, what: string): asserts ok {
  if (!ok) throw new Error(`${path}: expected ${what}`);
}

function checkPose(v: unknown, path: string): asserts v is Pose {
  expect(isRecord(v), path, 'a pose');
  expect(isVec3(v.position), `${path}.position`, '3 finite numbers');
  expect(isQuat(v.rotation), `${path}.rotation`, '4 finite numbers');
}

function checkWorld(v: unknown): asserts v is WorldState {
  expect(isRecord(v), 'world', 'an object');
  expect(isRecord(v.sky), 'world.sky', 'an object');
  const phase = v.sky.phase;
  expect(typeof phase === 'number' && Number.isFinite(phase) && phase >= 0 && phase < 1, 'world.sky.phase', 'a number in [0, 1)');
  expect(isRecord(v.camera), 'world.camera', 'an object');
  expect(isVec3(v.camera.position), 'world.camera.position', '3 finite numbers');
  expect(isVec3(v.camera.target), 'world.camera.target', '3 finite numbers');
}

function checkJoint(v: unknown, path: string): asserts v is SavedJoint {
  expect(isRecord(v), path, 'a joint');
  for (const key of ['hardware', 'host', 'mover'] as const) expect(typeof v[key] === 'string', `${path}.${key}`, 'a string');
  for (const key of ['hardwareConnector', 'hostConnector'] as const) expect(isIndex(v[key]), `${path}.${key}`, 'a non-negative integer');
  expect(typeof v.kind === 'string' && FASTENER_KINDS.includes(v.kind), `${path}.kind`, `one of ${FASTENER_KINDS.join(', ')}`);
  expect(isRecord(v.fastener), `${path}.fastener`, 'an object');
  expect(typeof v.fastener.state === 'string' && FASTENER_STATES.includes(v.fastener.state), `${path}.fastener.state`, `one of ${FASTENER_STATES.join(', ')}`);
  const progress = v.fastener.progress;
  expect(typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 1, `${path}.fastener.progress`, 'a number in [0, 1]');
  expect(isIdOrNull(v.through), `${path}.through`, 'a string or null');
  expect(isIdOrNull(v.captured), `${path}.captured`, 'a string or null');
}

function checkItem(v: Record<string, unknown>, path: string): asserts v is Record<string, unknown> & ItemRecord {
  expect(typeof v.id === 'string', `${path}.id`, 'a string');
  expect(typeof v.documentCode === 'string', `${path}.documentCode`, 'a string');
  checkPose(v.box, `${path}.box`);
  checkPose(v.lid, `${path}.lid`);
  expect(isRecord(v.parts), `${path}.parts`, 'an object of poses');
  for (const [id, pose] of Object.entries(v.parts)) {
    expect(INSTANCE_ID.test(id), `${path}.parts.${id}`, 'an instance id like sidePanel-1');
    checkPose(pose, `${path}.parts.${id}`);
  }
  expect(Array.isArray(v.joints), `${path}.joints`, 'an array');
  v.joints.forEach((joint, i) => checkJoint(joint, `${path}.joints[${i}]`));
  expect(isIndex(v.page), `${path}.page`, 'a non-negative integer');
}

/**
 * Reads a save. Throws on another format, a malformed `world` or `item`, naming the path.
 * Objects of an unknown kind are kept in `save.objects` untouched and their kinds listed in `skipped`.
 */
export function parse(text: string): { save: RoomSave; skipped: string[] } {
  const doc: unknown = JSON.parse(text);
  if (!isRecord(doc) || doc.format !== ROOM_SAVE_FORMAT) throw new Error(`not a format ${ROOM_SAVE_FORMAT} room save`);
  expect(typeof doc.savedAt === 'string' && ISO_DATE.test(doc.savedAt), 'savedAt', 'an ISO date string');
  checkWorld(doc.world);
  expect(Array.isArray(doc.objects), 'objects', 'an array');
  const skipped: string[] = [];
  doc.objects.forEach((object: unknown, i: number) => {
    const path = `objects[${i}]`;
    expect(isRecord(object) && typeof object.kind === 'string', `${path}.kind`, 'a string');
    if (object.kind === 'item') checkItem(object, path);
    else skipped.push(object.kind as string);
  });
  return { save: doc as unknown as RoomSave, skipped };
}
