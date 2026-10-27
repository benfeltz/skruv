#!/usr/bin/env tsx
// Writes the resolved item the Godot side reads: part types, the assembled instances and the
// derived joints, all from the one pack implementation (tools/validate/lib). GDScript never
// reads a Flatpack file and never derives a joint; this file is its only source of item data.
//
//   npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json          # write
//   npx tsx godot/tools/export-item.ts items/johnny godot/items/johnny.json --check  # exit 1 on drift
//
// Output (format 1):
//   types     { <type>: { size: [x,y,z] m, color: "#rrggbb", mass: kg, hardware: bool } }, every
//             part type in the pack, the tools included (the assembled item uses none of them)
//   instances [{ id, type, role, position: [x,y,z], rotation: [x,y,z,w] }] in assembled order
//   joints    [{ host, hardware, kind, through, captured, position, axis }]: `position` is the
//             hardware's seated end in world space (the hole it sits in), `axis` the hole's world
//             axis; `through` (a fitting's or screw's far panel) and `captured` (a cam's bolt)
//             are the lib's, or null
// World positions are rounded to ROUND_M; every other number is the pack's own.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLORS } from '../../src/constants.js';
import { connectorInWorld } from '../../tools/validate/lib/geometry.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';
import { deriveJoints, isHardwareType } from '../../tools/validate/lib/joints.js';
import { loadPack } from '../../tools/validate/lib/pack.js';
import type { FlatpackFile } from '../../tools/validate/lib/pack.js';

const FORMAT = 1;
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
  return {
    format: FORMAT,
    source,
    generator: 'godot/tools/export-item.ts',
    product: pack.identity.product,
    types: Object.fromEntries(
      Object.entries(pack.partTypes).map(([type, t]) => [type, { size: t.size, color: colorOf(t.color), mass: t.mass, hardware: isHardwareType(t) }]),
    ),
    instances: pack.assembled.map(({ id, type, role, position, rotation }) => ({ id, type, role, position, rotation })),
    joints: joints.map((j) => {
      const hardware = byId.get(j.hardware)!;
      const host = byId.get(j.host)!;
      const end = connectorInWorld(pack.partTypes[hardware.type].connectors[j.hardwareConnector], hardware);
      const hole = connectorInWorld(pack.partTypes[host.type].connectors[j.hostConnector], host);
      return {
        host: j.host,
        hardware: j.hardware,
        kind: j.kind,
        through: j.through,
        captured: j.captured,
        position: roundVec(end.position),
        axis: roundVec(hole.axis),
      };
    }),
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
