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

## How far off its seat, out along the seat's axis, the hand holds a part for the assist (m), and
## how far out along it the hand first brings it, outside the snap window (SNAP.maxDistance).
const BACK_OFF := 0.03
const APPROACH := 0.1
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
## How far above what lies on its way the hand carries a part across (m), and how wide that way is.
const CARRY_CLEAR := 0.05
const CORRIDOR := 0.1
## Room a part needs round it to turn where it lies (m), and the grid the hand looks for it on.
const TURN_ROOM := 0.05
const SPOT_STEP := 0.1
## The way in: checked every ENTRY_STEP m with the carried box shrunk by ENTRY_SLACK (a part may
## graze what it slides past); the build is the parts larger than ENTRY_LARGE across, and the hand
## comes in from ENTRY_MARGIN beyond it.
const ENTRY_STEP := 0.01
const ENTRY_SLACK := 0.002
const ENTRY_LARGE := 0.3
const ENTRY_MARGIN := 0.15
## The most frames the hand waits for something let go to come down, and how long it lets a part
## turned with the rings settle before planning again.
const SETTLE_FRAMES := 180
const TURN_SETTLE_FRAMES := 30
## How far above where a part goes the hand's eye must be, so the drag's plane stays below it (m).
const EYE_ABOVE := 0.3
## The rise of the hand's lower views, per unit across (about 22° up).
const LOW_VIEW := 0.4
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
## A ring's quarter turn in this many pointer steps, seen from this far.
const RING_STEPS := 12
## The hand looks at a ring from this many of its radii away, and no nearer than RING_VIEW_MIN (m).
const RING_VIEW_PER_RADIUS := 3.5
const RING_VIEW_MIN := 0.5
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
var turnings := 0
var frames := 0
var t := 0
var _queue: Array[Callable] = []


## Where each tool lay in the box: the hand puts it back there after use.
var _tool_home: Dictionary[String, Transform3D] = {}


