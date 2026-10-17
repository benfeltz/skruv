import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COLORS, INSET } from '../src/constants.js';
import { createInset } from '../src/scene/inset.js';

// A renderer that records what it is asked, in order.
function spyRenderer(width = 800, height = 600) {
  const calls: { scene: THREE.Object3D; camera: THREE.Camera; target: THREE.WebGLRenderTarget | null; autoClear: boolean; background: THREE.Scene['background'] }[] = [];
  const renderer = {
    autoClear: true,
    current: null as THREE.WebGLRenderTarget | null,
    getRenderTarget() {
      return this.current;
    },
    setRenderTarget(t: THREE.WebGLRenderTarget | null) {
      this.current = t;
    },
    getSize(v: THREE.Vector2) {
      return v.set(width, height);
    },
    render(scene: THREE.Scene, camera: THREE.Camera) {
      calls.push({ scene, camera, target: this.current, autoClear: this.autoClear, background: scene.background });
    },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, state: renderer, calls };
}
const frame = { centre: [400, 100] as [number, number], radius: 100 };
const lines = () => ({ resolution: new THREE.Vector2(800, 600) });

describe('the inset render pass', () => {
  it('renders the scene into the target with its own camera, then the circle over the screen', () => {
    const inset = createInset(lines());
    const scene = new THREE.Scene();
    const { renderer, calls } = spyRenderer();
    inset.render(renderer, scene, frame);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ scene, camera: inset.camera, target: inset.target });
    expect(calls[1]).toMatchObject({ scene: inset.overlayScene, target: null, autoClear: false });
  });

  it('restores the renderer’s target and auto-clear, and the scene’s background', () => {
    const inset = createInset(lines());
    const scene = new THREE.Scene();
    const before = new THREE.Color(0x123456);
    scene.background = before;
    const outer = new THREE.WebGLRenderTarget(4, 4);
    const { renderer, state } = spyRenderer();
    state.current = outer;
    inset.render(renderer, scene, frame);
    expect(state.current).toBe(outer);
    expect(state.autoClear).toBe(true);
    expect(scene.background).toBe(before);
  });

  it('paints the scene on the manual’s paper for the inset’s render only', () => {
    const inset = createInset(lines());
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x123456);
    const { renderer, calls } = spyRenderer();
    inset.render(renderer, scene, frame);
    expect((calls[0].background as THREE.Color).getHex()).toBe(COLORS.bookletPaper);
  });

  it('never enables the room’s layer on its camera', () => {
    expect(createInset(lines()).camera.layers.mask).toBe(1);
  });

  it('draws the circle at the frame, flipped to the canvas’s y-up pixels', () => {
    const inset = createInset(lines());
    const { renderer } = spyRenderer(800, 600);
    inset.render(renderer, new THREE.Scene(), frame);
    expect(inset.circle.position.toArray()).toEqual([400, 500, 0]);
    expect(inset.circle.scale.x).toBe(100);
    expect(inset.circle.scale.y).toBe(100);
  });

  it('sizes the overlay camera to the canvas', () => {
    const inset = createInset(lines());
    const { renderer } = spyRenderer(800, 600);
    inset.render(renderer, new THREE.Scene(), frame);
    expect([inset.overlayCamera.right, inset.overlayCamera.top]).toEqual([800, 600]);
    expect(inset.overlayScene.children).toContain(inset.circle);
  });

  it('resizes the target to the circle in device pixels and keeps the texture on the circle', () => {
    const inset = createInset(lines());
    inset.resize({ centre: [0, 0], radius: 100 }, 2);
    expect(inset.target.width).toBe(400);
    expect(inset.target.height).toBe(400);
    expect((inset.circle.material as THREE.MeshBasicMaterial).map).toBe(inset.target.texture);
    inset.resize({ centre: [0, 0], radius: 70.2 }, 1.5);
    expect(inset.target.width).toBe(Math.ceil(70.2 * 2 * 1.5));
    expect((inset.circle.material as THREE.MeshBasicMaterial).map).toBe(inset.target.texture);
  });

  it('draws the ink’s lines at the circle’s size for the inset pass only, then gives the canvas’s back', () => {
    const ink = lines();
    const inset = createInset(ink);
    const seen: number[][] = [];
    const { renderer } = spyRenderer();
    const draw = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => {
      seen.push(ink.resolution.toArray());
      draw(scene, camera);
    };
    inset.render(renderer, new THREE.Scene(), frame);
    expect(seen).toEqual([[200, 200], [800, 600]]);
    expect(ink.resolution.toArray()).toEqual([800, 600]);
  });

  it('multisamples the target', () => {
    expect(createInset(lines()).target.samples).toBe(INSET.samples);
  });

  it('points the camera at the joint along the pose', () => {
    const inset = createInset(lines());
    inset.aim({ position: [0, 1, 1], target: [0, 0, 0], up: [0, 1, 0] });
    expect(inset.camera.position.toArray()).toEqual([0, 1, 1]);
    const forward = inset.camera.getWorldDirection(new THREE.Vector3());
    expect(forward.y).toBeCloseTo(-Math.SQRT1_2);
    expect(forward.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it('disposes the target, circle geometry and material', () => {
    const inset = createInset(lines());
    let targets = 0;
    let geometries = 0;
    let materials = 0;
    inset.target.addEventListener('dispose', () => targets++);
    inset.circle.geometry.addEventListener('dispose', () => geometries++);
    (inset.circle.material as THREE.Material).addEventListener('dispose', () => materials++);
    inset.dispose();
    expect([targets, geometries, materials]).toEqual([1, 1, 1]);
  });
});
