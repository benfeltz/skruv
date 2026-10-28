class_name Gesture
extends RefCounted
## Pointer-gesture state machine: who owns each press (the camera, a part drag, or a gizmo ring)
## and tap vs drag. The port of src/game/gestureState.ts createGestureState. Pure: it eats plain
## pointer records (viewport px, ms) the scene builds; `hit` is empty (empty space) or a
## Dictionary with a "kind" of "part" or "ring", passed through untouched.
##
## Thresholds are Constants.GESTURE's tapMaxDistance and tapMaxMs. A second pointer during a part
## gesture is the lift channel; `wheel` is the desktop stand-in. On the desktop loop only the
## mouse's one pointer and the wheel exist, but the machine is ported whole.

const CAMERA := "camera"
const DRAG_PART := "dragPart"
const GIZMO_RING := "gizmoRing"

const DRAG_START := "dragStart"
const DRAG_MOVE := "dragMove"
const DRAG_END := "dragEnd"
const DRAG_CANCEL := "dragCancel"
const TAP := "tap"
const LIFT := "lift"


## What a press, move or release hands the scene.
class Effect:
	var type: String
	var owner: String
	var hit: Dictionary
	var x: float
	var y: float
	## A lift's raise (+) or lower (−), px.
	var dy: float

	func _init(t: String, o: String, h: Dictionary, px: float = 0.0, py: float = 0.0, d: float = 0.0) -> void:
		type = t
		owner = o
		hit = h
		x = px
		y = py
		dy = d


## The pointer that started the gesture.
class Primary:
	var id: int
	var hit: Dictionary
	var start_x: float
	var start_y: float
	var start_t: int
	var dragging: bool
	var can_tap: bool


var tap_max_distance: float
var tap_max_ms: int
## "" when idle.
var owner := ""
var _primary: Primary = null
var _lift_id := -1
var _lift_y := 0.0
var _camera_pointers: Dictionary[int, bool] = {}
var _camera_multi := false


func _init(max_distance: float = Constants.GESTURE.tapMaxDistance, max_ms: int = Constants.GESTURE.tapMaxMs) -> void:
	tap_max_distance = max_distance
	tap_max_ms = max_ms


## "idle", "pending" (pressed, not yet a drag) or "dragging".
func phase() -> String:
	if _primary == null:
		return "idle" if owner == "" else "pending"
	return "dragging" if _primary.dragging else "pending"


## False only while a part or ring gesture is live: the scene mirrors it onto the camera.
func camera_enabled() -> bool:
	return owner != DRAG_PART and owner != GIZMO_RING


func down(id: int, x: float, y: float, t: int, hit: Dictionary = {}, button: int = 0) -> Effect:
	if owner == "":
		# Only the primary button picks up parts or rings; right and middle are the camera's.
		var hit_owner := ""
		if button == 0 and not hit.is_empty():
			hit_owner = DRAG_PART if hit.get("kind") == "part" else GIZMO_RING if hit.get("kind") == "ring" else ""
		owner = hit_owner if hit_owner != "" else CAMERA
		_primary = Primary.new()
		_primary.id = id
		_primary.hit = {} if owner == CAMERA else hit
		_primary.start_x = x
		_primary.start_y = y
		_primary.start_t = t
		_primary.dragging = false
		# A right or middle click is never a tap.
		_primary.can_tap = button == 0
		if owner == CAMERA:
			_camera_pointers[id] = true
		return null
	if owner == CAMERA:
		_camera_pointers[id] = true
		_camera_multi = true
	elif owner == DRAG_PART and _lift_id == -1:
		_lift_id = id
		_lift_y = y
	return null


func move(id: int, x: float, y: float) -> Effect:
	if _lift_id != -1 and id == _lift_id:
		var dy := _lift_y - y
		_lift_y = y
		return _lift_effect(dy)
	if _primary == null or id != _primary.id:
		return null
	if owner == CAMERA:
		if _moved_too_far(x, y):
			_primary.dragging = true
		return null
	if not _primary.dragging:
		if not _moved_too_far(x, y):
			return null
		_primary.dragging = true
		return Effect.new(DRAG_START, owner, _primary.hit, x, y)
	return Effect.new(DRAG_MOVE, owner, _primary.hit, x, y)


func up(id: int, x: float, y: float, t: int) -> Effect:
	if owner == CAMERA:
		if not _camera_pointers.erase(id):
			return null
		var tapped := _primary != null and id == _primary.id and not _camera_multi and not _primary.dragging and _is_tap(x, y, t)
		if _camera_pointers.is_empty():
			_reset()
		return Effect.new(TAP, "", {}, x, y) if tapped else null
	if _lift_id != -1 and id == _lift_id:
		_lift_id = -1
		return null
	if _primary == null or id != _primary.id:
		return null
	var hit := _primary.hit
	var ended_owner := owner
	var tapped := not _primary.dragging and _is_tap(x, y, t)
	var was_dragging := _primary.dragging
	_reset()
	if was_dragging:
		return Effect.new(DRAG_END, ended_owner, hit, x, y)
	return Effect.new(TAP, "", hit, x, y) if tapped else null


func cancel(id: int) -> Effect:
	if owner == CAMERA:
		if not _camera_pointers.erase(id):
			return null
		# A cancelled pointer can never complete a tap.
		_camera_multi = true
		if _camera_pointers.is_empty():
			_reset()
		return null
	if _lift_id != -1 and id == _lift_id:
		_lift_id = -1
		return null
	if _primary == null or id != _primary.id:
		return null
	return cancel_all()


## Desktop lift: wheel delta (px, positive = scroll down) while a part is dragged.
func wheel(dy: float) -> Effect:
	return _lift_effect(-dy) if owner == DRAG_PART else null


## Abandon whatever is live (focus lost).
func cancel_all() -> Effect:
	var effect: Effect = null
	if _primary != null and _primary.dragging and owner != CAMERA:
		effect = Effect.new(DRAG_CANCEL, owner, _primary.hit)
	_reset()
	return effect


func _lift_effect(dy: float) -> Effect:
	if _primary != null and _primary.dragging and dy != 0.0:
		return Effect.new(LIFT, owner, _primary.hit, 0.0, 0.0, dy)
	return null


func _moved_too_far(x: float, y: float) -> bool:
	return Vector2(x - _primary.start_x, y - _primary.start_y).length() > tap_max_distance


func _is_tap(x: float, y: float, t: int) -> bool:
	return _primary.can_tap and not _moved_too_far(x, y) and t - _primary.start_t <= tap_max_ms


func _reset() -> void:
	owner = ""
	_primary = null
	_lift_id = -1
	_camera_pointers.clear()
	_camera_multi = false
