import { createLoop } from './scene/loop.js';
import { createRoom, createTestBox } from './scene/room.js';
import { createScene } from './scene/scene.js';

const { renderer, scene, camera } = createScene(document.getElementById('app'));
scene.add(createRoom(), createTestBox());

createLoop(() => {
  renderer.render(scene, camera);
}).start();