func _init(r: Router) -> void:
	router = r
	play = r.play
	for inst: ItemData.Instance in play.data.extras:
		if play.bonds.poses.has(inst.id):
			_tool_home[inst.id] = play.bonds.poses[inst.id]


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
	var step0 := play.steps.current()
	if play.steps.turns_build(step0) and not Steps.stands_as(step0.pose, play.build_basis()):
		_plan_turn(step0)
		return
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
func _look_at(id: String, point: Vector3, also: Vector3 = point, above: float = -INF) -> Vector2:
	# The fixed directions, then lower ones, then from the build's own front (into the carcass).
	var views: Array[Vector3] = []
	views.append_array(VIEW_FROM)
	for from: Vector3 in VIEW_FROM:
		views.append(Vector3(from.x, LOW_VIEW, from.z))
	var front := play.build_basis() * Vector3.BACK
	views.append(Vector3(front.x, 1.0, front.z))
	views.append(Vector3(front.x, LOW_VIEW, front.z))
	for distance: float in VIEW_DISTANCES:
		for from: Vector3 in views:
			if Vector2(from.x, from.z).length() < 1e-3:
				continue
			router.camera.frame(point + from.normalized() * distance, point)
			# A drag rides a level plane through the finger: the eye must look down onto it there.
			if not _on_screen(also) or router.camera.eye().y < above:
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
	# A panel far off how it goes is turned over with the rings first, where it lies: magnetism
	# turning a long panel near the build would sweep it through the build.
	# Exactly as it goes, not an equivalent turned by its symmetry: "where it goes" ranks exact poses.
	if play.is_panel(id) and not _same_turn(play.bonds.poses[id].basis, seat.basis, ""):
		var turns := quarter_turns_until(play.bonds.poses[id].basis, func(b: Basis) -> bool: return _same_turn(b, seat.basis, ""))
		if not turns.is_empty():
			_queue_turns(id, turns, page)
			turnings += turns.size()
			lines.append("page %d: %s turned with the rings first, %d quarter turns" % [page, id, turns.size()])
			# Planned again once it has come down: its goal moves with it.
			_queue.append(func() -> void: _queue.push_front(func() -> void: _wait_still(id, 0)))
			return
	var back := _back_off(id, i)
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO, "frame": 0, "clear": 0.0, "entry": Vector3.ZERO}
	_queue.append(func() -> void:
		var clear := _clear_height(id, play.bonds.poses[id].origin, seat.origin + back.normalized() * APPROACH)
		state["clear"] = clear
		var at := _look_at(id, play.bonds.poses[id].origin.lerp(seat.origin, 0.5), seat.origin, clear + EYE_ABOVE)
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
		# Up clear of the floor's parts, then across to a point out along the seat's axis, down to
		# its height, then in along the axis to just off the seat: the seat assist never cuts
		# through the part it seats on.
		var far := seat.origin + back.normalized() * APPROACH
		var entry := _entry(id, far, maxf(float(state["clear"]), far.y))
		state["entry"] = entry
		router.wheel(-(maxf(float(state["clear"]), far.y) - router.drag.height) / Constants.GESTURE.desktopLiftRate, at)
		state["to"] = router.screen_for(entry))
	_glide(state)
	_come_in(state, func() -> Vector3: return seat.origin + back.normalized() * APPROACH)
	_queue.append(func() -> void:
		if router.drag == null:
			return
		state["from"] = router.drag.pointer
		state["to"] = router.screen_for(seat.origin + back))
	_glide(state)
	# Onto the seat's height (an axis that is not level) with the wheel; the lift keeps x and z.
	_queue.append(func() -> void:
		if router.drag != null:
			router.wheel(-(seat.origin.y + back.y - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer))
	_queue.append(func() -> void: _hold_for_seat(id, i, page, 0))


## Lays a panel in where it goes (a shelf on its pins): lifted clear, carried over its place, let go;
## it comes down onto what it rests on.
func _plan_place(id: String, place: Transform3D) -> void:
	var page := play.steps.current().number
	var type := play.type_of(id)
	if not _same_turn(play.bonds.poses[id].basis, place.basis, type):
		var turns := quarter_turns_until(play.bonds.poses[id].basis, func(b: Basis) -> bool: return _same_turn(b, place.basis, type))
		if turns.is_empty():
			_fail("page %d: no quarter turns lay %s as it goes" % [page, id])
			return
		_queue_turns(id, turns, page)
		turnings += turns.size()
		lines.append("page %d: %s turned with the rings, %d quarter turns" % [page, id, turns.size()])
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO, "clear": 0.0, "entry": Vector3.ZERO}
	_queue.append(func() -> void:
		var clear := _clear_height(id, play.bonds.poses[id].origin, place.origin)
		state["clear"] = clear
		var at := _look_at(id, play.bonds.poses[id].origin.lerp(place.origin, 0.5), place.origin, clear + EYE_ABOVE)
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
		var over := place.origin + Vector3.UP * LAY_CLEAR
		var entry := _entry(id, over, maxf(float(state["clear"]), over.y))
		state["entry"] = entry
		router.wheel(-(maxf(float(state["clear"]), over.y) - router.drag.height) / Constants.GESTURE.desktopLiftRate, at)
		state["to"] = router.screen_for(entry))
	_glide(state)
	_come_in(state, func() -> Vector3: return place.origin + Vector3.UP * LAY_CLEAR)
	_queue.append(func() -> void:
		if router.drag == null:
			_fail("page %d: the drag of %s ended by itself" % [page, id])
			return
		router.release(Router.LEFT, router.drag.pointer, t)
		_queue.push_front(func() -> void: _wait_placed(id, place, page, 0)))


## Waits a moment for a part let go to come down before the hand plans again.
func _wait_still(id: String, waited: int) -> void:
	if waited < TURN_SETTLE_FRAMES:
		_queue.push_front(func() -> void: _wait_still(id, waited + 1))


