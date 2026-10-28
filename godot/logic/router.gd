class_name Router
extends RefCounted
## The gesture router: pointer events in, camera versus part decided, the build played. The
## port of src/scene/gestureRouter.ts's flow, kept in logic/ so the headless hand plays the same
## gestures a mouse does. Pure: viewport px and ms in; the camera is reached only through
## OrbitCamera's enable()/disable() seam, mirrored from Gesture.camera_enabled() after every
## event, so a press that hits no part leaves the camera as it was and every end hands it back.
##
## Step 1 (camera): a press on no part is the camera's, and so is any right or middle press; a
## press on a part is the part's (handed to the scene as a Gesture effect).

var gesture := Gesture.new()
var camera: OrbitCamera
## What a press hits: `(screen: Vector2) -> Dictionary` (a Gesture hit, or {} for empty space).
var hit_test := Callable()


func _init(orbit: OrbitCamera = null) -> void:
	camera = orbit if orbit != null else OrbitCamera.new()


## A button down at `at` (0 left, 1 middle, 2 right) at `t` ms. Returns the gesture's effect.
func press(button: int, at: Vector2, t: int) -> Gesture.Effect:
	var hit: Dictionary = {}
	if gesture.owner == "" and button == 0 and hit_test.is_valid():
		hit = hit_test.call(at)
	var effect := gesture.down(0, at.x, at.y, t, hit, button)
	_sync_camera()
	camera.press(button, at)
	return effect


func motion(at: Vector2) -> Gesture.Effect:
	var effect := gesture.move(0, at.x, at.y)
	camera.motion(at)
	return effect


func release(button: int, at: Vector2, t: int) -> Gesture.Effect:
	camera.release(button)
	var effect := gesture.up(0, at.x, at.y, t)
	_sync_camera()
	return effect


## A wheel of `dy` px (positive scrolls down): a lift while a part is dragged, else the camera's zoom.
func wheel(dy: float, at: Vector2) -> Gesture.Effect:
	var effect := gesture.wheel(dy)
	if effect == null and gesture.camera_enabled():
		camera.wheel(dy, at)
	return effect


## Focus lost: whatever is live is abandoned, the camera handed back.
func interrupted() -> Gesture.Effect:
	var effect := gesture.cancel_all()
	_sync_camera()
	return effect


func update(delta: float) -> void:
	camera.update(delta)


func _sync_camera() -> void:
	if gesture.camera_enabled():
		camera.enable()
	else:
		camera.disable()
