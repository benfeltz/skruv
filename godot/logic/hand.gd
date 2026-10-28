class_name Hand
extends RefCounted
## A scripted player that builds JOHNNY through the router with screen points, as a mouse does:
## for each seat the open page still wants it frames the camera on the part, presses on it (a
## screen point that picks it), drags it past the tap distance, lifts it with the wheel to its
## seat's height, carries it to a few centimetres off its seat in a glide of pointer moves, holds
## still while self-aim, magnetism and seat assist do their work, lets go, and clicks the seat's
## mover home. The headless playthrough (test/playthrough_test.gd) and the windowed autoplay
## (scenes/loop.gd) both play through this, one frame per step(), so the film shows the moves the
## test proves.
##
## The hand knows the manual: which part goes where (Play.goal, the export's joints). Nothing it
## does reaches past the router: no pose is set, no seat is made but by letting go on an offer.

## How far off its seat the hand lets go of the pointer: a few centimetres.
const OFFSET := Vector3(0.02, 0.0, 0.015)
## Frames to glide the pointer from the pick-up to the drop, and the most to hold still there for
## a seat to be offered and taken.
const GLIDE_FRAMES := 12
const HOLD_FRAMES := 90
## A held seat is taken once the part is this close to it (m) and turned this little (rad).
const SETTLED_M := 1e-5
const SETTLED_RAD := 1e-4
## The camera the hand frames each move from: this far from what it looks at, from this direction.
const VIEW_DISTANCE := 1.4
const VIEW_DISTANCES: Array[float] = [1.4, 2.4, 3.4]
const VIEW_FROM: Array[Vector3] = [Vector3(0.0, 1.0, 1.0), Vector3(1.0, 1.0, 1.0), Vector3(-1.0, 1.0, 1.0), Vector3(1.0, 1.0, 0.0), Vector3(-1.0, 1.0, 0.0), Vector3(0.0, 1.0, -1.0)]
const FRAME_MS := 16
## How far above where it goes the hand carries a panel it lays in, before letting it come down (m).
const LAY_CLEAR := 0.02
## One pointer step round a dial (rad), and the most steps or frames a turn may take.
const CRANK_STEP := PI / 9.0
## How far out of a head along its axis the hand brings a tool's tip before letting self-aim turn it in.
const TIP_CLEAR := 0.03
## Frames between the hand's corrections of a tool it holds with no seat on offer.
const CORRECT_EVERY := 20
const CRANK_STEPS_MAX := 200
const DRIVE_FRAMES_MAX := 300
const TAP_MS := 80

var router: Router
var play: Play
## What went wrong, one line each; the playthrough asserts it empty.
var errors: PackedStringArray = []
## One line per move, for the log.
var lines: PackedStringArray = []
var seats := 0
var presses := 0
var cranks := 0
var drives := 0
var frames := 0
var t := 0
var _queue: Array[Callable] = []


func _init(r: Router) -> void:
	router = r
	play = r.play


## True once the manual has ended or the hand is stuck.
func finished() -> bool:
	return play.steps.is_done() or not errors.is_empty()


## One frame: the next action, then the router's frame. False once finished.
func step(delta: float) -> bool:
	if finished():
		return false
	frames += 1
	t += FRAME_MS
	if _queue.is_empty():
		_plan()
	if not _queue.is_empty():
		var action: Callable = _queue.pop_front()
		action.call()
	router.update(delta)
	return not finished()


## The open page's next seat to make (an export joint index), or -1.
static func next_joint(p: Play) -> int:
	var open := p.open_joints()
	return open[0] if not open.is_empty() else -1


## Which part the hand grabs for export joint `i`: the smaller side's panel (a horizontal by
## itself, dowels and all, onto the side panel), or lone hardware itself; the lib's mover's side on
## a tie.
static func carried(p: Play, i: int) -> String:
	var spec := p.data.joints[i]
	var hw := p.bonds.compound(spec.hardware, false)
	var host := p.bonds.compound(spec.host, false)
	var side := spec.hardware if hw.size() < host.size() else spec.host if host.size() < hw.size() else spec.mover
	return _panel_in(p, p.bonds.compound(side, false), side)


static func _panel_in(p: Play, members: Dictionary[String, bool], fallback: String) -> String:
	for inst: ItemData.Instance in p.data.instances:
		if members.has(inst.id) and p.is_panel(inst.id):
			return inst.id
	return fallback


## What the hand clicks once a seat is made: the seat's mover (a lone dowel itself; a panel carried
## in on its dowels, whose tap pushes all of them home).
static func tap_target(p: Play, spec: int) -> String:
	var joint := p.bonds.joint_for_spec(spec)
	return joint.mover if joint != null else ""


