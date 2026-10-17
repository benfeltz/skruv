import * as THREE from 'three';
import { INSET } from '../constants.js';
import { controlFor, controlSlot, pushLook, toolScreenDirection, turnLook } from '../game/insetControls.js';
import { createInsetModel } from '../game/insetModel.js';
import { insetCameraPose, insetFrame, insetLayout, insideInset } from '../game/insetView.js';
import { CLUSTER_CLASS } from '../ui/controlCluster.js';
import { createInsetOverlay } from '../ui/inset.js';
import { createInsetControls } from '../ui/insetControls.js';
import { createInset } from './inset.js';
import type { InsetSubject } from '../game/insetModel.js';
import type { ScreenBox } from '../game/insetControls.js';
import type { InsetFrame, InsetLayout, SafeInsets } from '../game/insetView.js';
import type { GestureRouter, InsetHook } from './gestureRouter.js';

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
 * client px are the circle's. Beside the circle sit the subject's control — the turn ring for a tool,
 * the push arrow for a dowel — placed clear of the control cluster and driving the router's actions
 * (`connect`, once the router exists); while the circle is offered or dismissed there is none.
 */
export function createInsetPanel({ domElement, camera, container, lines }: InsetPanelDeps) {
  const model = createInsetModel();
  const pass = createInset(lines);
  const overlay = createInsetOverlay(container);
  const probe = createSafeProbe(container);
  // The router's actions the controls drive, once `connect`ed; until then a gesture on a control does nothing.
  let actions: Pick<GestureRouter, 'turnGrip' | 'pressJoint' | 'pullJoint'> | null = null;
  // The subject the controls act on: the one shown while active, else null.
  let driven: InsetSubject | null = null;
  const controls = createInsetControls(container, {
    onTurn: (radians) => driven?.tool && actions?.turnGrip(driven.tool, radians),
    onPush: () => driven && actions?.pressJoint(driven.joint),
    onPull: () => driven && actions?.pullJoint(driven.joint),
  });

  let offered: InsetSubject | null = null;
  let engaged: readonly InsetSubject[] = [];
  let settled: (joint: number) => InsetSubject | null = () => null;
  // The circle this frame, or null while nothing shows.
  let frame: InsetFrame | null = null;
  // The canvas's box and the circle in it, read from layout only when the window has been resized
  // (a rotation included), never per frame: a read after last frame's attribute writes forces a layout flush.
  let box: { left: number; top: number; width: number; height: number } | null = null;
  let placed: InsetFrame | null = null;
  let layout: InsetLayout = 'portrait';
  // The control cluster's box, measured with the canvas's: what the controls keep clear of.
  let cluster: ScreenBox | null = null;
  const resized = () => {
    box = null;
  };
  window.addEventListener('resize', resized);
  // Reused every frame.
  const forward = new THREE.Vector3();
  const joint = new THREE.Vector3();

  const hook: InsetHook = {
    candidates(nextOffered, nextEngaged, nextSettled) {
      offered = nextOffered;
      engaged = nextEngaged;
      settled = nextSettled;
    },
    covers: (point) => frame !== null && insideInset(point, frame),
    tapOutside: (point) => frame !== null && !insideInset(point, frame) && model.tapOutside(),
    tapOn: (part) => model.tapOn(part.id),
  };

  return {
    hook,
    /** One frame: step the model on what the router reported, then place, aim and ink the circle if it shows. */
    update() {
      model.step({ offered, engaged, settled });
      const { state, subject } = model;
      if (!subject || (state !== 'offered' && state !== 'active')) {
        frame = null;
        driven = null;
        overlay.hide();
        controls.hide();
        return;
      }
      if (!box || !placed) {
        const { left, top, width, height } = domElement.getBoundingClientRect();
        box = { left, top, width, height };
        placed = insetFrame({ width, height }, probe.read(width, height));
        layout = insetLayout({ width, height });
        cluster = document.querySelector(`.${CLUSTER_CLASS}`)?.getBoundingClientRect() ?? null;
      }
      const rect = box;
      frame = placed;
      camera.getWorldDirection(forward);
      forward.y = 0;
      const pose = insetCameraPose(subject.centre, subject.axis, [forward.x, forward.y, forward.z]);
      pass.aim(pose);
      joint.set(...subject.centre).project(camera);
      const anchor: [number, number] = [rect.left + ((joint.x + 1) / 2) * rect.width, rect.top + ((1 - joint.y) / 2) * rect.height];
      overlay.show({ frame, anchor: joint.z < 1 ? anchor : null, active: state === 'active' });
      const kind = state === 'active' ? controlFor(subject) : null;
      driven = kind ? subject : null;
      if (!kind) return controls.hide();
      const { centre } = controlSlot(frame, layout, toolScreenDirection(subject.axis, pose), cluster ? [cluster] : [], INSET.controls);
      if (kind === 'turn') controls.showTurn(centre, turnLook(subject));
      else controls.showPush(centre, pushLook(subject));
    },
    /** The router's actions the controls drive: its ring turns the tool, its arrow presses a dowel home and backs it out. */
    connect(router: Pick<GestureRouter, 'turnGrip' | 'pressJoint' | 'pullJoint'>) {
      actions = router;
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
      driven = null;
      overlay.hide();
      controls.hide();
    },
    dispose() {
      window.removeEventListener('resize', resized);
      overlay.element.remove();
      controls.element.remove();
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
