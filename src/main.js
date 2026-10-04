import { createCameraControls } from './scene/cameraControls.js';
import { createLoop } from './scene/loop.js';
import { createRoom, createTestBox } from './scene/room.js';
import { createScene } from './scene/scene.js';

const { renderer, scene, camera } = createScene(document.getElementById('app'));
scene.add(createRoom(), createTestBox());

const cameraControls = createCameraControls(camera, renderer.domElement);

createLoop((delta) => {
  cameraControls.update(delta);
  renderer.render(scene, camera);
}).start();
