import { PICK } from './constants.js';
import { createAssembly } from './game/assembly.js';
import { PART_TYPES } from './game/catalog.js';
import { createPartMesh } from './game/partMesh.js';
import { createPackedWorldLayout } from './game/packedLayout.js';
import { isSmallPart } from './game/pickMath.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { createGhost } from './scene/ghost.js';
import { createCompoundPhysics } from './scene/compoundPhysics.js';
import { createDropGuide } from './scene/dropGuide.js';
import { createFlatpack } from './scene/flatpack.js';
import { createGestureRouter } from './scene/gestureRouter.js';
import { createGizmo } from './scene/gizmo.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';
import { createSprue } from './scene/sprue.js';
import { createToggleButton } from './ui/toggleButton.js';

const { renderer, scene, camera } = createScene(document.getElementById('app'));
scene.add(createRoom());

const cameraControls = createCameraControls(camera, renderer.domElement);
const physics = await createPhysicsWorld();

// The game opens on the closed flatpack: every part packed flat inside, asleep until the
// lid comes off and a hand disturbs it.
const flatpack = createFlatpack(physics);
scene.add(flatpack.object, flatpack.lid.mesh);

// One record per physical part — what gestures pick, drag and snap. The lid is one too.
const parts = [flatpack.lid];
for (const { id, type, position, rotation } of createPackedWorldLayout()) {
  const part = PART_TYPES[type];
  const mesh = createPartMesh(part);
  const body = physics.register(mesh, {
    halfExtents: part.size.map((d) => d / 2),
    mass: part.mass,
    position,
    rotation,
    asleep: true,
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

// While a part is dragged: where it would land, and the hole it would drop onto.
const dropGuide = createDropGuide();
scene.add(dropGuide.object);

// A model-kit handle on a selected fastener or tool, to drag millimetre hardware by.
const sprue = createSprue();
scene.add(sprue.object);

function select(part) {
  if (!part) {
    gizmo.hide();
    sprue.hide();
    return;
  }
  gizmo.show(part);
  if (isSmallPart(PART_TYPES[part.type].size, PICK)) sprue.show(part);
  else sprue.hide();
}

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
  onTap: select,
  ghost,
  sprue,
  dropGuide,
});

createLoop((delta) => {
  cameraControls.update(delta);
  physics.step(delta);
  router.update(delta);
  gizmo.update();
  sprue.update();
  renderer.render(scene, camera);
}).start();
