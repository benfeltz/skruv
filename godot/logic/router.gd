class_name Router
extends RefCounted
## The gesture router: pointer events in, camera versus part decided, the build played. The port
## of src/scene/gestureRouter.ts's flow, kept in logic/ so the headless hand plays the very
## gestures a mouse does. Pure: viewport px and ms in, poses out (Play's); the scene forwards the
## mouse and draws.
##
## The camera is reached only through OrbitCamera's enable()/disable() seam, mirrored from
## Gesture.camera_enabled() after every event, so a press on no part leaves the camera as it was
## and every end hands it back. A right or middle press is always the camera's.
##
## A press on a part (Pick: the boxes, small parts' proxies, preferHit) that moves past the tap
## distance is a drag, decided as the web's beginDrag decides it:
##   carry     a panel with an assembly or seated hardware: it leaves whatever else it sat on, the
##             rest rides along rigidly, and it looks for a seat
##   move      a part nothing holds: it leaves what it was seated on (drag-away unseat) and looks
##             for a seat
##   compound  a part bonded into a compound: it all comes along, looking for nothing
## A drag rides `hoverLift` above where it was, on a level plane through the grab point; the wheel
## lifts it (GESTURE.desktopLiftRate a px), and Shift + scroll is the elevation line's lift: the
## part stays up at the line's height while Shift is held, with or without a drag. Let go on the
## seat on offer, it seats; else it comes down (Play.settle: no physics yet).

const LEFT := 0
const MIDDLE := 1
const RIGHT := 2

const MOVE := "move"
const COMPOUND := "compound"


## The drag in progress (the web's Drag, the plane drag's fields).
class Drag:
	var mode: String
	var part: String
	var plane_y: float
	var height: float
	var offset: Vector2
	var half: Vector2
	var half_height: float
	var centre: Vector3
	var rotation: Basis
	## Where the part is held now.
	var held: Transform3D
	## Where the finger puts it.
	var finger: Vector3
	var pointer: Vector2
	var snapped: Play.Offer = null
	## Every other part that rides along, each with where it was when the drag began, and where
	## the dragged part was then.
	var start: Transform3D
	var riders: Dictionary[String, Transform3D] = {}


var play: Play
var gesture := Gesture.new()
var camera: OrbitCamera
var drag: Drag = null
var lift := Lift.new()
## The part tapped last, if any (the gizmo's, once there is one; the lift line's).
var selected := ""
var shift := false


func _init(p: Play, orbit: OrbitCamera = null) -> void:
	play = p
	camera = orbit if orbit != null else OrbitCamera.new()
	camera.pick_distance = func(origin: Vector3, direction: Vector3) -> float: return Pick.first_distance(origin, direction, boxes())


# --- pointer events ---------------------------------------------------------------------


## A button down at `at` (LEFT, MIDDLE, RIGHT) at `t` ms, on whatever `hit` says, or picked.
func press(button: int, at: Vector2, t: int, hit: Dictionary = {}) -> void:
	if gesture.owner == "" and button == LEFT and hit.is_empty():
		hit = hit_at(at)
	_apply(gesture.down(0, at.x, at.y, t, hit, button))
	_sync_camera()
	camera.press(button, at)


func motion(at: Vector2) -> void:
	_apply(gesture.move(0, at.x, at.y))
	camera.motion(at)


func release(button: int, at: Vector2, t: int) -> void:
	camera.release(button)
	_apply(gesture.up(0, at.x, at.y, t))
	_sync_camera()


## A wheel of `dy` px (positive scrolls down). With Shift, the elevation line's lift; mid-drag, the
## drag's lift; else the camera's zoom.
func wheel(dy: float, at: Vector2, dx: float = 0.0) -> void:
	var line := Lift.shift_scroll(dx, dy, shift)
	if not is_nan(line) and _hold_target() != "":
		_lift_held(line)
		return
	var effect := gesture.wheel(dy)
	if effect != null:
		_apply(effect)
	elif gesture.camera_enabled():
		camera.wheel(dy, at)