## Waits while a panel let go comes down (the simulation drops it), then checks it lies where it goes.
func _wait_placed(id: String, place: Transform3D, page: int, waited: int) -> void:
	if not play.is_placed(id) and waited < SETTLE_FRAMES:
		_queue.push_front(func() -> void: _wait_placed(id, place, page, waited + 1))
		return
	if not play.is_placed(id):
		_fail("page %d: %s let go at %s is not where it goes (%s)" % [page, id, play.bonds.poses[id].origin, place.origin])
		return
	lines.append("page %d: %s laid in" % [page, id])


## The height (of the carried part's centre) that clears everything lying along the way from `from`
## to `to`: the top of every other part whose box comes within CORRIDOR across, plus CARRY_CLEAR
## and the carried part's own half height. A held part pushed into another drags it along.
func _clear_height(id: String, from: Vector3, to: Vector3) -> float:
	var carried := play.bonds.compound(id, false)
	var reach := play.box_of_set(carried)
	var half := reach.size / 2.0
	var lo := Vector2(minf(from.x, to.x), minf(from.z, to.z)) - Vector2(half.x, half.z) - Vector2.ONE * CORRIDOR
	var hi := Vector2(maxf(from.x, to.x), maxf(from.z, to.z)) + Vector2(half.x, half.z) + Vector2.ONE * CORRIDOR
	var top := maxf(from.y, to.y) - half.y
	for other: String in play.bonds.poses:
		if carried.has(other):
			continue
		var box := play.box_of(other)
		if box.end.x < lo.x or box.position.x > hi.x or box.end.z < lo.y or box.position.z > hi.y:
			continue
		top = maxf(top, box.end.y)
	return top + CARRY_CLEAR + half.y + (play.bonds.poses[id].origin.y - reach.get_center().y)


## Where the carried part comes in to `target` from: straight down from `clear` when that way is
## free of every other part's box, else level from outside the build along one of the four sides
## that is (into a bay of the carcass through its open side). The way is checked with the carried
## part's box swept along it. Returns the point to come down to, outside, at the target's height
## (or above it, for straight down).
func _entry(id: String, target: Vector3, clear: float) -> Vector3:
	var carried := play.bonds.compound(id, false)
	var reach := play.box_of_set(carried)
	var offset := reach.get_center() - play.bonds.poses[id].origin
	var half := reach.size / 2.0 - Vector3.ONE * ENTRY_SLACK
	var others: Array[AABB] = []
	var outer := AABB(target, Vector3.ZERO)
	for other: String in play.bonds.poses:
		if carried.has(other):
			continue
		var box := play.box_of(other)
		others.append(box)
		if box.size.length() > ENTRY_LARGE:
			outer = outer.merge(box)
	var above := Vector3(target.x, clear, target.z)
	if _way_free(above, target, offset, half, others):
		return above
	var distance := outer.size.length() + ENTRY_MARGIN
	for dir: Vector3 in [Vector3.RIGHT, Vector3.LEFT, Vector3.BACK, Vector3.FORWARD]:
		var outside := target + dir * distance
		if _way_free(outside, target, offset, half, others):
			# Only as far out as the build reaches that way, plus a margin.
			var near := outside
			var step := 0.05
			while near.distance_to(target) > step and _way_free(near - dir * step, target, offset, half, others) and not outer.grow(ENTRY_MARGIN / 2.0).has_point(near - dir * step):
				near -= dir * step
			return near
	return above


func _way_free(from: Vector3, to: Vector3, offset: Vector3, half: Vector3, others: Array[AABB]) -> bool:
	var n := maxi(1, ceili(from.distance_to(to) / ENTRY_STEP))
	for k: int in n + 1:
		var p := from.lerp(to, float(k) / n) + offset
		var box := AABB(p - half, half * 2.0)
		for other: AABB in others:
			if box.intersects(other):
				return false
	return true