func _plan() -> void:
	var i := next_joint(play)
	if i < 0:
		# Every seat in: cams the page turns, still open, get their screwdriver.
		var step := play.steps.current()
		for n: int in step.turns:
			var joint := play.bonds.joint_for_spec(n)
			if joint != null and joint.fastener.state != Fastener.LOCKED:
				_plan_tool(joint.hardware)
				return
	var laid := play.unplaced()
	if i < 0 and not laid.is_empty():
		var id: String = laid.keys()[0]
		_plan_place(id, laid[id])
		return
	if i < 0:
		# Every seat in; whatever is still only seated gets clicked home.
		for joint: Bonds.Joint in play.bonds.joints:
			if Fastener.is_tap_kind(joint.kind) and not Fastener.is_fastened(joint.fastener):
				_plan_tap(joint.mover)
				return
		errors.append("page %d open with nothing left to do" % play.steps.current().number)
		return
	var id := carried(play, i)
	_plan_carry(id, i)


func _fail(message: String) -> void:
	errors.append(message)
	_queue.clear()


## Frames the camera on `point` from the first direction (and distance) that lets a press pick `id`
## and shows `also` on screen (where the part is going); returns the press's screen point, or
## (-1, -1).
func _look_at(id: String, point: Vector3, also: Vector3 = point) -> Vector2:
	for distance: float in VIEW_DISTANCES:
		for from: Vector3 in VIEW_FROM:
			router.camera.frame(point + from.normalized() * distance, point)
			if not _on_screen(also):
				continue
			var at := router.point_on(id)
			if at.x >= 0.0:
				return at
	return Vector2(-1, -1)


func _on_screen(p: Vector3) -> bool:
	var v := router.view()
	if (p - v.eye).dot(v.forward()) <= 0.0:
		return false
	var s := v.project(p)
	return s.x >= 0.0 and s.y >= 0.0 and s.x <= v.size.x and s.y <= v.size.y


