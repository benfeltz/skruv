// One-time generator: runs today's JOHNNY modules and writes items/johnny/flatpack.json
// (Flatpack format 1). Deleted with those modules once the game reads the pack.
//
//   node scripts/extractJohnny.js
//
// Connectors keep exactly today's order — engines index them — and are named
// `<connectorType>-<n>`, counted per part type. Spares are the instances today's assembled
// layout leaves in the box (tools aside). Every number is written as computed, never rounded.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONNECTOR, isFastenerEnd, KIND, kindOf } from '../tools/validate/lib/vocabulary.js';
import { BOX, BRAND } from '../src/constants.js';
import { createAssembledLayout } from '../src/game/assembledLayout.js';
import { createBooklet } from '../src/game/buildSteps.js';
import { MANIFEST_QUANTITIES, PART_TYPES } from '../src/game/catalog.js';
import { createPackedLayout } from '../src/game/packedLayout.js';

export const OUTPUT = new URL('../items/johnny/flatpack.json', import.meta.url);

/** Connector names for one part type: `<type>-<n>`, n counting each connector type from 1. */
function connectorIds(connectors) {
  const seen = new Map();
  return connectors.map(({ type }) => {
    const n = (seen.get(type) ?? 0) + 1;
    seen.set(type, n);
    return `${type}-${n}`;
  });
}

/** The pack as a plain object. */
export function extractPack() {
  const layout = createAssembledLayout();
  const placedCount = (type) => layout.parts.filter((p) => p.type === type).length;
  const ids = Object.fromEntries(Object.entries(PART_TYPES).map(([type, part]) => [type, connectorIds(part.connectors)]));

  const parts = Object.fromEntries(
    Object.entries(MANIFEST_QUANTITIES).map(([type, total]) => {
      const { size, partNumber, mass, color, connectors } = PART_TYPES[type];
      // A type the built item uses keeps the rest as spares; tools are never built in.
      const placed = placedCount(type);
      const spares = placed > 0 ? total - placed : 0;
      const part = { partNumber, box: size, mass, color, quantity: total - spares };
      if (spares > 0) part.spares = spares;
      part.connectors = connectors.map((c, i) => ({ id: ids[type][i], type: c.type, position: c.position, axis: c.axis }));
      return [type, part];
    }),
  );

  const used = new Set(Object.keys(parts).flatMap((type) => PART_TYPES[type].connectors.map((c) => c.type)));
  const kinds = new Set([...used].filter(isFastenerEnd).map(kindOf));

  const typeOf = new Map(layout.parts.map((p) => [p.id, p.type]));
  const ref = (part, index) => `${part}/${ids[typeOf.get(part)][index]}`;
  const pair = (i) => {
    const j = layout.joints[i];
    return [ref(j.hardware, j.hardwareConnector), ref(j.host, j.hostConnector)];
  };
  const pages = createBooklet().map((page) => {
    switch (page.kind) {
      case 'cover':
      case 'inventory':
        return { kind: page.kind };
      case 'backCover':
        return { kind: 'back' };
      case 'warning':
      case 'doDont':
        return { kind: page.kind, subject: page.subject };
      case 'step': {
        if (page.tip) return { kind: 'special', number: page.number, pose: page.pose, special: 'tipUpright' };
        const step = { kind: 'step', number: page.number, pose: page.pose };
        if (page.parts.length) step.parts = page.parts;
        if (page.joints.length) step.fasten = page.joints.map(pair);
        if (page.turns.length) step.turn = page.turns.map(pair);
        if (page.tool) step.tool = page.tool;
        return step;
      }
      default:
        throw new Error(`unknown booklet page ${page.kind}`);
    }
  });

  return {
    $schema: '../../tools/validate/flatpack.schema.json',
    format: 1,
    identity: { ...BRAND, description: 'Bookcase, about 80 × 28 × 202 cm' },
    vocabulary: {
      connectors: Object.values(CONNECTOR).filter((type) => used.has(type)),
      fasteners: Object.values(KIND).filter((kind) => kinds.has(kind)),
    },
    parts,
    assembled: layout.parts.map(({ id, role, position, rotation }) => ({ id, role, position, rotation })),
    manual: { pages },
    packing: {
      boxInner: BOX.inner,
      wall: BOX.wall,
      floor: BOX.floor,
      lid: { thickness: BOX.lidThickness, partNumber: PART_TYPES.boxLid.partNumber, mass: PART_TYPES.boxLid.mass, color: PART_TYPES.boxLid.color },
      placements: createPackedLayout().map(({ id, position, rotation }) => ({ id, position, rotation })),
    },
    tuning: {},
  };
}

/**
 * The file's text: 2-space JSON with every array of plain values kept on one line, so a
 * vector reads as one. JSON writes -0 as 0.
 */
export function formatPack(pack) {
  return `${JSON.stringify(pack, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, items) => `[${items.split(/,\s+/).join(', ')}]`)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT, formatPack(extractPack()));
  console.log(`wrote ${fileURLToPath(OUTPUT)}`);
}