## Where the hand leaves a part for joint `i`: backed off its seat along the seat's axis, out of the
## wood (a held part pressed into another would shove it), the seat assist bringing it in.
func _back_off(id: String, i: int) -> Vector3:
	var spec := play.data.joints[i]
	var carried_side := play.bonds.compound(id, false)
	var fixed := play.bonds.world_connector(spec.host, spec.host_connector) if carried_side.has(spec.hardware) else play.bonds.world_connector(spec.hardware, spec.hardware_connector)
	return fixed.axis * BACK_OFF


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
	var before := play.bonds.joints.duplicate()
	router.release(Router.LEFT, router.drag.pointer, t)
	var joint := play.bonds.joint_for_spec(i)
	if joint == null:
		# Seated somewhere the manual has another seat of its kind: fine, the booklet goes by type.
		for j: Bonds.Joint in play.bonds.joints:
			if not before.has(j):
				joint = j
				break
		if joint == null:
			_fail("page %d: letting go of %s seated nothing (offer of %d pairs)" % [page, id, pairs])
			return
		lines.append("page %d: %s seated where joint %d's kind goes, not joint %d" % [page, id, joint.spec, i])
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
	if not _tool_home.has(tool):
		_tool_home[tool] = play.bonds.poses[tool]
	var head := _head_of(hardware)
	# A tool far off pointing into the head is turned with the rings first, where it lies: self-aim
	# swinging a screwdriver about its tip near the build would sweep it through the build.
	var tip_axis := _tip_of(tool).axis
	var into := -head.axis
	if (play.bonds.poses[tool].basis * tip_axis).angle_to(into) > Play.PLACE_TURN:
		var turns := quarter_turns_until(play.bonds.poses[tool].basis, func(b: Basis) -> bool: return (b * tip_axis).angle_to(into) <= Play.PLACE_TURN)
		if not turns.is_empty():
			_queue_turns(tool, turns, page)
			turnings += turns.size()
			lines.append("page %d: %s turned with the rings first, %d quarter turns" % [page, tool, turns.size()])
			_queue.append(func() -> void: _queue.push_front(func() -> void: _wait_still(tool, 0)))
			_queue.append(func() -> void: _plan_tool(hardware))
			return
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO, "centre": Vector3.ZERO, "clear": 0.0, "entry": Vector3.ZERO}
	_queue.append(func() -> void:
		head = _head_of(hardware)
		var clear := _clear_height(tool, play.bonds.poses[tool].origin, head.position + head.axis * APPROACH)
		state["clear"] = clear
		var at := _look_at(tool, play.bonds.poses[tool].origin.lerp(head.position, 0.5), head.position, clear + EYE_ABOVE)
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
		var entry := _entry(tool, centre, maxf(float(state["clear"]), centre.y))
		state["entry"] = entry
		router.wheel(-(maxf(float(state["clear"]), centre.y) - router.drag.height) / Constants.GESTURE.desktopLiftRate, at)
		state["to"] = router.screen_for(entry))
	_glide(state)
	_come_in(state, func() -> Vector3: return Vector3(state["centre"]))
	_queue.append(func() -> void: _hold_tool_on(tool, hardware, page, 0))


