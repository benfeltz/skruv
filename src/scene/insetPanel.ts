import * as THREE from 'three';
import { createInsetModel } from '../game/insetModel.js';
import { insetCameraPose, insetFrame, insideInset } from '../game/insetView.js';
import { createInsetOverlay } from '../ui/inset.js';
import { createInset } from './inset.js';
import type { InsetSubject } from '../game/insetModel.js';
import type { InsetFrame, SafeInsets } from '../game/insetView.js';
import type { InsetHook } from './gestureRouter.js';

/** What the panel is built over: the canvas it frames in, the main camera, and where its ring and tail go. */
export interface InsetPanelDeps {
  domElement: HTMLElement;
  camera: THREE.Camera;
  container: HTMLElement;
  /** The room's ink lines, whose resolution the pass sets to the circle's while it draws. */
  lines: { resolution: THREE.Vector2 };
}

/**
 * The detail inset as the item world owns it: the state model decides whether it shows and
 * what it frames, the view maths place the circle and aim its camera, the render pass draws
 * it and the overlay inks its ring and tail. This only composes them. The router's `hook`
 * feeds it each frame's candidates and its taps; `update()` runs after the router's update;
 * `render()` is the extra pass after the main render. The canvas fills the window, so its
 * client px are the circle's.
 */
export function createInsetPanel({ domElement, camera, container, lines }: InsetPanelDeps) {
  const model = createInsetModel();
  const pass = createInset(lines);
  const overlay = createInsetOverlay(container);
  const probe = createSafeProbe(container);

  let offered: InsetSubject | null = null;
  let engaged: readonly InsetSubject[] = [];
  // The circle this frame, or null while nothing shows.
  let frame: InsetFrame | null = null;
  // Reused every frame.
  const forward = new THREE.Vector3();
  const joint = new THREE.Vector3();

  const hook: InsetHook = {
    candidates(nextOffered, nextEngaged) {
      offered = nextOffered;
      engaged = nextEngaged;
    },
    covers: (point) => frame !== null && insideInset(point, frame),
    tapOutside: (point) => frame !== null && !insideInset(point, frame) && model.tapOutside(),
    tapOn: (part) => model.tapOn(part.id),
  };

  return {
    hook,
    /** One frame: step the model on what the router reported, then place, aim and ink the circle if it shows. */
    update() {
      model.step({ offered, engaged });
      const { state, subject } = model;
      if (!subject || (state !== 'offered' && state !== 'active')) {
        frame = null;
        overlay.hide();
        return;
      }
      const rect = domElement.getBoundingClientRect();
      frame = insetFrame({ width: rect.width, height: rect.height }, probe.read(rect.width, rect.height));
      camera.getWorldDirection(forward);
      forward.y = 0;
      pass.aim(insetCameraPose(subject.centre, subject.axis, [forward.x, forward.y, forward.z]));
      joint.set(...subject.centre).project(camera);
      const anchor: [number, number] = [rect.left + ((joint.x + 1) / 2) * rect.width, rect.top + ((1 - joint.y) / 2) * rect.height];
      overlay.show({ frame, anchor: joint.z < 1 ? anchor : null, active: state === 'active' });
    },
    /** The extra pass after the main render, only while the circle shows. */
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
      if (!frame) return;
      pass.resize(frame, renderer.getPixelRatio());
      pass.render(renderer, scene, frame);
    },
    /** Back to hidden, its memory cleared: a repack. */
    reset() {
      model.reset();
      frame = null;
      overlay.hide();
    },
    dispose() {
      overlay.element.remove();
      probe.element.remove();
      pass.dispose();
    },
  };
}

export type InsetPanel = ReturnType<typeof createInsetPanel>;

// The safe-area insets in CSS px, which only CSS can say: a hidden probe padded by env(), read
// again whenever the viewport changes (a rotation moves the notch).
function createSafeProbe(container: HTMLElement) {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  element.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 0';
  container.append(element);
  const safe: SafeInsets = { top: 0, right: 0 };
  let width = NaN;
  let height = NaN;
  return {
    element,
    read(viewWidth: number, viewHeight: number): SafeInsets {
      if (viewWidth !== width || viewHeight !== height) {
        width = viewWidth;
        height = viewHeight;
        const style = getComputedStyle(element);
        safe.top = parseFloat(style.paddingTop) || 0;
        safe.right = parseFloat(style.paddingRight) || 0;
      }
      return safe;
    },
  };
}
