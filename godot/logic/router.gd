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
##   pull      a part pushed into fastened seats (a dowel pressed home, a panel pressed onto its
##             dowels): dragged FASTENER.pullDistance px along their axis on screen they come
##             back to seated, and once nothing holds it the drag carries on free
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
const PULL := "pull"
const CRANK := "crank"
## A pull is judged along this much (m) of the joint's axis projected to the screen.
const PULL_AXIS_PROBE := 0.05


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
	## No pose held yet: the first move puts the part where the finger says, offer or not.
	var has_held := false
	## What rides along: the part, where it was when the drag began, every rider with its pose then.
	var carry := Play.Carry.new()
	## A pull: where the pointer went down, and each joint pulled with its axis on screen.
	var start_screen: Vector2
	var pulls: Array[Bonds.Joint] = []
	var pull_axes: Array[Vector2] = []
	## A crank: the sweep so far.
	var crank: Crank = null


## A press on a turn's grip not yet a drag: how long it has been held still (ms), and whether it has
## been held past a tap and so drives.
class Press:
	var grip: String
	var ms := 0.0
	var held := false


var play: Play
var gesture := Gesture.new()
var camera: OrbitCamera
var drag: Drag = null
var lift := Lift.new()
## The part tapped last, if any (the gizmo's, once there is one; the lift line's).
var selected := ""
var shift := false
## Each seated tool's pose in the frame of the hardware it sits on, so it turns along (toolGrips).
var tool_grips: Dictionary[String, Transform3D] = {}
## A still press on a seated tool, maybe a hold-to-drive.
var press_on: Press = null
## Grip id → whether its turn was home last frame, and → ms of home flash left on its dial.
var _dialed: Dictionary[String, bool] = {}
var _dial_flashes: Dictionary[String, float] = {}


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
	press_on = null
	if gesture.owner == Gesture.DRAG_PART and not hit.is_empty():
		var turn := play.bonds.turn_of(String(hit["id"]))
		if turn != null and not turn.joints.is_empty():
			press_on = Press.new()
			press_on.grip = String(hit["id"])


func motion(at: Vector2) -> void:
	_apply(gesture.move(0, at.x, at.y))
	camera.motion(at)


func release(button: int, at: Vector2, t: int) -> void:
	camera.release(button)
	var effect := gesture.up(0, at.x, at.y, t)
	# A press held past a tap drove its turn: letting go is never a tap, so a tool stays on.
	var held := press_on != null and press_on.held
	press_on = null
	if not (held and effect != null and effect.type == Gesture.TAP):
		_apply(effect)
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
	_drive_held(delta)
	if drag != null and drag.mode == MOVE:
		_aim_hardware(delta)
		_aim_panel(_panel_goal(), delta)
		_assist(delta)
	_follow_tools()
	_flash_dials(delta)


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
	var picked := hit.part if hit != null else ""
	# A press on a dial's band is its tool's crank, but never over a part with a turn of its own
	# (dialUnder).
	if picked == "" or play.bonds.turn_of(picked) == null:
		var all := dials()
		var n := Crank.pick_dial(at, all)
		if n >= 0:
			return {"kind": "part", "id": all[n]["grip"], "point": Vector3.ZERO, "dial": true}
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
	for id: String in drag.carry.riders:
		out[id] = true
	return out


## What the elevation line holds up outside this drag: none of it is a seat (heldUp).
func held_up() -> Dictionary[String, bool]:
	if not lift.is_holding() or (drag != null and drag.part == lift.part):
		var none: Dictionary[String, bool] = {}
		return none
	return play.bonds.compound(lift.part, false)


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
			if id != "" and bool(effect.hit.get("dial", false)):
				_begin_crank(id, Vector2(effect.x, effect.y))
			elif id != "" and play.can_drag(id):
				_begin_drag(id, effect.hit["point"], Vector2(effect.x, effect.y))
		Gesture.DRAG_MOVE:
			if drag != null and drag.mode == CRANK:
				_crank_to(Vector2(effect.x, effect.y))
			elif drag != null and drag.mode == PULL:
				_pull_to(Vector2(effect.x, effect.y))
			elif drag != null:
				_update_drag(Vector2(effect.x, effect.y))
		Gesture.LIFT:
			if drag != null and (drag.mode == MOVE or drag.mode == COMPOUND):
				_lift_drag(effect.dy, Constants.GESTURE.desktopLiftRate)
		Gesture.DRAG_END:
			if drag != null:
				_end_drag()
		Gesture.DRAG_CANCEL:
			if drag != null:
				_cancel_drag()