## Shift down or up: down, the elevation line takes the dragged or selected part up where it is;
## up, it lets go and the part comes down.
func set_shift(down: bool) -> void:
	if down == shift:
		return
	shift = down
	if down:
		var id := _hold_target()
		if id != "":
			_begin_hold(id)
	elif lift.is_holding():
		var id := lift.part
		lift.end()
		if drag == null or drag.part != id:
			_drop(play.bonds.compound(id, false))


## Focus lost: whatever is live is abandoned, the camera handed back.
func interrupted() -> void:
	_apply(gesture.cancel_all())
	_sync_camera()


## One frame after the events: the lift line eases, the drag aims toward its seat.
func update(delta: float) -> void:
	camera.update(delta)
	if lift.is_holding():
		lift.update(delta)
		if drag != null and drag.part == lift.part:
			if lift.height != drag.height:
				_raise(lift.height)
		else:
			_hold_at(lift.part, lift.height)
	if drag != null and drag.mode == MOVE:
		var aimed := play.aim(drag.part, drag.held, delta)
		if not aimed.is_equal_approx(drag.held):
			drag.rotation = aimed.basis
			_hold(aimed)
		drag.snapped = play.offer_for(drag.part, drag.held)


# --- what the scene and the hand read ---------------------------------------------------


func view() -> OrbitCamera.View:
	return camera.view()


## Every part in the room as a box the pointer can hit.
func boxes() -> Array[Pick.Box]:
	var out: Array[Pick.Box] = []
	for id: String in play.bonds.poses:
		out.append(Pick.Box.new(id, play.bonds.poses[id], play.data.type_of(play.data.instance(id)).size))
	return out


## What a press at `at` hits, as a gesture hit {kind, id, point}, or {} for empty space.
func hit_at(at: Vector2) -> Dictionary:
	var v := view()
	var hit := Pick.pick(v.eye, v.ray(at), boxes())
	if hit == null:
		return {}
	return {"kind": "part", "id": hit.part, "point": hit.point}


## A world point on screen.
func screen_of(point: Vector3) -> Vector2:
	return view().project(point)


## A screen point a press on `id` picks it at, or (-1, -1): its centre, else points over its box.
func point_on(id: String) -> Vector2:
	var pose := play.bonds.poses[id]
	var half := play.data.type_of(play.data.instance(id)).size / 2.0
	var candidates: Array[Vector3] = [pose.origin]
	for fx: float in [-0.6, 0.0, 0.6]:
		for fy: float in [-0.6, 0.0, 0.6]:
			for fz: float in [-0.6, 0.0, 0.6]:
				candidates.append(pose * Vector3(half.x * fx, half.y * fy, half.z * fz))
	for p: Vector3 in candidates:
		var at := screen_of(p)
		if String(hit_at(at).get("id", "")) == id:
			return at
	return Vector2(-1, -1)


## Where the pointer goes for the drag to hold its part at `target`'s x, z (the drag plane's
## inverse; the room clamp aside).
func screen_for(target: Vector3) -> Vector2:
	return screen_of(Vector3(target.x - drag.offset.x, drag.plane_y, target.z - drag.offset.y))


## The parts the drag carries, the dragged one included.
func carried() -> Dictionary[String, bool]:
	var out: Dictionary[String, bool] = {}
	if drag == null:
		return out
	out[drag.part] = true
	for id: String in drag.riders:
		out[id] = true
	return out


# --- the gesture machine's effects --------------------------------------------------------


func _apply(effect: Gesture.Effect) -> void:
	if effect == null:
		return
	var id := String(effect.hit.get("id", ""))
	match effect.type:
		Gesture.TAP:
			if id == "":
				selected = ""
			elif Lift.selects_during_hold(id, lift.part):
				_tap(id)
		Gesture.DRAG_START:
			if id != "" and play.can_drag(id):
				_begin_drag(id, effect.hit["point"], Vector2(effect.x, effect.y))
		Gesture.DRAG_MOVE:
			if drag != null:
				_update_drag(Vector2(effect.x, effect.y))
		Gesture.LIFT:
			if drag != null:
				_lift_drag(effect.dy, Constants.GESTURE.desktopLiftRate)
		Gesture.DRAG_END:
			if drag != null:
				_end_drag()
		Gesture.DRAG_CANCEL:
			if drag != null:
				_cancel_drag()


