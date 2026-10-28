#!/usr/bin/env tsx
// Writes the resolved item the Godot side reads: part types, the assembled instances and the
// derived joints, all from the one pack implementation (tools/validate/lib). GDScript never
// reads a Flatpack file and never derives a joint; this file is its only source of item data.
//
//   npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json          # write
//   npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json --check  # exit 1 on drift
//
// Output (format 2):
//   vocabulary { compatible: { <end type>: <hole type> }, kinds: { <end type>: <kind> },
//                sinkDepth: { <kind>: m } }: the lib's COMPATIBLE, kindOf and CONTRACT.sinkDepth,
//              so GDScript never keeps a second copy of the vocabulary
//   types     { <type>: { size: [x,y,z] m, color: "#rrggbb", mass: kg, hardware: bool,
//             connectors: [{ id, type, position, axis }] } }, every part type in the pack, the
//             tools included (the assembled item uses none of them); connectors in the part's
//             local frame, in file order (joints name them by index)
//   instances [{ id, type, role, position: [x,y,z], rotation: [x,y,z,w] }] in assembled order
//   joints    [{ host, hardware, kind, hostConnector, hardwareConnector, mover, through,
//             captured, position, axis }]: `position` is the hardware's seated end in world
//             space (the hole it sits in), `axis` the hole's world axis; `through` (a fitting's
//             or screw's far panel) and `captured` (a cam's bolt) are the lib's, or null
//   steps     [{ number, pose, parts, joints, turns, tip, tool }]: the manual's build pages, from
//             src/game/bookletModel.ts createBuildSteps, the booklet's own; `joints` and `turns`
//             index `joints` above; `tool` the part type the page puts in hand, or null
// World positions are rounded to ROUND_M; every other number is the pack's own.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLORS } from '../../src/constants.js';
import { connectorInWorld } from '../../tools/validate/lib/geometry.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import { deriveJoints, isHardwareType } from '../../tools/validate/lib/joints.js';
import { loadPack } from '../../tools/validate/lib/pack.js';
import type { FlatpackFile } from '../../tools/validate/lib/pack.js';
import { COMPATIBLE, CONTRACT, kindOf } from '../../tools/validate/lib/vocabulary.js';
import type { ConnectorType } from '../../tools/validate/lib/vocabulary.js';
import { createBuildSteps } from '../../src/game/bookletModel.js';

const FORMAT = 3;
/** Derived world positions are rounded to a micrometre, so float noise never churns the file. */
const ROUND_M = 1e-6;

const round = (v: number) => Math.round(v / ROUND_M) * ROUND_M;
const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function colorOf(key: string): string {
  if (!(key in COLORS)) throw new Error(`no colour ${key} in src/constants.ts COLORS`);
  return hex(COLORS[key as keyof typeof COLORS] as number);
}

export function exportItem(file: FlatpackFile, source: string) {
  const pack = loadPack(file);
  const joints = deriveJoints(pack);
  const byId = new Map(pack.assembled.map((inst) => [inst.id, inst]));
  const ends = Object.keys(COMPATIBLE) as ConnectorType[];
  const steps = createBuildSteps(pack.manual.pages, {
    layout: { parts: pack.assembled, joints },
    partTypes: pack.partTypes,
    resolve: pack.resolve,
  });
  return {
    format: FORMAT,
    source,
    generator: 'godot/tools/export-item.ts',
    product: pack.identity.product,
    vocabulary: {
      compatible: COMPATIBLE,
      kinds: Object.fromEntries(ends.map((end) => [end, kindOf(end)])),
      sinkDepth: CONTRACT.sinkDepth,
    },
    types: Object.fromEntries(
      Object.entries(pack.partTypes).map(([type, t]) => [
        type,
        {
          size: t.size,
          color: colorOf(t.color),
          mass: t.mass,
          hardware: isHardwareType(t),
          connectors: t.connectors.map(({ id, type: connectorType, position, axis }) => ({ id, type: connectorType, position, axis })),
        },
      ]),
    ),
    instances: pack.assembled.map(({ id, type, role, position, rotation }) => ({ id, type, role, position, rotation })),
    extras: pack.manifest.filter(({ id }) => !byId.has(id)).map(({ id, type }) => ({ id, type })),
    joints: joints.map((j) => {
      const hardware = byId.get(j.hardware)!;
      const host = byId.get(j.host)!;
      const end = connectorInWorld(pack.partTypes[hardware.type].connectors[j.hardwareConnector], hardware);
      const hole = connectorInWorld(pack.partTypes[host.type].connectors[j.hostConnector], host);
      return {
        host: j.host,
        hardware: j.hardware,
        kind: j.kind,
        hostConnector: j.hostConnector,
        hardwareConnector: j.hardwareConnector,
        mover: j.mover,
        through: j.through,
        captured: j.captured,
        position: roundVec(end.position),
        axis: roundVec(hole.axis),
      };
    }),
    steps: steps.map(({ number, pose, parts, joints: fasten, turns, tip, tool }) => ({ number, pose, parts, joints: fasten, turns, tip, tool })),
  };
}

function main(argv: string[]) {
  const [itemDir, outPath, flag] = argv;
  if (!itemDir || !outPath || (flag !== undefined && flag !== '--check')) {
    console.error('usage: npx tsx godot/tools/export-item.ts <item folder> <out.json> [--check]');
    return 2;
  }
  const source = join(itemDir, 'flatpack.json');
  const text = `${JSON.stringify(exportItem(JSON.parse(readFileSync(source, 'utf8')) as FlatpackFile, source), null, 2)}\n`;
  if (flag === '--check') {
    let committed = '';
    try {
      committed = readFileSync(outPath, 'utf8');
    } catch {
      // A missing file is drift like any other.
    }
    if (committed !== text) {
      console.error(`export: ${outPath} differs from the exporter's output; rerun without --check and commit it`);
      return 1;
    }
    console.log(`export: ${outPath} matches ${source}`);
    return 0;
  }
  writeFileSync(outPath, text);
  console.log(`export: wrote ${outPath} from ${source}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
