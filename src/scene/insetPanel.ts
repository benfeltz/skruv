import * as THREE from 'three';
import { bubbleOf, controlFor, pushLook, turnLook } from '../game/insetControls.js';
import { createInsetModel } from '../game/insetModel.js';
import { insetCameraPose, insetFrame, insideInset, safeWithin } from '../game/insetView.js';
import { createInsetOverlay } from '../ui/inset.js';
import { createInsetControls } from '../ui/insetControls.js';
import { createInset } from './inset.js';
import type { InsetSubject } from '../game/insetModel.js';
import type { ScreenPoint } from '../game/dragMath.js';
import type { InsetFrame, SafeInsets } from '../game/insetView.js';
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
 * `render()` is the extra pass after the main render. The canvas no longer fills the window (the band takes an edge), so the
 * circle lives in the view's px: the ring and the controls are framed as the canvas is (src/ui/inset.ts), so they and the render pass share
 * one origin by construction, and the router's client points are brought into the view per event. The safe insets that reach into the
 * view are what the circle keeps clear of. Attached to the circle, as the manual's tool bubble is to its detail
 * inset, sits the subject's control — the spinner for a turn (a tool's or a part circled by hand, the same small bubble), the push bubble for a dowel — driving the router's
 * actions (`connect`, once the router exists); while the circle is offered or dismissed there is none.
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
    onTurn: (radians) => driven?.grip && actions?.turnGrip(driven.grip, radians),
    onPush: () => driven && actions?.pressJoint(driven.joint),
    onPull: () => driven && actions?.pullJoint(driven.joint),
  });

  let offered: InsetSubject | null = null;
  let engaged: readonly InsetSubject[] = [];
  let settled: (joint: number) => InsetSubject | null = () => null;
  // The circle this frame in the view's px (the canvas's own: the render pass, the overlay and the controls all draw in them), or null while nothing shows.
  let shown: InsetFrame | null = null;
  // The canvas's box and the circle in it, read from layout only when the window has been resized
  // (a rotation included), never per frame: a read after last frame's attribute writes forces a layout flush.
  let box: { left: number; top: number; width: number; height: number } | null = null;
  let placed: InsetFrame | null = null;
  const resized = () => {
    box = null;
    probe.invalidate();
  };
  window.addEventListener('resize', resized);
  // A turn end over end keeps the canvas's size but moves the notch and the band: not every browser says so with a resize.
  const orientation = typeof screen === 'undefined' ? undefined : screen.orientation;
  orientation?.addEventListener('change', resized);
  // A press on the canvas owns the finger until it lifts: the controls go inert, so a part carried over one keeps its moves.
  const pressed = () => controls.setInert(true);
  const lifted = () => controls.setInert(false);
  domElement.addEventListener('pointerdown', pressed, { capture: true });
  window.addEventListener('pointerup', lifted);
  window.addEventListener('pointercancel', lifted);
  // Reused every frame.
  const forward = new THREE.Vector3();
  const joint = new THREE.Vector3();

  // The router's client points into the view, with a fresh read of where the canvas stands: one per event, never per frame.
  const toView = ([x, y]: ScreenPoint): ScreenPoint => {
    const { left, top } = domElement.getBoundingClientRect();
    return [x - left, y - top];
  };

  const hook: InsetHook = {
    candidates(nextOffered, nextEngaged, nextSettled) {
      offered = nextOffered;
      engaged = nextEngaged;
      settled = nextSettled;
    },
    covers: (point) => shown !== null && insideInset(toView(point), shown),
    tapOutside: (point) => shown !== null && !insideInset(toView(point), shown) && model.tapOutside(),
    tapOn: (part) => model.tapOn(part.id),
  };

  return {
    hook,
    /** One frame: step the model on what the router reported, then place, aim and ink the circle if it shows. */
    update() {
      model.step({ offered, engaged, settled });
      const { state, subject } = model;
      if (!subject || (state !== 'offered' && state !== 'active')) {
        shown = null;
        driven = null;
        overlay.hide();
        controls.hide();
        return;
      }
      if (!box || !placed) {
        const { left, top, width, height } = domElement.getBoundingClientRect();
        box = { left, top, width, height };
        placed = insetFrame({ width, height }, safeWithin(box, { width: window.innerWidth, height: window.innerHeight }, probe.read()));
      }
      const rect = box;
      shown = placed;
      camera.getWorldDirection(forward);
      forward.y = 0;
      pass.aim(insetCameraPose(subject.centre, subject.axis, [forward.x, forward.y, forward.z]));
      joint.set(...subject.centre).project(camera);
      const anchor: [number, number] = [((joint.x + 1) / 2) * rect.width, ((1 - joint.y) / 2) * rect.height];
      overlay.show({ frame: shown, anchor: joint.z < 1 ? anchor : null, active: state === 'active' });
      const kind = state === 'active' ? controlFor(subject) : null;
      driven = kind ? subject : null;
      if (!kind) return controls.hide();
      if (kind === 'turn') controls.showTurn(bubbleOf(shown), turnLook(subject));
      else controls.showPush(bubbleOf(shown), pushLook(subject));
    },
    /** The router's actions the controls drive: its spinner turns the tool or the hand-turned part, its push bubble presses a dowel home and backs it out. */
    connect(router: Pick<GestureRouter, 'turnGrip' | 'pressJoint' | 'pullJoint'>) {
      actions = router;
    },
    /** The extra pass after the main render, only while the circle shows. */
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
      if (!shown) return;
      pass.resize(shown, renderer.getPixelRatio());
      pass.render(renderer, scene, shown);
    },
    /** Back to hidden, its memory cleared: a repack. */
    reset() {
      model.reset();
      shown = null;
      driven = null;
      overlay.hide();
      controls.hide();
    },
    dispose() {
      window.removeEventListener('resize', resized);
      orientation?.removeEventListener('change', resized);
      domElement.removeEventListener('pointerdown', pressed, { capture: true });
      window.removeEventListener('pointerup', lifted);
      window.removeEventListener('pointercancel', lifted);
      overlay.element.remove();
      controls.element.remove();
      probe.element.remove();
      pass.dispose();
    },
  };
}

export type InsetPanel = ReturnType<typeof createInsetPanel>;

// The safe-area insets in CSS px, which only CSS can say: a hidden probe padded by env(), read
// again whenever the window is resized or turned (a rotation moves the notch).
function createSafeProbe(container: HTMLElement) {
  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  element.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) 0';
  container.append(element);
  const safe: SafeInsets = { top: 0, right: 0, bottom: 0 };
  let stale = true;
  return {
    element,
    /** The next read asks CSS again: the window turned or resized. */
    invalidate() {
      stale = true;
    },
    read(): SafeInsets {
      if (stale) {
        stale = false;
        const style = getComputedStyle(element);
        safe.top = parseFloat(style.paddingTop) || 0;
        safe.right = parseFloat(style.paddingRight) || 0;
        safe.bottom = parseFloat(style.paddingBottom) || 0;
      }
      return safe;
    },
  };
}
