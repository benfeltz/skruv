import * as THREE from 'three';
import { COLORS, INSET } from '../constants.js';
import { insetOrtho } from '../game/insetView.js';
import type { InsetFrame, InsetPose } from '../game/insetView.js';

/**
 * The detail inset's render pass: an orthographic camera drawing the room's parts on the
 * manual's paper into a small render target, and that target drawn as a textured circle
 * over the screen. Built once; `aim` points the camera at a joint, `resize` keeps the target
 * the circle's size in device pixels, `render` is the one extra pass a frame costs. The room
 * sits on LAYER.room, which the camera never enables, so the parts show on paper alone. The
 * ink's fat lines (`lines`, the room's) convert their CSS px width by the material's
 * `resolution`, the canvas's size; for the pass it is the circle's, then the canvas's again.
 */
export function createInset(lines: { resolution: THREE.Vector2 }) {
  const ortho = insetOrtho();
  const camera = new THREE.OrthographicCamera(ortho.left, ortho.right, ortho.top, ortho.bottom, ortho.near, ortho.far);
  const paper = new THREE.Color(COLORS.bookletPaper);
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: INSET.samples });

  // The circle, drawn in CSS px over the screen: y up from the bottom edge, like the canvas's own pixels.
  const overlayScene = new THREE.Scene();
  const overlayCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const material = new THREE.MeshBasicMaterial({ map: target.texture, toneMapped: false, depthTest: false, depthWrite: false });
  const geometry = new THREE.CircleGeometry(1, INSET.segments);
  const circle = new THREE.Mesh(geometry, material);
  overlayScene.add(circle);

  // Reused every frame: the canvas's CSS size, and the ink's while the pass has it.
  const size = new THREE.Vector2();
  const inked = new THREE.Vector2();

  return {
    camera,
    target,
    overlayScene,
    overlayCamera,
    circle,
    /** Points the camera along `pose`. */
    aim({ position, target: at, up }: InsetPose) {
      camera.position.set(...position);
      camera.up.set(...up);
      camera.lookAt(...at);
    },
    /** Makes the target the circle's size in device pixels. */
    resize({ radius }: InsetFrame, pixelRatio: number) {
      const side = Math.ceil(radius * 2 * pixelRatio);
      if (target.width !== side) target.setSize(side, side);
    },
    /**
     * The extra pass: `scene` into the target on paper, then the circle at `frame` over what
     * the main render drew. The renderer's target, auto-clear and the scene's background are
     * as they were after; shadow maps are not touched, so the frame's are reused.
     */
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, { centre, radius }: InsetFrame) {
      const previousTarget = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      const background = scene.background;
      scene.background = paper;
      inked.copy(lines.resolution);
      lines.resolution.set(radius * 2, radius * 2);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      lines.resolution.copy(inked);
      scene.background = background;
      renderer.setRenderTarget(previousTarget);

      renderer.getSize(size);
      if (overlayCamera.right !== size.x || overlayCamera.top !== size.y) {
        overlayCamera.right = size.x;
        overlayCamera.top = size.y;
        overlayCamera.updateProjectionMatrix();
      }
      circle.position.set(centre[0], size.y - centre[1], 0);
      circle.scale.set(radius, radius, 1);
      renderer.autoClear = false;
      renderer.render(overlayScene, overlayCamera);
      renderer.autoClear = autoClear;
    },
    dispose() {
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

export type Inset = ReturnType<typeof createInset>;