## From above the way in (`state.entry`), down to its height, then level in to `target()`.
func _come_in(state: Dictionary, target: Callable) -> void:
	_queue.append(func() -> void:
		if router.drag == null:
			return
		var entry: Vector3 = state["entry"]
		router.wheel(-(entry.y - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer)
		state["from"] = router.drag.pointer
		state["to"] = router.screen_for(target.call() as Vector3))
	_glide(state)
	_queue.append(func() -> void:
		if router.drag != null:
			router.wheel(-((target.call() as Vector3).y - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer))


## The nearest spot on the floor where `id` can turn any way round without touching anything: its
## own spot if that is clear. Its centre at the height it rests at now.
func _free_spot(id: String) -> Vector3:
	var pose := play.bonds.poses[id]
	var r := play.data.type_of(play.data.instance(id)).size.length() / 2.0 + TURN_ROOM
	var room := DragMath.room()
	var best := pose.origin
	var best_d := INF
	var x := -room.x / 2.0 + r + Constants.GESTURE.wallMargin
	while x <= room.x / 2.0 - r - Constants.GESTURE.wallMargin:
		var z := -room.z / 2.0 + r + Constants.GESTURE.wallMargin
		while z <= room.z / 2.0 - r - Constants.GESTURE.wallMargin:
			var spot := Vector3(x, pose.origin.y, z)
			var d := spot.distance_to(pose.origin)
			if d < best_d and _room_at(id, spot, r):
				best = spot
				best_d = d
			z += SPOT_STEP
		x += SPOT_STEP
	if _room_at(id, pose.origin, r):
		return pose.origin
	return best


func _room_at(id: String, spot: Vector3, r: float) -> bool:
	var area := AABB(Vector3(spot.x - r, 0.0, spot.z - r), Vector3(2.0 * r, 2.0 * r, 2.0 * r))
	for other: String in play.bonds.poses:
		if other != id and play.box_of(other).intersects(area):
			return false
	return true


## Carries `id` to `spot` on the floor and lets it down there.
func _plan_move_to(id: String, spot: Vector3, page: int) -> void:
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO, "clear": 0.0}
	_queue.append(func() -> void:
		var clear := _clear_height(id, play.bonds.poses[id].origin, spot)
		state["clear"] = clear
		var at := _look_at(id, play.bonds.poses[id].origin.lerp(spot, 0.5), spot, clear + EYE_ABOVE)
		if at.x < 0.0:
			_fail("page %d: no screen point picks %s to move it clear" % [page, id])
			return
		state["at"] = at
		router.press(Router.LEFT, at, t))
	_queue.append(func() -> void:
		var at: Vector2 = state["at"] + Vector2(Constants.GESTURE.tapMaxDistance + 2.0, 0.0)
		router.motion(at)
		if router.drag == null or router.drag.part != id:
			_fail("page %d: pressing %s to move it clear began no carry" % [page, id])
			return
		state["from"] = at
		router.wheel(-(float(state["clear"]) - router.drag.height) / Constants.GESTURE.desktopLiftRate, at)
		state["to"] = router.screen_for(spot))
	_glide(state)
	_queue.append(func() -> void:
		if router.drag != null:
			router.wheel(-(spot.y + LAY_CLEAR - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer)
			router.release(Router.LEFT, router.drag.pointer, t))
	_queue.append(func() -> void: _queue.push_front(func() -> void: _wait_still(id, 0)))


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
			_queue.push_front(func() -> void: _plan_park(tool))
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
			_queue.push_front(func() -> void: _plan_park(tool))
			return
		_queue.push_front(func() -> void: again.call(again))
	_queue.push_front(func() -> void: hold.call(hold))


## The quarter turns about world axes (each `Vector4(axis, sign)`) that stand the build as `pose`
## has it, fewest first.
static func quarter_turns(frame: Basis, pose: String) -> Array[Vector4]:
	return quarter_turns_until(frame, func(b: Basis) -> bool: return Steps.stands_as(pose, b))


## The fewest quarter turns about world axes taking `frame` to one `done(basis)` accepts (up to three).
static func quarter_turns_until(frame: Basis, done: Callable) -> Array[Vector4]:
	var moves: Array[Vector4] = []
	for axis: Vector3 in [Vector3.RIGHT, Vector3.UP, Vector3.BACK]:
		for sign: float in [1.0, -1.0]:
			moves.append(Vector4(axis.x, axis.y, axis.z, sign))
	var frontier: Array = [[frame, []]]
	for depth: int in 3:
		var next: Array = []
		for entry: Array in frontier:
			var b: Basis = entry[0]
			if bool(done.call(b)):
				var found: Array[Vector4] = []
				found.assign(entry[1])
				return found
			for m: Vector4 in moves:
				var path: Array = entry[1].duplicate()
				path.append(m)
				next.append([Basis(Vector3(m.x, m.y, m.z), m.w * PI / 2.0) * b, path])
		frontier = next
	for entry: Array in frontier:
		if bool(done.call(entry[0])):
			var found: Array[Vector4] = []
			found.assign(entry[1])
			return found
	return []


## Turns the build over as the page has it: a panel of it tapped to bring up the rings, then each
## quarter turn a sweep along its ring.
func _plan_turn(step: ItemData.Step) -> void:
	var page := step.number
	var turns := quarter_turns(play.build_basis(), step.pose)
	if turns.is_empty():
		_fail("page %d: no quarter turns stand the build %s" % [page, step.pose])
		return
	var panel := play._anchor()
	_queue_turns(panel, turns, page)
	_queue.append(func() -> void: _wait_stands(step, turns.size(), 0))


## Waits while the turned build comes down, then checks it stands as the page has it.
func _wait_stands(step: ItemData.Step, count: int, waited: int) -> void:
	if not Steps.stands_as(step.pose, play.build_basis()) and waited < SETTLE_FRAMES:
		_queue.push_front(func() -> void: _wait_stands(step, count, waited + 1))
		return
	if not Steps.stands_as(step.pose, play.build_basis()):
		_fail("page %d: turned, the build does not stand %s" % [step.number, step.pose])
		return
	turnings += count
	lines.append("page %d: the build turned %s, %d quarter turns" % [step.number, step.pose, count])


## Selects `panel` with a tap, then each quarter turn a sweep along its ring; first, if it has no
## room to turn where it lies, it is carried to the nearest clear spot on the floor.
func _queue_turns(panel: String, turns: Array[Vector4], page: int) -> void:
	if play.bonds.compound(panel, false).size() == 1:
		var spot := _free_spot(panel)
		if spot != play.bonds.poses[panel].origin:
			_plan_move_to(panel, spot, page)
	_queue.append(func() -> void:
		var at := _look_at(panel, play.bonds.poses[panel].origin)
		if at.x < 0.0:
			_fail("page %d: no screen point picks %s to select" % [page, panel])
			return
		router.press(Router.LEFT, at, t)
		router.release(Router.LEFT, at, t + TAP_MS)
		if router.selected != panel:
			_fail("page %d: a tap on %s did not select it" % [page, panel]))
	for m: Vector4 in turns:
		_queue.append(func() -> void: _sweep_ring(panel, Vector3(m.x, m.y, m.z), m.w, page))
	# Done turning: a tap on empty space puts the rings away.
	_queue.append(func() -> void:
		for y: float in [0.02, 0.1, 0.2]:
			for x: float in [0.02, 0.5, 0.98]:
				var at := router.view().size * Vector2(x, y)
				if router.hit_at(at).is_empty():
					router.press(Router.LEFT, at, t)
					router.release(Router.LEFT, at, t + TAP_MS)
					return
		_fail("page %d: no empty space to tap the rings away" % page))


## True when `b` is `goal` or ("" `type`: exactly) `goal` re-expressed by one of `type`'s symmetries.
func _same_turn(b: Basis, goal: Basis, type: String) -> bool:
	var turns: Array[Basis] = [goal]
	if type != "":
		for sym: Bonds.Symmetry in play.bonds.symmetries(type):
			turns.append(goal * sym.turn.inverse())
	for g: Basis in turns:
		if b.get_rotation_quaternion().angle_to(g.get_rotation_quaternion()) <= Play.PLACE_TURN:
			return true
	return false


## One quarter turn of the selected part's build about world `axis`, the way `sign` says: a press on
## that ring's band, then a sweep round the part's screen centre.
func _sweep_ring(panel: String, axis: Vector3, sign: float, page: int) -> void:
	var name := ""
	for n: String in Router.RING_AXES:
		if Router.RING_AXES[n] == axis:
			name = n
	var f := router.ring_frame()
	var centre_world := Vector3(f.x, f.y, f.z)
	router.camera.frame(centre_world + VIEW_FROM[1].normalized() * maxf(RING_VIEW_MIN, f.w * RING_VIEW_PER_RADIUS), centre_world)
	var start := Vector2(-1, -1)
	var u := axis.cross(Vector3.UP if absf(axis.y) < 0.9 else Vector3.RIGHT).normalized()
	var w := axis.cross(u)
	for n: int in Router.RING_SAMPLES:
		var a := TAU * n / Router.RING_SAMPLES
		var p := centre_world + (u * cos(a) + w * sin(a)) * f.w
		if not _on_screen(p):
			continue
		var at := router.screen_of(p)
		var hit := router.hit_at(at)
		if hit.get("kind", "") == "ring" and hit.get("axis", "") == name:
			start = at
			break
	if start.x < 0.0:
		_fail("page %d: no screen point presses %s's %s ring" % [page, panel, name])
		return
	var centre := router.screen_of(centre_world)
	var ring_sign := 1.0 if axis.dot(router.view().eye - centre_world) >= 0.0 else -1.0
	var r := start.distance_to(centre)
	var phi0 := atan2(centre.y - start.y, start.x - centre.x)
	var swept := sign * ring_sign * PI / 2.0
	router.press(Router.LEFT, start, t)
	for n: int in range(1, RING_STEPS + 1):
		var phi := phi0 + swept * float(n) / RING_STEPS
		var k := n
		_queue.push_front(func() -> void:
			router.motion(centre + Vector2(cos(phi), -sin(phi)) * r)
			if k == RING_STEPS:
				router.release(Router.LEFT, centre + Vector2(cos(phi), -sin(phi)) * r, t))
	# Queued in reverse: the first step first.
	var steps: Array[Callable] = []
	for n: int in RING_STEPS:
		steps.append(_queue.pop_front())
	steps.reverse()
	for n: int in range(steps.size() - 1, -1, -1):
		_queue.push_front(steps[n])


## Puts a tool that came off back where it lay in the box, clear of the build.
func _plan_park(tool: String) -> void:
	if not _tool_home.has(tool) or play.bonds.turn_of(tool) != null:
		return
	var home := _tool_home[tool]
	var page := play.steps.current().number if play.steps.current() != null else 0
	var state := {"at": Vector2.ZERO, "from": Vector2.ZERO, "to": Vector2.ZERO, "clear": 0.0}
	var steps_: Array[Callable] = []
	steps_.append(func() -> void:
		var clear := _clear_height(tool, play.bonds.poses[tool].origin, home.origin)
		state["clear"] = clear
		var at := _look_at(tool, play.bonds.poses[tool].origin.lerp(home.origin, 0.5), home.origin, clear + EYE_ABOVE)
		if at.x < 0.0:
			_fail("page %d: no screen point picks %s to put it back" % [page, tool])
			return
		state["at"] = at
		router.press(Router.LEFT, at, t))
	steps_.append(func() -> void:
		var at: Vector2 = state["at"] + Vector2(Constants.GESTURE.tapMaxDistance + 2.0, 0.0)
		router.motion(at)
		if router.drag == null or router.drag.part != tool:
			_fail("page %d: pressing %s to put it back began no carry" % [page, tool])
			return
		state["from"] = at
		router.wheel(-(float(state["clear"]) - router.drag.height) / Constants.GESTURE.desktopLiftRate, at)
		state["to"] = router.screen_for(home.origin))
	for n: int in range(1, GLIDE_FRAMES + 1):
		var k := float(n) / GLIDE_FRAMES
		steps_.append(func() -> void:
			if router.drag != null:
				router.motion(Vector2(state["from"]).lerp(Vector2(state["to"]), k)))
	steps_.append(func() -> void:
		if router.drag != null:
			router.wheel(-(home.origin.y + LAY_CLEAR - router.drag.height) / Constants.GESTURE.desktopLiftRate, router.drag.pointer)
			router.release(Router.LEFT, router.drag.pointer, t))
	for n: int in range(steps_.size() - 1, -1, -1):
		_queue.push_front(steps_[n])


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
