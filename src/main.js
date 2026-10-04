import { PART_TYPES } from './game/catalog.js';
import { createDevLayout } from './game/devLayout.js';
import { createPartMesh } from './game/partMesh.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { createGestureRouter } from './scene/gestureRouter.js';
import { createGizmo } from './scene/gizmo.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';
import { createToggleButton } from './ui/toggleButton.js';

const { renderer, scene, camera } = createScene(document.getElementById('app'));
scene.add(createRoom());

const cameraControls = createCameraControls(camera, renderer.domElement);
const physics = await createPhysicsWorld();

// One record per physical part — what gestures pick, drag and snap.
const parts = [];
for (const { id, type, position, rotation } of createDevLayout()) {
  const part = PART_TYPES[type];
  const mesh = createPartMesh(part);
  const body = physics.register(mesh, {
    halfExtents: part.size.map((d) => d / 2),
    mass: part.mass,
    position,
    rotation,
  });
  scene.add(mesh);
  parts.push({ id, type, mesh, body });
}

// 90° detents are the default; the toggle frees rotation.
const freeRotate = createToggleButton({ label: 'Free rotate' });
document.body.append(freeRotate.element);

const gizmo = createGizmo({
  camera,
  domElement: renderer.domElement,
  physics,
  isFree: () => freeRotate.pressed,
});
scene.add(gizmo.object);

createGestureRouter({
  domElement: renderer.domElement,
  camera,
  cameraControls,
  physics,
  parts,
  rings: gizmo,
  // Tap a part to select it; tap empty space to deselect.
  onTap: (part) => (part ? gizmo.show(part) : gizmo.hide()),
});

createLoop((delta) => {
  cameraControls.update(delta);
  physics.step(delta);
  gizmo.update();
  renderer.render(scene, camera);
}).start();