## A tap: a seated tool comes off (the escape for a tool put on by mistake); else the part's
## fasteners go home; else it is selected (tapPart).
func _tap(id: String) -> void:
	var turn := play.bonds.turn_of(id)
	if turn != null:
		_take_off(turn.tool)
		return
	var pressed := play.tap(id)
	if pressed.is_empty():
		selected = id


# --- drags --------------------------------------------------------------------------------


## The web's beginDrag: crank, pull, carry, move or compound (above).
func _begin_drag(id: String, point: Vector3, at: Vector2) -> void:
	var turn := play.bonds.turn_of(id)
	if turn != null and not turn.joints.is_empty():
		_begin_crank(id, at)
		return
	if not play.bonds.pullable(id).is_empty():
		_begin_pull(id, at)
		return
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
		for joint: Bonds.Joint in play.bonds.joints_of(m):
			if joint.kind == Fastener.TOOL:
				return out
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
	drag.carry.part = id
	drag.carry.start = pose
	for r: String in riders:
		drag.carry.riders[r] = play.bonds.poses[r]
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
	_refresh_offer(target)
	# With a seat on offer the part is where seat assist has it; else exactly where the finger puts it.
	if drag.snapped != null and drag.has_held:
		return
	_hold(Transform3D(drag.rotation, target))


## The seat on offer with the part at `target` (refreshOffer); a compound looks for none.
func _refresh_offer(target: Vector3) -> void:
	drag.snapped = play.snap_candidate(drag.carry, Transform3D(drag.rotation, target), drag.snapped, held_up()) if drag.mode == MOVE else null


## The part (and what rides with it) held at `pose`.
func _hold(pose: Transform3D) -> void:
	drag.held = pose
	drag.has_held = true
	play.bonds.poses[drag.part] = pose
	for r: String in drag.carry.riders:
		play.bonds.poses[r] = drag.carry.pose_of(r, pose)


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


# --- pull: a part pushed into fastened seats comes back out along their axis ---


## The pull's fields (beginPull): each pullable joint's axis on screen, out of the hole for
## hardware, off the fastener for a panel pushed onto it.
func _begin_pull(id: String, at: Vector2) -> void:
	drag = Drag.new()
	drag.mode = PULL
	drag.part = id
	drag.start_screen = at
	drag.pointer = at
	for joint: Bonds.Joint in play.bonds.pullable(id):
		var other := joint.host != id
		var c := play.bonds.world_connector(joint.host if other else joint.hardware, joint.host_connector if other else joint.hardware_connector)
		var from := screen_of(c.position)
		var to := screen_of(c.position + c.axis * PULL_AXIS_PROBE)
		drag.pulls.append(joint)
		drag.pull_axes.append(to - from)


## The pull is judged on the pointer; past FASTENER.pullDistance along a joint's axis it comes back
## to seated, and once nothing holds the part the drag carries on free (pullTo, continueFree).
func _pull_to(at: Vector2) -> void:
	drag.pointer = at
	var pulled := false
	for n: int in range(drag.pulls.size() - 1, -1, -1):
		if DragMath.pull_along(drag.start_screen, at, drag.pull_axes[n]) >= Constants.FASTENER.pullDistance and play.bonds.apply(drag.pulls[n], Fastener.PULL):
			drag.pulls.remove_at(n)
			drag.pull_axes.remove_at(n)
			pulled = true
	if pulled:
		_continue_free(drag.part, at)


