import * as THREE from 'three';
import { STAGE } from '../constants.js';
import { lightLevel, lightTint, patchFootprint, sunArc, windowPatch } from '../game/stageLight.js';
import type { SunArc } from '../game/stageLight.js';
import { skyColourAt } from '../game/skyCycle.js';
import type { Rgb } from '../game/skyCycle.js';
import { WALL_NAMES, wallBox, windowOpeningBoxes } from '../game/stageBoxes.js';
import type { StageBox } from '../game/stageBoxes.js';
import type { Vec3 } from '../../tools/validate/lib/geometry.js';

// A clipped quad has at most its four corners plus one per rectangle edge.
const MAX_VERTICES = 8;

interface Patch {
  mesh: THREE.Mesh;
  box: StageBox<string>;
  outward: Vec3;
}

/**
 * The sun through each window, on the floor: one sheared decal per opening (src/game/stageLight.ts `windowPatch`), an
 * additive quad over the planks, no shadow and no spotlight. Built once; `update(phase)` rewrites each decal's corners,
 * and its opacity and colour from the sun's strength and tint. The group goes onto the room's slab piece.
 */
export function createWindowPatches() {
  const group = new THREE.Group();
  group.name = 'windowPatches';
  // One material for every decal: colour and opacity are the sun's, the same for all of them.
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    // A clipped quad's winding depends on the sun's side; either face is the sunlit floor.
    side: THREE.DoubleSide,
  });

  const fan: number[] = [];
  for (let i = 1; i < MAX_VERTICES - 1; i++) fan.push(0, i, i + 1);

  const patches: Patch[] = [];
  for (const name of WALL_NAMES) {
    const { outward } = wallBox(name);
    windowOpeningBoxes(name).forEach((box, i) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3));
      geometry.setIndex(fan);
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${name}WindowPatch${i}`;
      mesh.visible = false;
      // The decal moves under a fixed bounding sphere; it is never worth culling.
      mesh.frustumCulled = false;
      group.add(mesh);
      patches.push({ mesh, box, outward });
    });
  }

  const footprint = patchFootprint();
  const arc: SunArc = { toSun: [0, 0, 0], up: false };
  const sky: Rgb = [0, 0, 0];
  const tint: Rgb = [0, 0, 0];
  let appliedPhase = NaN;
  let appliedFloor = NaN;

  return {
    group,
    update(phase: number) {
      const floor = STAGE.light.nightFloor;
      if (phase === appliedPhase && floor === appliedFloor) return;
      appliedPhase = phase;
      appliedFloor = floor;
      sunArc(phase, arc);
      const level = lightLevel(phase, floor);
      lightTint(phase, skyColourAt(phase, sky), tint);
      material.color.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);
      // The floor's irradiance falls with the sun's height: long and faint at dawn and dusk.
      material.opacity = STAGE.light.patch.opacity * level * arc.toSun[1];
      for (const { mesh, box, outward } of patches) {
        const points = arc.up ? windowPatch(box, outward, arc.toSun, footprint) : [];
        mesh.visible = points.length >= 3;
        if (!mesh.visible) continue;
        const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        points.forEach(([x, z], v) => position.setXYZ(v, x, 0, z));
        position.needsUpdate = true;
        mesh.geometry.setDrawRange(0, 3 * (points.length - 2));
      }
    },
  };
}
