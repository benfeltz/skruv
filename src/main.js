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
import { createDisplayShelf } from './scene/displayShelf.js';
import { createDropGuide } from './scene/dropGuide.js';
import { createFlatpack } from './scene/flatpack.js';
import { createGestureRouter } from './scene/gestureRouter.js';
import { createGizmo } from './scene/gizmo.js';
import { createHighlight } from './scene/highlight.js';
import { createLoop } from './scene/loop.js';
import { createRoom } from './scene/room.js';
import { createScene } from './scene/scene.js';
import { createSprue } from './scene/sprue.js';
import { createBookletPages } from './scene/bookletPages.js';
import { createBookletSheet } from './ui/booklet.js';
import { createToggleButton } from './ui/toggleButton.js';

const { renderer, scene, camera } = createScene(document.getElementById('app'));
scene.add(createRoom());

const cameraControls = createCameraControls(camera, renderer.domElement);
const physics = await createPhysicsWorld();

// The game opens on the closed flatpack: every part packed flat inside, settling at once
// and resting until the lid comes off and a hand disturbs it.
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
  });
  scene.add(mesh);
  parts.push({ id, type, mesh, body });
}

// The display JOHNNY against the wall: already built, its parts ordinary parts.
const display = createDisplayShelf(physics);
for (const part of display.parts) scene.add(part.mesh);
parts.push(...display.parts);

// What is seated on and fastened to what — every type-compatible pair, right or wrong.
const typeById = new Map(parts.map(({ id, type }) => [id, type]));
const assembly = createAssembly((id) => typeById.get(id));
// The display shelf goes in fastened, through the graph's own events.
display.fasten(assembly);
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

// The booklet: pages drawn from the same models, flipped freely — reference, never a gate.
const bookletPages = createBookletPages(renderer);
const booklet = createBookletSheet({ pages: bookletPages });
document.body.append(booklet.thumb, booklet.element);

// While the booklet is open, the open page's parts glow — the player's own set only, never
// the display shelf or the box lid.
const playerParts = parts.filter((part) => !display.parts.includes(part) && part !== flatpack.lid);
const highlight = createHighlight(playerParts);
booklet.onChange(({ page, expanded }) => {
  const shown = bookletPages.pages[page];
  highlight.show(expanded && shown.kind === 'step' ? shown.types : []);
});

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
// The display shelf's physics joints, made by the same reconcile every tap and turn runs.
router.sync();

createLoop((delta) => {
  cameraControls.update(delta);
  physics.step(delta);
  router.update(delta);
  gizmo.update();
  sprue.update();
  highlight.update(delta);
  renderer.render(scene, camera);
}).start();
// The rest of the booklet draws in idle time, after the room is on screen.
bookletPages.prerender();
