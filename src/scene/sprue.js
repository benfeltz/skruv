import * as THREE from 'three';
import { COLORS, SPRUE } from '../constants.js';

const SEGMENTS = 16;

/**
 * Model-kit sprue: a stick and ball rising straight up from the selected small part's top,
 * a fat handle to drag millimetre hardware by. It renders and hit-tests; showing it for
 * small parts only is the caller's call (src/main.js), and a press on the ball is a press
 * on its part (src/scene/gestureRouter.js's `sprue` hook) — so dragging the ball is the
 * part's normal drag.
 */
export function createSprue() {
  const object = new THREE.Group();
  object.visible = false;
  const material = new THREE.MeshStandardMaterial({ color: COLORS.sprue });
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(SPRUE.stickRadius, SPRUE.stickRadius, SPRUE.length, SEGMENTS), material);
  stick.position.y = SPRUE.length / 2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(SPRUE.ballRadius, SEGMENTS, SEGMENTS / 2), material);
  ball.position.y = SPRUE.length;
  // Never rendered — raycasts ignore visibility, so it widens the touch target.
  const hitBall = new THREE.Mesh(new THREE.SphereGeometry(SPRUE.hitRadius, SEGMENTS, SEGMENTS / 2));
  hitBall.position.y = SPRUE.length;
  hitBall.visible = false;
  object.add(stick, ball, hitBall);

  let part = null;
  const top = new THREE.Box3();

  function show(next) {
    part = next;
    object.visible = true;
    update();
  }

  function hide() {
    part = null;
    object.visible = false;
  }

  /** Follows the selected part, standing on its highest point; call once per frame. */
  function update() {
    if (!part) return;
    const { mesh } = part;
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    top.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    object.position.set(mesh.position.x, top.max.y, mesh.position.z);
  }

  function hitTest(raycaster) {
    if (!part) return null;
    object.updateMatrixWorld();
    const [first] = raycaster.intersectObject(hitBall, false);
    return first ? { point: first.point.toArray(), distance: first.distance } : null;
  }

  return {
    object,
    show,
    hide,
    update,
    hitTest,
    get selected() {
      return part;
    },
  };
}