func _tap(id: String) -> void:
	var pressed := play.tap(id)
	if pressed.is_empty():
		selected = id


# --- drags --------------------------------------------------------------------------------


## The web's beginDrag: carry, move or compound (above).
func _begin_drag(id: String, point: Vector3, at: Vector2) -> void:
	var carried_parts := _carry_of(id)
	if not carried_parts.is_empty():
		_take_up(id, carried_parts)
		_begin_move(id, point, at, MOVE, carried_parts)
	elif play.bonds.can_release(id):
		# Nothing holds it: it leaves whatever it was seated on.
		for joint: Bonds.Joint in play.bonds.joints_of(id):
			play.bonds.unseat(joint)
		_begin_move(id, point, at, MOVE, [])
	else:
		var members := play.bonds.compound_of(id)
		members.erase(id)
		var riders: Array[String] = []
		riders.assign(members.keys())
		_begin_move(id, point, at, COMPOUND, riders)


## What a panel would carry: the rest of its assembly and the hardware seated only in it (carryOf,
## seatedIn); none for anything but a panel.
func _carry_of(id: String) -> Array[String]:
	var out: Array[String] = []
	if not play.is_panel(id):
		return out
	var members := play.bonds.compound_of(id)
	for m: String in members:
		if m != id:
			out.append(m)
	for m: String in members:
		for joint: Bonds.Joint in play.bonds.joints_of(m):
			if joint.host != m or joint.kind == Fastener.TOOL or members.has(joint.hardware) or out.has(joint.hardware):
				continue
			var rides := true
			for j: Bonds.Joint in play.bonds.joints_of(joint.hardware):
				if not (members.has(j.host) or (members.has(j.mover) and not Fastener.is_fastened(j.fastener))):
					rides = false
			if rides:
				out.append(joint.hardware)
	return out


## Takes a carry up off whatever it sits on outside itself: every seat between a part it carries
## and one it leaves goes (takeUp).
func _take_up(id: String, riders: Array[String]) -> void:
	var ids: Dictionary[String, bool] = {id: true}
	for r: String in riders:
		ids[r] = true
	for joint: Bonds.Joint in play.bonds.joints.duplicate():
		var touches := ids.has(joint.hardware) or ids.has(joint.host)
		if touches and not (ids.has(joint.hardware) and ids.has(joint.host)):
			play.bonds.unseat(joint)


func _begin_move(id: String, point: Vector3, at: Vector2, mode: String, riders: Array[String]) -> void:
	var pose := play.bonds.poses[id]
	var members: Dictionary[String, bool] = {id: true}
	for r: String in riders:
		members[r] = true
	var box := play.box_of_set(members)
	drag = Drag.new()
	drag.mode = mode
	drag.part = id
	drag.plane_y = point.y
	drag.height = pose.origin.y + Constants.GESTURE.hoverLift
	drag.offset = Vector2(pose.origin.x - point.x, pose.origin.z - point.z)
	drag.half = Vector2(box.size.x / 2.0, box.size.z / 2.0)
	drag.half_height = box.size.y / 2.0
	drag.centre = box.get_center() - pose.origin
	drag.rotation = pose.basis
	drag.held = pose
	drag.start = pose
	for r: String in riders:
		drag.riders[r] = play.bonds.poses[r]
	drag.pointer = at
	if lift.is_holding() and lift.part == id:
		drag.height = lift.height
	_update_drag(at)


## The finger's ray on the drag plane, clamped inside the room (updateDrag).
func _update_drag(at: Vector2) -> void:
	drag.pointer = at
	var v := view()
	var point: Variant = DragMath.intersect_drag_plane(v.eye, v.ray(at), drag.plane_y)
	if point == null:
		return
	var p: Vector3 = point
	var c := drag.centre
	var clamped := DragMath.clamp_to_room(Vector3(p.x + drag.offset.x + c.x, drag.height, p.z + drag.offset.y + c.z), drag.half, DragMath.room(), Constants.GESTURE.wallMargin)
	var target := Vector3(clamped.x - c.x, drag.height, clamped.z - c.z)
	drag.finger = target
	_hold(Transform3D(drag.rotation, target))
	if drag.mode == MOVE:
		drag.snapped = play.offer_for(drag.part, drag.held)


