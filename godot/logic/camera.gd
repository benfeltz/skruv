class_name OrbitCamera
extends RefCounted
## The room camera: orbit, pan and zoom about a target, held to the web's limits. The port of
## src/scene/cameraLimits.ts (the limit geometry, whole) and of the OrbitControls behaviour
## src/scene/cameraControls.ts configures (left drag orbits, right drag pans, middle drag and the
## wheel zoom toward the cursor, damped; the pivot picked along the line of sight as a gesture
## starts). Pure: viewport px in, an eye and a target out; the scene's Camera3D only copies them
## (scenes/camera_rig.gd).
##
## `enable()`/`disable()` is the seam: the router (logic/router.gd) drives camera versus part
## through it, from the gesture machine's camera_enabled(), after every event. Nothing reaches the
## orbit state directly. Disabled, every input is ignored (damping still settles).
##
## `View` is the pinhole the camera stands for: the router projects connectors and casts the
## pointer's ray through it, so the headless hand and the mouse see the same screen.

## OrbitControls' defaults the web leaves as they are.
const ROTATE_SPEED := 1.0
const ZOOM_SPEED := 1.0
## The wheel px of one mouse-wheel notch (a browser's deltaY for one notch).
const WHEEL_NOTCH_PX := 100.0
const UP := Vector3.UP
## Spherical safety margin on the polar angle (OrbitControls' makeSafe).
const POLAR_EPS := 1e-6


## A perspective view: from `eye` toward `target`, `fov` degrees tall, over a `size` px viewport.
## The same projection as a Camera3D looked at `target` from `eye` with a vertical fov (Godot's
## KEEP_HEIGHT), so a point the router projects is where the scene draws it.
class View:
	var eye: Vector3
	var target: Vector3
	var fov: float
	var size: Vector2

	func _init(e: Vector3 = Vector3.ZERO, t: Vector3 = Vector3.FORWARD, f: float = Constants.CAMERA.fov, s: Vector2 = Vector2(1152, 648)) -> void:
		eye = e
		target = t
		fov = f
		size = s

	## The camera's world basis: x right, y up, z back (Godot's -Z looks forward).
	func basis() -> Basis:
		var back := (eye - target).normalized()
		var right := UP.cross(back).normalized()
		if right.length() < 1e-9:
			right = Vector3.RIGHT
		var up := back.cross(right).normalized()
		return Basis(right, up, back)

	## A world point in viewport px (y down), or the far side's mirror when it is behind the eye.
	func project(point: Vector3) -> Vector2:
		var b := basis()
		var d := point - eye
		var z := -d.dot(b.z)
		if absf(z) < 1e-9:
			z = 1e-9
		var f := 1.0 / tan(deg_to_rad(fov) / 2.0)
		var aspect := size.x / size.y
		var nx := d.dot(b.x) * f / (z * aspect)
		var ny := d.dot(b.y) * f / z
		return Vector2((nx + 1.0) / 2.0 * size.x, (1.0 - ny) / 2.0 * size.y)

	## The unit ray from the eye through viewport point `screen`.
	func ray(screen: Vector2) -> Vector3:
		var b := basis()
		var f := 1.0 / tan(deg_to_rad(fov) / 2.0)
		var aspect := size.x / size.y
		var nx := screen.x / size.x * 2.0 - 1.0
		var ny := 1.0 - screen.y / size.y * 2.0
		return (b.x * (nx * aspect / f) + b.y * (ny / f) - b.z).normalized()

	## The unit direction the view looks along.
	func forward() -> Vector3:
		return (target - eye).normalized()


# --- cameraLimits.ts, whole ---------------------------------------------------------------


## `position` pulled back from `target` along the same view, `scale` times as far (startPosition).
static func start_position(position: Vector3, target: Vector3, scale: float) -> Vector3:
	return target + (position - target) * scale


## How far the camera may zoom out for a view `aspect` wide per tall (zoomOutLimit).
static func zoom_out_limit(aspect: float, max_distance: float = Constants.CAMERA_LIMITS.maxDistance) -> float:
	if aspect > 0.0 and is_finite(aspect):
		return max_distance * maxf(1.0, 1.0 / aspect)
	return max_distance


## The orbit target, held over the floor and inside the walls (clampTarget).
static func clamp_target(t: Vector3, room: Vector2 = Vector2(Constants.ROOM.width, Constants.ROOM.depth)) -> Vector3:
	var reach_x := room.x / 2.0 - Constants.CAMERA_LIMITS.targetMargin
	var reach_z := room.y / 2.0 - Constants.CAMERA_LIMITS.targetMargin
	var h := Constants.CAMERA_LIMITS.targetHeight
	return Vector3(clampf(t.x, -reach_x, reach_x), clampf(t.y, h.x, h.y), clampf(t.z, -reach_z, reach_z))


## The camera, held above the floor; outside the room it is free (clampCamera).
static func clamp_camera(p: Vector3) -> Vector3:
	return Vector3(p.x, maxf(Constants.CAMERA_LIMITS.floorClearance, p.y), p.z)


