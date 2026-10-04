import { PART_TYPES } from './game/catalog.js';
import { createDevLayout } from './game/devLayout.js';
import { createPartMesh } from './game/partMesh.js';
import { createPhysicsWorld } from './physics/world.js';
import { createCameraControls } from './scene/cameraControls.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';

const { renderer, scene, camera } = createScene(document.getElementById('app'));
scene.add(createRoom());

const cameraControls = createCameraControls(camera, renderer.domElement);
const physics = await createPhysicsWorld();

for (const { type, position, rotation } of createDevLayout()) {
  const part = PART_TYPES[type];
  const mesh = createPartMesh(part);
  physics.register(mesh, {
    halfExtents: part.size.map((d) => d / 2),
    mass: part.mass,
    position,
    rotation,
  });
  scene.add(mesh);
}

createLoop((delta) => {
  cameraControls.update(delta);
  physics.step(delta);
  renderer.render(scene, camera);
}).start();