## A part let off its seats by a pull carries on from the pointer as a normal drag: a panel with
## what it carries, else the part alone; still pushed home somewhere, the pull goes on.
func _continue_free(id: String, at: Vector2) -> void:
	var carried_parts: Array[String] = []
	if play.bonds.pullable(id).is_empty():
		carried_parts = _carry_of(id)
	var free := not carried_parts.is_empty() or play.bonds.can_release(id)
	if not free:
		return
	var pose := play.bonds.poses[id]
	var v := view()
	var grab: Variant = DragMath.intersect_drag_plane(v.eye, v.ray(at), pose.origin.y)
	var point: Vector3 = grab if grab != null else pose.origin
	drag = null
	if not carried_parts.is_empty():
		_take_up(id, carried_parts)
		_begin_move(id, point, at, MOVE, carried_parts)
	else:
		for joint: Bonds.Joint in play.bonds.joints_of(id):
			play.bonds.unseat(joint)
		_begin_move(id, point, at, MOVE, [])


# --- crank: a drag on a seated tool turns what it sits on ---


func _begin_crank(id: String, at: Vector2) -> void:
	drag = Drag.new()
	drag.mode = CRANK
	drag.part = id
	drag.pointer = at
	drag.crank = Crank.new()
	_crank_to(at)


## The turn's centre on screen; the sweep about it, signed by which way the camera looks along the
## into-the-hole axis, turns the joints with turn left that way (crankTo).
func _crank_to(at: Vector2) -> void:
	drag.pointer = at
	var turn := play.bonds.turn_of(drag.part)
	if turn == null or turn.joints.is_empty():
		return
	var centre := turn_centre(turn)
	var delta := drag.crank.move(screen_of(centre), at)
	if delta == 0.0:
		return
	var radians := Crank.tighten_sign(turn_axis(turn), centre - view().eye) * delta
	_turn_joints(turn, Bonds.advancing(turn, 1 if radians > 0.0 else -1), radians)


## Where a turn turns: the head its tool sits on (centreOf).
func turn_centre(turn: Bonds.Turn) -> Vector3:
	return play.bonds.world_connector(turn.part, turn.connector).position


## Which way a turn tightens, in the world: clockwise seen along this (axisOf).
func turn_axis(turn: Bonds.Turn) -> Vector3:
	return play.bonds.world_connector(turn.part, turn.connector).axis * float(turn.sense)


## Joints turned by `radians` (positive tightens), a cam told what bolt it would catch; a tool that
## took its fastener home comes off, and one that backed it all the way out comes off with it
## (turnJoints, dropToolAfter). True if anything turned.
func _turn_joints(turn: Bonds.Turn, joints: Array[Bonds.Joint], radians: float) -> bool:
	var turned := false
	for joint: Bonds.Joint in joints:
		var before := joint.fastener
		if not play.bonds.apply(joint, Fastener.CRANK, radians, play.captured_for(joint)):
			continue
		turned = true
		var after := joint.fastener
		if not Fastener.is_home(before) and Fastener.is_home(after) and Crank.is_turn_home(turn):
			_take_off(turn.tool)
		elif Fastener.is_fastened(before) and not Fastener.is_fastened(after) and after.progress == 0.0:
			play.bonds.unseat(joint)
			_take_off(turn.tool)
	if turned:
		play.turn_pages()
	return turned


## A tool off what it sits on: its seat goes, and it drops.
func _take_off(tool: Bonds.Joint) -> void:
	if not play.bonds.joints.has(tool):
		return
	play.bonds.unseat(tool)
	tool_grips.erase(tool.hardware)
	if drag != null and drag.part == tool.hardware and drag.mode == CRANK:
		drag = null
	var members: Dictionary[String, bool] = {tool.hardware: true}
	_drop(members)


## Hold-to-drive: a press on a turn's grip held still past a tap drives it home in
## FASTENER.driveSeconds, tightening only (driveHeld).
func _drive_held(delta: float) -> void:
	if press_on == null:
		return
	if gesture.phase() != "pending":
		press_on = null
		return
	press_on.ms += delta * 1000.0
	if press_on.ms <= Constants.GESTURE.tapMaxMs:
		return
	press_on.held = true
	var turn := play.bonds.turn_of(press_on.grip)
	if turn == null:
		return
	var joints := Bonds.advancing(turn, 1)
	if not joints.is_empty():
		_turn_joints(turn, joints, Crank.drive_radians(Fastener.span_of(joints[0].kind), Constants.FASTENER.driveSeconds, delta))


## A seated tool goes where what it sits on goes (toolGrips).
func _follow_tools() -> void:
	for tool: String in tool_grips:
		var turn := play.bonds.turn_of(tool)
		if turn != null:
			play.bonds.poses[tool] = Bonds.orthonormal(play.bonds.poses[turn.part] * tool_grips[tool])


