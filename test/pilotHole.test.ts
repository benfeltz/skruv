import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPack } from '../tools/validate/lib/checks.js';
import { CONNECTOR, CONTRACT } from '../tools/validate/lib/vocabulary.js';
import type { FlatpackFile } from '../tools/validate/lib/pack.js';

// The validator's `pilot-hole` rule on the shipped ÖVERKÄLL: a screw's tip counts a pilot hole
// filled when it lands in it, and a tip that misses its pilot is an error. The rule's
// conformance seed (a pilot no tip reaches) is test/validateChecks.test.ts's.

const SHIPPED: FlatpackFile = JSON.parse(readFileSync(new URL('../items/overkall/flatpack.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(SHIPPED);
const pilotErrors = (pack: FlatpackFile) => checkPack(pack).filter((e) => e.rule === 'pilot-hole');
// Every other rule holds on a pack whose only change is where its screw sits.
const otherErrors = (pack: FlatpackFile) => checkPack(pack).filter((e) => e.rule !== 'pilot-hole');
const pilotIndex = (pack: FlatpackFile, type: string) => pack.parts[type].connectors.findIndex((c) => c.type === CONNECTOR.SCREW_PILOT);

describe('pilot-hole', () => {
  it('counts every pilot filled where each screw tip lands, and finds nothing wrong in the shipped pack', () => {
    expect(pilotErrors(SHIPPED)).toEqual([]);
    const pilots = Object.values(SHIPPED.parts).flatMap((part) => part.connectors.filter((c) => c.type === CONNECTOR.SCREW_PILOT));
    expect(pilots.length).toBeGreaterThan(0);
  });

  it('catches a screw whose tip misses its pilot hole', () => {
    const pack = copy();
    // The drawer front's pilot, the knob's: moved 5 mm along the front, clear of the tip.
    const at = pack.parts.drawerFront.connectors[pilotIndex(pack, 'drawerFront')];
    at.position[0] += 0.005;
    const errors = pilotErrors(pack);
    expect(errors.map((e) => e.message)).toEqual([
      'screw-15 tip lands in no screwPilot of drawerFront-1',
      'drawerFront-1/screwPilot-1 takes no screw tip',
    ]);
    expect(otherErrors(pack)).toEqual([]);
  });

  it('takes a tip within the pilot radius, and only down the way the hole opens, no deeper than it runs', () => {
    const near = copy();
    near.parts.drawerFront.connectors[pilotIndex(near, 'drawerFront')].position[0] += CONTRACT.pilotRadius * 0.9;
    expect(pilotErrors(near)).toEqual([]);
    // Further up the screw than the hole runs deep: the tip is 5 mm into the front, the mouth
    // 12 mm out from its face, so 17 mm of hole would be needed against 15.
    const deep = copy();
    deep.parts.drawerFront.connectors[pilotIndex(deep, 'drawerFront')].position[2] += 0.012;
    expect(pilotErrors(deep).map((e) => e.message)).toContain('screw-15 tip lands in no screwPilot of drawerFront-1');
    // A pilot opening the other way is not one the tip went into.
    const turned = copy();
    turned.parts.drawerFront.connectors[pilotIndex(turned, 'drawerFront')].axis = [0, 0, -1];
    expect(pilotErrors(turned).map((e) => e.message)).toContain('screw-15 tip lands in no screwPilot of drawerFront-1');
  });

  it('catches a pilot hole left with no screw in it', () => {
    const pack = copy();
    const side = pack.parts.drawerBottom;
    side.connectors.push({ id: 'screwPilot-7', type: CONNECTOR.SCREW_PILOT, position: [0, 0, 0.1], axis: [0, 1, 0] });
    expect(pilotErrors(pack).map((e) => e.message)).toEqual(['drawerBottom-1/screwPilot-7 takes no screw tip']);
  });
});
