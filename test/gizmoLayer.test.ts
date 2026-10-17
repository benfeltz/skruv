import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYER } from '../src/constants.js';
import { createGizmo } from '../src/scene/gizmo.js';

// The rotate gizmo's rings are drawn by the main camera alone (1.10.0.1): the detail inset's camera
// leaves layer 2 out and so shows the parts without controls. Its hit bands stay on the default
// layer, which the router's ray tests, so the rings still turn the part.

function mount() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(0, 0, 2);
  camera.layers.enable(LAYER.gizmo);
  camera.updateMatrixWorld(true);
  const gizmo = createGizmo({ camera, domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } as HTMLElement, physics: { grab() {}, move() {}, release() {} }, isFree: () => true });
  const part = { mesh: new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1)), body: {} } as never;
  gizmo.show(part);
  gizmo.object.updateMatrixWorld(true);
  return { gizmo, camera };
}

describe('the rotate gizmo’s layers', () => {
  it('draws its rings and arrowheads on LAYER.gizmo, which the inset’s camera never enables', () => {
    const { gizmo } = mount();
    const inset = new THREE.OrthographicCamera();
    const drawn: THREE.Mesh[] = [];
    gizmo.object.traverse((o) => o instanceof THREE.Mesh && o.visible && drawn.push(o));
    expect(drawn.length).toBeGreaterThan(0);
    for (const mesh of drawn) {
      expect(mesh.layers.mask).toBe(1 << LAYER.gizmo);
      expect(mesh.layers.test(inset.layers)).toBe(false);
    }
  });

  it('is drawn by the main camera, which enables the layer', () => {
    const { gizmo, camera } = mount();
    const ring = gizmo.object.children.find((o) => o.layers.mask === 1 << LAYER.gizmo)!;
    expect(ring.layers.test(camera.layers)).toBe(true);
  });

  it('still takes a ray: its hit bands stay on the default layer', () => {
    const { gizmo } = mount();
    // Along the part's rotated x ring: from +z at the ring's rim point.
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, -1));
    raycaster.ray.origin.set(0, gizmo.object.scale.x, 2);
    expect(gizmo.hitTest(raycaster)).not.toBeNull();
  });
});