## Where a part is drawn: its pose, turned about its head by how far its turn has gone (a bolt
## twisting in, its wrench with it); the poses carry no twist (drawTurned).
func drawn(id: String) -> Transform3D:
	var pose := play.bonds.poses[id]
	var host := id
	if tool_grips.has(id):
		var turn := play.bonds.turn_of(id)
		if turn != null:
			host = turn.part
	var twist := _twist_of(host)
	if host != id:
		return Bonds.orthonormal(twist * play.bonds.poses[host] * tool_grips[id])
	return Bonds.orthonormal(twist * pose)


## The world turn a part's crank joint has drawn on it: about its head's line, progress × span.
func _twist_of(id: String) -> Transform3D:
	for joint: Bonds.Joint in play.bonds.joints:
		if joint.hardware != id or not Fastener.is_crank_kind(joint.kind):
			continue
		var connectors := play.data.type_of(play.data.instance(id)).connectors
		for i: int in connectors.size():
			if Tools.is_tool_target(connectors[i].type):
				var head := play.bonds.world_connector(id, i)
				var angle := joint.fastener.progress * Fastener.span_of(joint.kind)
				var turn := Basis(-head.axis, angle)
				return Transform3D(turn, head.position - turn * head.position)
	return Transform3D.IDENTITY


# --- the turn ring: a dial round what each seated tool turns ---


## Every dial to draw: one per seated tool with something to turn, round its head on screen, its arc
## at the turn's progress, flashing as it goes home. (The web draws a tool's dial beside its detail
## inset; with no inset here it sits round the head.)
func dials() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for turn: Bonds.Turn in play.bonds.turns():
		if turn.joints.is_empty():
			continue
		var centre := turn_centre(turn)
		out.append({
			"grip": turn.tool.hardware,
			"centre": screen_of(centre),
			"progress": Crank.turn_progress(turn),
			"clockwise": Crank.tightens_clockwise(turn_axis(turn), centre - view().eye),
			"flashing": _dial_flashes.has(turn.tool.hardware),
			"stalled": Crank.is_turn_stalled(turn),
			"home": Crank.is_turn_home(turn),
		})
	return out


func _flash_dials(delta: float) -> void:
	var seen: Dictionary[String, bool] = {}
	for turn: Bonds.Turn in play.bonds.turns():
		if turn.joints.is_empty():
			continue
		var id := turn.tool.hardware
		var home := Crank.is_turn_home(turn)
		if home and _dialed.get(id, true) == false:
			_dial_flashes[id] = Constants.TURN_RING.flashMs
		elif not home:
			_dial_flashes.erase(id)
		seen[id] = home
	for id: String in _dial_flashes.keys():
		var left := _dial_flashes[id] - delta * 1000.0
		if not seen.has(id) or left <= 0.0:
			_dial_flashes.erase(id)
		else:
			_dial_flashes[id] = left
	_dialed = seen


## Lets go: on the seat on offer it seats; else it comes down.
func _end_drag() -> void:
	if drag.mode == CRANK:
		drag = null
		return
	if drag.mode == PULL:
		drag = null
		play.turn_pages()
		return
	var id := drag.part
	var offer := drag.snapped
	if offer != null:
		offer = play.settled(drag.carry, drag.held, offer, held_up())
	var members := carried()
	var lifted := lift.is_holding() and lift.part == id
	if offer != null:
		if lifted:
			lift.end()
		_hold(offer.pose)
		drag = null
		for joint: Bonds.Joint in play.seat(offer, members):
			if joint.kind == Fastener.TOOL:
				tool_grips[joint.hardware] = play.bonds.relative_pose(joint.host, joint.hardware)
		play.turn_pages()
		return
	drag = null
	if not lifted:
		_drop(members)
	play.turn_pages()


func _cancel_drag() -> void:
	if drag.mode == PULL or drag.mode == CRANK:
		drag = null
		return
	var members := carried()
	drag = null
	_drop(members)


## Let go of: down onto what is under it (no physics yet).
func _drop(members: Dictionary[String, bool]) -> void:
	play.settle(members)


