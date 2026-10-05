import { createAssembly } from './game/assembly.js';
import { PART_TYPES } from './game/catalog.js';
import { createDevLayout } from './game/devLayout.js';
import { createPartMesh } from './game/partMesh.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { createGhost } from './scene/ghost.js';
import { createCompoundPhysics } from './scene/compoundPhysics.js';
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

// What is seated on and fastened to what — every type-compatible pair, right or wrong.
const typeById = new Map(parts.map(({ id, type }) => [id, type]));
const assembly = createAssembly((id) => typeById.get(id));
// Manipulation goes through this seam so a fastened compound moves as one.
const manipulation = createCompoundPhysics(physics, parts, assembly);

// 90° detents are the default; the toggle frees rotation.
const freeRotate = createToggleButton({ label: 'Free rotate' });
document.body.append(freeRotate.element);

const gizmo = createGizmo({
  camera,
  domElement: renderer.domElement,
  physics: manipulation,
  isFree: () => freeRotate.pressed,
});
scene.add(gizmo.object);

const ghost = createGhost();
scene.add(ghost.object);

const router = createGestureRouter({
  domElement: renderer.domElement,
  camera,
  cameraControls,
  physics: manipulation,
  parts,
  assembly,
  rings: gizmo,
  // Tap a part to select it (unless the tap pushed a fastener home); tap empty space to
  // deselect.
  onTap: (part) => (part ? gizmo.show(part) : gizmo.hide()),
  ghost,
});

createLoop((delta) => {
  cameraControls.update(delta);
  physics.step(delta);
  router.update();
  gizmo.update();
  renderer.render(scene, camera);
}).start();