func _plan_carry(id: String, i: int) -> void:
	var page := play.steps.current().number
	var goal: Variant = play.goal(id, i)
	if goal == null:
		_fail("page %d: no goal for %s at joint %d" % [page, id, i])
		return
	var seat: Transform3D = goal
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO, "frame": 0}
	_queue.append(func() -> void:
		var at := _look_at(id, play.bonds.poses[id].origin.lerp(seat.origin, 0.5), seat.origin)
		if at.x < 0.0:
			_fail("page %d: no screen point picks %s" % [page, id])
			return
		state["at"] = at
		router.press(Router.LEFT, at, t))
	_queue.append(func() -> void:
		var at: Vector2 = state["at"] + Vector2(Constants.GESTURE.tapMaxDistance + 2.0, 0.0)
		router.motion(at)
		if router.drag == null or router.drag.part != id or router.drag.mode != Router.MOVE:
			_fail("page %d: pressing %s began no carry (%s)" % [page, id, "none" if router.drag == null else router.drag.mode])
			return
		state["from"] = at
		state["to"] = router.screen_for(seat.origin + OFFSET))
	_glide(state)
	# Over the seat, up (or down) to its height with the wheel; the lift keeps x and z.
	_queue.append(func() -> void:
		if router.drag != null:
			router.wheel(-(seat.origin.y - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer))
	_queue.append(func() -> void: _hold_for_seat(id, i, page, 0))


## Lays a panel in where it goes (a shelf on its pins): lifted clear, carried over its place, let go;
## it comes down onto what it rests on.
func _plan_place(id: String, place: Transform3D) -> void:
	var page := play.steps.current().number
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO}
	_queue.append(func() -> void:
		var at := _look_at(id, play.bonds.poses[id].origin.lerp(place.origin, 0.5), place.origin)
		if at.x < 0.0:
			_fail("page %d: no screen point picks %s" % [page, id])
			return
		state["at"] = at
		router.press(Router.LEFT, at, t))
	_queue.append(func() -> void:
		var at: Vector2 = state["at"] + Vector2(Constants.GESTURE.tapMaxDistance + 2.0, 0.0)
		router.motion(at)
		if router.drag == null or router.drag.part != id:
			_fail("page %d: pressing %s began no carry" % [page, id])
			return
		state["from"] = at
		state["to"] = router.screen_for(place.origin))
	_glide(state)
	_queue.append(func() -> void:
		if router.drag != null:
			router.wheel(-(place.origin.y + LAY_CLEAR - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer))
	_queue.append(func() -> void:
		if router.drag == null:
			_fail("page %d: the drag of %s ended by itself" % [page, id])
			return
		router.release(Router.LEFT, router.drag.pointer, t)
		if not play.is_placed(id):
			_fail("page %d: %s let go at %s is not where it goes (%s)" % [page, id, play.bonds.poses[id].origin, place.origin])
			return
		lines.append("page %d: %s laid in" % [page, id]))


## Holds still until a seat is on offer and the part has glided into it, then lets go.
func _hold_for_seat(id: String, i: int, page: int, held: int) -> void:
	if router.drag == null:
		_fail("page %d: the drag of %s ended by itself" % [page, id])
		return
	var offer := router.drag.snapped
	var in_seat := offer != null and router.drag.held.origin.distance_to(offer.pose.origin) < SETTLED_M and router.drag.held.basis.get_rotation_quaternion().angle_to(offer.pose.basis.get_rotation_quaternion()) < SETTLED_RAD
	if not in_seat and held < HOLD_FRAMES:
		_queue.push_front(func() -> void: _hold_for_seat(id, i, page, held + 1))
		return
	if offer == null:
		_fail("page %d: no seat offered for %s at joint %d (held %s, seat %s)" % [page, id, i, router.drag.held.origin, play.goal(id, i)])
		router.release(Router.LEFT, router.drag.pointer, t)
		return
	var pairs := offer.pairs.size()
	router.release(Router.LEFT, router.drag.pointer, t)
	var joint := play.bonds.joint_for_spec(i)
	if joint == null:
		_fail("page %d: letting go of %s seated %d pairs, not joint %d" % [page, id, pairs, i])
		return
	seats += pairs
	lines.append("page %d: %s seated, %d pairs" % [page, id, pairs])
	if Fastener.is_tap_kind(joint.kind):
		_plan_tap(joint.mover)
	elif joint.kind == Fastener.BOLT:
		_plan_tool(joint.hardware)


## The page's tool onto `hardware`'s head or slot, then turned home: a wrench by circling its dial,
## a screwdriver by holding still (hold-to-drive); it comes off by itself at home.
func _plan_tool(hardware: String) -> void:
	var step := play.steps.current()
	var page := step.number
	var tools := play.tools_of(step)
	if tools.is_empty():
		_fail("page %d: no %s in the box for %s" % [page, step.tool, hardware])
		return
	var tool := tools[0]
	var head := _head_of(hardware)
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO, "centre": Vector3.ZERO}
	_queue.append(func() -> void:
		head = _head_of(hardware)
		var at := _look_at(tool, play.bonds.poses[tool].origin.lerp(head.position, 0.5), head.position)
		if at.x < 0.0:
			_fail("page %d: no screen point picks %s" % [page, tool])
			return
		state["at"] = at
		router.press(Router.LEFT, at, t))
	_queue.append(func() -> void:
		var at: Vector2 = state["at"] + Vector2(Constants.GESTURE.tapMaxDistance + 2.0, 0.0)
		router.motion(at)
		if router.drag == null or router.drag.part != tool or router.drag.mode != Router.MOVE:
			_fail("page %d: pressing %s began no carry" % [page, tool])
			return
		state["from"] = at
		# The tip to just outside the head, however the tool lies: self-aim turns it in about the tip.
		var centre := head.position + head.axis * TIP_CLEAR - router.drag.rotation * _tip_of(tool).position
		state["centre"] = centre
		state["to"] = router.screen_for(centre))
	_glide(state)
	_queue.append(func() -> void:
		if router.drag != null:
			router.wheel(-(Vector3(state["centre"]).y - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer))
	_queue.append(func() -> void: _hold_tool_on(tool, hardware, page, 0))


## The pointer slid from `state.from` to `state.to` over GLIDE_FRAMES frames.
func _glide(state: Dictionary) -> void:
	for n: int in range(1, GLIDE_FRAMES + 1):
		var k := float(n) / GLIDE_FRAMES
		_queue.append(func() -> void:
			if router.drag != null:
				router.motion(Vector2(state["from"]).lerp(Vector2(state["to"]), k)))


func _tip_of(tool: String) -> ItemData.Connector:
	for c: ItemData.Connector in play.data.type_of(play.data.instance(tool)).connectors:
		if Tools.is_tool_tip(c.type):
			return c
	return null


## The tool's tip and the hardware's head or slot it goes on, world.
func _head_of(hardware: String) -> Snap.WorldConnector:
	var connectors := play.data.type_of(play.data.instance(hardware)).connectors
	for i: int in connectors.size():
		if Tools.is_tool_target(connectors[i].type):
			return play.bonds.world_connector(hardware, i)
	return null


func _hold_tool_on(tool: String, hardware: String, page: int, held: int) -> void:
	if router.drag == null:
		_fail("page %d: the drag of %s ended by itself" % [page, tool])
		return
	var offer := router.drag.snapped
	var in_seat := offer != null and router.drag.held.origin.distance_to(offer.pose.origin) < SETTLED_M
	if offer == null and held > 0 and held % CORRECT_EVERY == 0:
		# Self-aim turned it about its tip and the floor lifted it: bring the tip back to the head,
		# with the wheel and the pointer, as a player would.
		var head := _head_of(hardware)
		var centre := head.position + head.axis * TIP_CLEAR - router.drag.rotation * _tip_of(tool).position
		router.wheel(-(centre.y - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer)
		router.motion(router.screen_for(centre))
	if not in_seat and held < HOLD_FRAMES:
		_queue.push_front(func() -> void: _hold_tool_on(tool, hardware, page, held + 1))
		return
	router.release(Router.LEFT, router.drag.pointer, t)
	var turn := play.bonds.turn_of(tool)
	if turn == null or turn.joints.is_empty() or turn.joints[0].hardware != hardware:
		_fail("page %d: %s let go is not on %s but %s (offer %s)" % [page, tool, hardware, "nothing" if turn == null else turn.part, "none" if offer == null else offer.key])
		return
	var joint := turn.joints[0]
	if joint.kind == Fastener.CAM:
		_queue.push_front(func() -> void: _drive(tool, joint, page))
	else:
		_queue.push_front(func() -> void: _crank(tool, joint, page))


## Circles the tool's dial on screen the tightening way until its joint is home.
func _crank(tool: String, joint: Bonds.Joint, page: int) -> void:
	var turn := play.bonds.turn_of(tool)
	var centre_world := router.turn_centre(turn)
	_look_at_point(centre_world)
	var centre := router.screen_of(centre_world)
	var sign := Crank.tighten_sign(router.turn_axis(turn), centre_world - router.view().eye)
	var r := Constants.TURN_RING.radius
	var state := {"angle": 0.0, "steps": 0}
	router.press(Router.LEFT, centre + Vector2(r, 0.0), t)
	if router.gesture.owner != Gesture.DRAG_PART:
		_fail("page %d: a press on %s's dial took nothing" % [page, tool])
		return
	var sweep := func(again: Callable) -> void:
		state["angle"] = float(state["angle"]) + float(sign) * CRANK_STEP
		state["steps"] = int(state["steps"]) + 1
		router.motion(centre + Vector2(cos(state["angle"]), sin(state["angle"])) * r)
		if Fastener.is_home(joint.fastener) or int(state["steps"]) > CRANK_STEPS_MAX:
			router.release(Router.LEFT, router.drag.pointer if router.drag != null else centre, t)
			if not Fastener.is_home(joint.fastener):
				_fail("page %d: %s cranked %d steps, %s at %.2f" % [page, joint.hardware, state["steps"], joint.fastener.state, joint.fastener.progress])
				return
			cranks += 1
			lines.append("page %d: %s %s by %s, %d crank steps" % [page, joint.hardware, joint.fastener.state, tool, state["steps"]])
			return
		_queue.push_front(func() -> void: again.call(again))
	_queue.push_front(func() -> void: sweep.call(sweep))


## Holds the tool still: past a tap the press drives its joint home.
func _drive(tool: String, joint: Bonds.Joint, page: int) -> void:
	var at := _look_at(tool, play.bonds.poses[tool].origin)
	if at.x < 0.0:
		_fail("page %d: no screen point picks %s to drive" % [page, tool])
		return
	router.press(Router.LEFT, at, t)
	var state := {"frames": 0}
	var hold := func(again: Callable) -> void:
		state["frames"] = int(state["frames"]) + 1
		if Fastener.is_home(joint.fastener) or int(state["frames"]) > DRIVE_FRAMES_MAX:
			router.release(Router.LEFT, at, t)
			if not Fastener.is_home(joint.fastener):
				_fail("page %d: %s held %d frames, %s at %.2f" % [page, joint.hardware, state["frames"], joint.fastener.state, joint.fastener.progress])
				return
			drives += 1
			lines.append("page %d: %s %s by %s held still, %d frames" % [page, joint.hardware, joint.fastener.state, tool, state["frames"]])
			return
		_queue.push_front(func() -> void: again.call(again))
	_queue.push_front(func() -> void: hold.call(hold))


func _look_at_point(p: Vector3) -> void:
	router.camera.frame(p + VIEW_FROM[0].normalized() * VIEW_DISTANCE, p)


func _plan_tap(id: String) -> void:
	var page := play.steps.current().number if play.steps.current() != null else 0
	_queue.append(func() -> void:
		var at := _look_at(id, play.bonds.poses[id].origin)
		if at.x < 0.0:
			_fail("page %d: no screen point picks %s to click" % [page, id])
			return
		var before := _fastened()
		router.press(Router.LEFT, at, t)
		router.release(Router.LEFT, at, t + TAP_MS)
		var pressed := _fastened() - before
		if pressed <= 0:
			_fail("page %d: a click on %s pressed nothing" % [page, id])
			return
		presses += pressed)


func _fastened() -> int:
	var n := 0
	for joint: Bonds.Joint in play.bonds.joints:
		if Fastener.is_fastened(joint.fastener):
			n += 1
	return n