## Pan speed multiplier at `distance` from the target (panSpeedAt).
static func pan_speed_at(distance: float) -> float:
	if not (distance > 0.0):
		return Constants.CAMERA_LIMITS.maxPanBoost
	return minf(Constants.CAMERA_LIMITS.maxPanBoost, maxf(1.0, Constants.CAMERA_LIMITS.panReference / distance))


## The target clamped like clamp_target, but out of its height range it slides back along the line
## of sight from `eye` to the bound it crossed (clampTargetAlongView).
static func clamp_target_along_view(target: Vector3, eye: Vector3, room: Vector2 = Vector2(Constants.ROOM.width, Constants.ROOM.depth)) -> Vector3:
	var h := Constants.CAMERA_LIMITS.targetHeight
	var y := target.y
	var bounded := y < h.x or y > h.y
	var bound := h.x if y < h.x else h.y
	if bounded and (eye.y - bound) * (y - bound) < 0.0:
		var t := (eye.y - bound) / (eye.y - y)
		return clamp_target(eye + (target - eye) * t, room)
	return clamp_target(target, room)


## How far along unit `direction` from `eye` the floor at height `floor` is, or -1 looking level
## or up, or from the floor (floorReach).
static func _floor_reach(eye: Vector3, direction: Vector3, floor: float) -> float:
	var down := -direction.y
	return (eye.y - floor) / down if eye.y > floor and down > 1e-6 else -1.0


## The target moved along the line of sight to the floor when within maxDistance (seatOnFloor).
static func seat_on_floor(eye: Vector3, target: Vector3, max_distance: float = Constants.CAMERA_LIMITS.maxDistance) -> Vector3:
	if eye.is_equal_approx(target):
		return target
	var direction := (target - eye).normalized()
	var reach := _floor_reach(eye, direction, Constants.CAMERA_LIMITS.targetHeight.x)
	if reach < 0.0 or reach > max_distance:
		return target
	return eye + direction * reach


## The pivot for a gesture about to start: the target moved along the line of sight to the nearer
## of `hit_distance` (the first part that line meets, or -1) and the floor, each only if within
## [minDistance, maxDistance] and left alone by clamp_target; else the target stays
## (pivotAlongView).
static func pivot_along_view(eye: Vector3, target: Vector3, hit_distance: float, max_distance: float = Constants.CAMERA_LIMITS.maxDistance, room: Vector2 = Vector2(Constants.ROOM.width, Constants.ROOM.depth)) -> Vector3:
	if eye.is_equal_approx(target):
		return target
	var direction := (target - eye).normalized()
	var best := INF
	for d: float in [hit_distance, _floor_reach(eye, direction, Constants.CAMERA_LIMITS.targetHeight.x)]:
		if d < 0.0 or d < Constants.CAMERA_LIMITS.minDistance or d > max_distance:
			continue
		var point := eye + direction * d
		if not clamp_target(point, room).is_equal_approx(point):
			continue
		best = minf(best, d)
	return eye + direction * best if best < INF else target


# --- the orbit (OrbitControls as cameraControls.ts sets it up) ----------------------------

## Where OrbitControls has the eye, unclamped: its orbit and zoom kept whole; `eye()` is the
## clamped one drawn (cameraControls.ts `free`).
var free: Vector3
var target: Vector3
var viewport := Vector2(1152, 648)
var room := Vector2(Constants.ROOM.width, Constants.ROOM.depth)
var enabled := true
## How far along the line of sight the first part is, `(origin, direction) -> float` (-1 none):
## the pivot's part pick. Unset: the floor pivot only.
var pick_distance := Callable()

var _theta_delta := 0.0
var _phi_delta := 0.0
var _pan_offset := Vector3.ZERO
var _scale := 1.0
var _zoom_cursor := Vector2(-1, -1)
var _buttons: Dictionary[int, bool] = {}
var _last := Vector2.ZERO


func _init(eye_at: Vector3 = Constants.CAMERA.startPosition, target_at: Vector3 = Constants.CAMERA.startTarget) -> void:
	free = eye_at
	target = target_at
	update(0.0)


func enable() -> void:
	enabled = true


## Disabled, a press, move or wheel is ignored and a live orbit/pan ends; damping still settles.
func disable() -> void:
	enabled = false
	_buttons.clear()


## The eye as drawn: clamped above the floor.
func eye() -> Vector3:
	return clamp_camera(free)


func view() -> View:
	return View.new(eye(), target, Constants.CAMERA.fov, viewport)


## The zoom-out limit in force: landscape's, scaled by a taller-than-wide view's aspect.
func max_distance() -> float:
	return zoom_out_limit(viewport.x / viewport.y)


# --- input, as OrbitControls takes it ---

## A mouse button down (0 left orbits, 1 middle dollies, 2 right pans) at viewport `at`. Starts a
## gesture: the pivot is picked once, here (cameraControls.ts pickPivot on OrbitControls' start).
func press(button: int, at: Vector2) -> void:
	if not enabled:
		return
	if _buttons.is_empty():
		_pick_pivot()
	_buttons[button] = true
	_last = at