# --- the feel rules (update) --------------------------------------------------------------


## One fastener end of the carried part and the seats that take it (CarriedEnd).
class End:
	var index: int
	var connector: ItemData.Connector
	var seats: Array[Snap.WorldConnector] = []


## The carried hardware's fastener ends, each with its seats, or none for a panel or a part with no
## ends (carriedEnds).
func _carried_ends() -> Array[End]:
	var out: Array[End] = []
	if play.is_panel(drag.part) or not drag.has_held:
		return out
	var connectors := play.data.type_of(play.data.instance(drag.part)).connectors
	var seats := play.seats_for(drag.carry, held_up())
	for i: int in connectors.size():
		var c := connectors[i]
		if not play.data.compatible.has(c.type) or play.bonds.is_taken(drag.part, i):
			continue
		var end := End.new()
		end.index = i
		end.connector = c
		for seat: Snap.WorldConnector in seats:
			if not Snap.are_compatible(c.type, seat.type, play.data.compatible):
				continue
			if play.gating and not play.allows(Snap.in_world(c.type, c.position, c.axis, drag.held, drag.part, i), seat):
				continue
			end.seats.append(seat)
		out.append(end)
	return out


## Self-aim (aimHardware): carried hardware whose end nears a seat turns that end into it, harder
## the nearer, about the end; once a seat is in the snap window, the offer is looked for.
func _aim_hardware(delta: float) -> void:
	if drag.snapped != null:
		return
	var ends := _carried_ends()
	if ends.is_empty():
		return
	var tool := false
	for end: End in ends:
		if Tools.is_tool_tip(end.connector.type):
			tool = true
	var zone := Constants.AIM.toolZone if tool else Constants.AIM.zone
	var rate := Constants.AIM.toolRate if tool else Constants.AIM.rate
	# Of the ends, the one whose nearest seat needs the least turn (aimEnd).
	var best_end: End = null
	var best_target: Snap.WorldConnector = null
	var best_turn := INF
	for end: End in ends:
		var tip := drag.held * end.connector.position
		var target := Assist.nearest_target(tip, end.seats, zone)
		if target == null:
			continue
		var turn := Assist.aim_angle(drag.rotation, end.connector.axis, target.axis)
		if turn < best_turn:
			best_turn = turn
			best_end = end
			best_target = target
	if best_end == null or best_turn < Constants.AIM.settled:
		return
	var distance := best_target.position.distance_to(drag.held * best_end.connector.position)
	var aimed := Assist.aimed_rotation(drag.rotation, best_end.connector.axis, best_target.axis)
	var rotation := Assist.aim_step(drag.rotation, aimed, Assist.aim_weight(distance, zone), rate, delta)
	var position := _turn_about(best_end, rotation)
	_hold(Transform3D(rotation, position))
	for end: End in ends:
		var from := Snap.in_world(end.connector.type, end.connector.position, end.connector.axis, drag.held, drag.part, end.index)
		if Snap.find_snap(Play._one(from), end.seats, Constants.SNAP.maxDistance, Constants.SNAP.maxAngle, play.data.compatible) != null:
			_refresh_offer(position)
			return


## The carried part turned to `rotation` about `end`, so aiming never swings the end off its seat:
## the turned footprint kept inside the room, the grab and the height rebased, the line moved with
## it (turnAbout). Returns the new position.
func _turn_about(end: End, rotation: Basis) -> Vector3:
	var tip := drag.held * end.connector.position
	var local := rotation * end.connector.position
	var half := DragMath.rotated_half_extents(play.data.type_of(play.data.instance(drag.part)).size / 2.0, rotation)
	drag.half = Vector2(half.x, half.z)
	drag.half_height = half.y
	var c := drag.centre
	var b := DragMath.clamp_to_room(Vector3(tip.x - local.x + c.x, 0.0, tip.z - local.z + c.z), drag.half, DragMath.room(), Constants.GESTURE.wallMargin)
	var y := DragMath.clamp_lift(tip.y - local.y + c.y, half.y, Constants.ROOM.height, Constants.GESTURE.ceilingMargin) - c.y
	if lift.is_holding() and lift.part == drag.part:
		var goal := lift.goal + y - lift.height
		lift.jump(y)
		y = lift.height
		lift.target(goal)
	var position := Vector3(b.x - c.x, y, b.z - c.z)
	drag.offset += Vector2(position.x - drag.held.origin.x, position.z - drag.held.origin.z)
	drag.height = y
	drag.rotation = rotation
	return position