## The part (and what rides with it) held at `pose`.
func _hold(pose: Transform3D) -> void:
	drag.held = pose
	play.bonds.poses[drag.part] = pose
	for r: String in drag.riders:
		play.bonds.poses[r] = Bonds.carry_pose(drag.start, pose, drag.riders[r])


## The lift raises the part and its plane together, and the line with it for the part it holds
## (liftDrag).
func _lift_drag(dy: float, rate: float) -> void:
	var cy := drag.centre.y
	var h := DragMath.clamp_lift(drag.height + dy * rate + cy, drag.half_height, Constants.ROOM.height, Constants.GESTURE.ceilingMargin) - cy
	if lift.is_holding() and lift.part == drag.part:
		lift.jump(h)
		h = lift.height
	_raise(h)


## Straight up: the finger's ray meets the raised plane nearer the camera, so the grab offset is
## re-anchored there and the part's x, z stay put (raiseDrag).
func _raise(h: float) -> void:
	var plane_y := drag.plane_y + h - drag.height
	var v := view()
	var ray := v.ray(drag.pointer)
	var before: Variant = DragMath.intersect_drag_plane(v.eye, ray, drag.plane_y)
	var after: Variant = DragMath.intersect_drag_plane(v.eye, ray, plane_y)
	if before != null and after != null:
		var b: Vector3 = before
		drag.offset = DragMath.rebase_drag_offset(Vector2(b.x + drag.offset.x, b.z + drag.offset.y), after)
	drag.plane_y = plane_y
	drag.height = h
	_update_drag(drag.pointer)


## Lets go: on the seat on offer it seats; else it comes down.
func _end_drag() -> void:
	var id := drag.part
	var offer := drag.snapped
	var members := carried()
	var held_up := lift.is_holding() and lift.part == id
	drag = null
	if offer != null:
		if held_up:
			lift.end()
		play.seat(id, offer)
		play.turn_pages()
	elif not held_up:
		_drop(members)


func _cancel_drag() -> void:
	var members := carried()
	drag = null
	_drop(members)


## Let go of: down onto what is under it (no physics yet).
func _drop(members: Dictionary[String, bool]) -> void:
	play.settle(members)


# --- the elevation line (Shift held) ------------------------------------------------------


## The part Shift takes up: the one dragged, else the one selected (if it can come up whole).
func _hold_target() -> String:
	if drag != null and drag.mode == MOVE:
		return drag.part
	if lift.is_holding():
		return lift.part
	if selected != "" and play.bonds.poses.has(selected) and play.bonds.can_release(selected):
		return selected
	return ""


func _begin_hold(id: String) -> void:
	var members := play.bonds.compound(id, false)
	var box := play.box_of_set(members)
	var pose := play.bonds.poses[id]
	var at := drag.height if drag != null and drag.part == id else pose.origin.y
	lift.begin(id, at, Lift.lift_range(box.size.y / 2.0, box.get_center().y - pose.origin.y))


func _lift_held(px: float) -> void:
	if not lift.is_holding():
		_begin_hold(_hold_target())
	if drag != null and drag.part == lift.part:
		_lift_drag(px, Constants.GESTURE.desktopLiftRate)
	else:
		lift.jump(lift.height + px * Constants.GESTURE.desktopLiftRate)


## A part the line holds outside a drag: its compound at the line's height.
func _hold_at(id: String, h: float) -> void:
	var pose := play.bonds.poses[id]
	play.bonds.move_compound(id, Transform3D(pose.basis, Vector3(pose.origin.x, h, pose.origin.z)))


func _sync_camera() -> void:
	if gesture.camera_enabled():
		camera.enable()
	else:
		camera.disable()