func release(button: int) -> void:
	_buttons.erase(button)


## The pointer moved to `at`: orbits, pans or dollies by whichever button is down.
func motion(at: Vector2) -> void:
	if not enabled or _buttons.is_empty():
		_last = at
		return
	var d := at - _last
	_last = at
	if _buttons.has(0):
		rotate(d)
	elif _buttons.has(2):
		pan(d)
	elif _buttons.has(1):
		if d.y > 0.0:
			_dolly_out(_zoom_scale(d.y))
		elif d.y < 0.0:
			_dolly_in(_zoom_scale(d.y))


## A wheel of `dy` px (positive scrolls down, zooming out) with the cursor at `at`: zooms toward
## the cursor. Each wheel event starts a gesture, so it picks its pivot first.
func wheel(dy: float, at: Vector2) -> void:
	if not enabled or dy == 0.0:
		return
	_pick_pivot()
	_zoom_cursor = at
	if dy < 0.0:
		_dolly_in(_zoom_scale(dy))
	else:
		_dolly_out(_zoom_scale(dy))


## Orbits by a pointer travel of `d` px (OrbitControls handleMouseMoveRotate).
func rotate(d: Vector2) -> void:
	_theta_delta -= TAU * d.x / viewport.y * ROTATE_SPEED
	_phi_delta -= TAU * d.y / viewport.y * ROTATE_SPEED


## Pans by a pointer travel of `d` px, sped up close in (panSpeedAt), in the screen's plane.
func pan(d: Vector2) -> void:
	var speed := pan_speed_at(free.distance_to(target))
	var distance := (free - target).length() * tan(deg_to_rad(Constants.CAMERA.fov) / 2.0)
	var b := View.new(free, target).basis()
	_pan_offset += b.x * (-2.0 * d.x * speed * distance / viewport.y)
	_pan_offset += b.y * (2.0 * d.y * speed * distance / viewport.y)


static func _zoom_scale(delta: float) -> float:
	return pow(0.95, ZOOM_SPEED * absf(delta * 0.01))


func _dolly_in(s: float) -> void:
	_scale *= s


func _dolly_out(s: float) -> void:
	_scale /= s


## The gesture's pivot, picked once as it starts, from the unclamped eye down the line OrbitControls
## orbits along; skipped while the floor clamp has pushed the eye (the line on screen differs).
func _pick_pivot() -> void:
	if Constants.CAMERA.pivotOnParts == 0 or eye().distance_to(free) > 1e-6:
		return
	var direction := (target - free).normalized()
	var hit := -1.0
	if pick_distance.is_valid():
		hit = float(pick_distance.call(free, direction))
	target = pivot_along_view(free, target, hit, max_distance(), room)


## One frame: the pending orbit, pan and zoom applied with damping, then the limits (OrbitControls
## update, wrapped as cameraControls.ts wraps it: from the unclamped eye, ending clamped).
func update(_delta: float) -> void:
	var damping := Constants.CAMERA_LIMITS.dampingFactor
	var offset := free - target
	var radius := offset.length()
	var theta := atan2(offset.x, offset.z)
	var phi := acos(clampf(offset.y / radius, -1.0, 1.0)) if radius > 0.0 else 0.0
	theta += _theta_delta * damping
	phi += _phi_delta * damping
	phi = clampf(phi, Constants.CAMERA_LIMITS.minPolarAngle, Constants.CAMERA_LIMITS.maxPolarAngle)
	phi = clampf(phi, POLAR_EPS, PI - POLAR_EPS)
	target += _pan_offset * damping
	var new_radius := clampf(radius * _scale, Constants.CAMERA_LIMITS.minDistance, max_distance())
	if _scale != 1.0 and _zoom_cursor.x >= 0.0 and radius > 0.0:
		# Toward the cursor: the point under it, on the plane through the target facing the eye,
		# stays where it is on screen as the distance scales.
		var v := View.new(free, target, Constants.CAMERA.fov, viewport)
		var direction := v.ray(_zoom_cursor)
		var normal := v.forward()
		var denom := direction.dot(normal)
		if absf(denom) > 1e-9:
			var under := free + direction * ((target - free).dot(normal) / denom)
			target = under + (target - under) * (new_radius / radius)
	var dir := Vector3(sin(phi) * sin(theta), cos(phi), sin(phi) * cos(theta))
	free = target + dir * new_radius
	_theta_delta *= 1.0 - damping
	_phi_delta *= 1.0 - damping
	_pan_offset *= 1.0 - damping
	_scale = 1.0
	_zoom_cursor = Vector2(-1, -1)
	# cameraControls.ts confine(): the target slides back along the view, the eye stays above the floor.
	target = clamp_target_along_view(target, free, room)


## Puts the camera at `eye_at` looking at `target_at` (cameraControls.ts frame).
func frame(eye_at: Vector3, target_at: Vector3) -> void:
	free = eye_at
	target = target_at
	_theta_delta = 0.0
	_phi_delta = 0.0
	_pan_offset = Vector3.ZERO
	update(0.0)