## Where a carried panel goes near it: the pose, how far, and the free ends there (PanelGoal).
class Goal:
	var pose: Transform3D
	var distance: float
	var ends: Array[Snap.WorldConnector] = []
	var turn: float


## The carried panel's nearest place where it goes inside PANEL.zone with a free end there for it
## to go on, the lesser turn of two as near; null for anything but a carried panel (panelGoal).
func _panel_goal() -> Goal:
	if not play.is_panel(drag.part) or not drag.has_held:
		return null
	var seats := play.seats_for(drag.carry, held_up())
	var best: Goal = null
	for pose: Transform3D in play.preferred_for(drag.carry):
		var distance := pose.origin.distance_to(drag.held.origin)
		if distance >= Constants.PANEL.zone or (best != null and distance > best.distance + Constants.PANEL.matchTolerance):
			continue
		var turn := drag.held.basis.get_rotation_quaternion().angle_to(pose.basis.get_rotation_quaternion())
		if best != null and distance >= best.distance - Constants.PANEL.matchTolerance and turn >= best.turn:
			continue
		var ends := FitRank.preferred_targets(play.carried_connectors(drag.carry, pose), seats, play.data.compatible)
		if not ends.is_empty():
			best = Goal.new()
			best.pose = pose
			best.distance = distance
			best.ends = ends
			best.turn = turn
	return best


## Panel magnetism (aimPanel): near where it goes, with no fit there on offer, the panel turns
## toward it, harder the nearer; the finger keeps the position (a turn into the floor lifts it).
func _aim_panel(goal: Goal, delta: float) -> void:
	if goal == null or (drag.snapped != null and drag.snapped.preferred):
		return
	var rotation := Assist.aim_step(drag.rotation, goal.pose.basis, Assist.aim_weight(goal.distance, Constants.PANEL.zone), Constants.PANEL.rate, delta)
	_clamp_carried(rotation)
	drag.rotation = rotation
	if drag.snapped != null:
		_refresh_offer(drag.finger)
		return
	var lifted := DragMath.clamp_lift(drag.height + drag.centre.y, drag.half_height, Constants.ROOM.height, Constants.GESTURE.ceilingMargin) - drag.centre.y
	if lifted != drag.height:
		_lift_drag(0.0, 0.0)
		if drag.snapped == null:
			return
		_hold(Transform3D(rotation, Vector3(drag.held.origin.x, drag.height, drag.held.origin.z)))
		return
	_hold(Transform3D(rotation, drag.held.origin))
	var carried_now := play.carried_connectors(drag.carry, drag.held)
	for c: Snap.WorldConnector in carried_now:
		if Snap.find_snap(Play._one(c), goal.ends, Constants.PANEL.maxDistance, Constants.PANEL.maxAngle, play.data.compatible) != null:
			_refresh_offer(drag.held.origin)
			return


## The carried set's reach turned to `rotation`, kept on the drag (clampCarried, reachOf).
func _clamp_carried(rotation: Basis) -> void:
	var at := Transform3D(rotation, Vector3.ZERO)
	var lo := Vector3.ONE * INF
	var hi := -Vector3.ONE * INF
	for id: String in [drag.part] + drag.carry.riders.keys():
		var pose := drag.carry.pose_of(id, at)
		var half := DragMath.rotated_half_extents(play.data.type_of(play.data.instance(id)).size / 2.0, pose.basis)
		lo = lo.min(pose.origin - half)
		hi = hi.max(pose.origin + half)
	drag.centre = (lo + hi) / 2.0
	var half_all := (hi - lo) / 2.0
	drag.half = Vector2(half_all.x, half_all.z)
	drag.half_height = half_all.y


## Seat assist: only while a seat is on offer, the held part glides toward it.
func _assist(delta: float) -> void:
	if drag.snapped == null or not drag.has_held:
		return
	_hold(DragMath.ease_toward(drag.held, drag.snapped.pose, Constants.SNAP.assistStrength, delta))


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
