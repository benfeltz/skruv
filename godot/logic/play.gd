class_name Play
extends RefCounted
## The build as the loop plays it: the booklet (Steps), the graph and poses (Bonds), the loose
## parts laid on the floor, the snap on offer for a part dragged to a pose, seating it, tapping
## dowels home and turning pages. Pure: the mouse loop (scenes/loop.gd) and the headless
## playthrough (test/playthrough_test.gd) drive this same code, one with a mouse, one with numbers.
##
## The web's router, slimmed to the dowel loop (src/scene/gestureRouter.ts snapCandidate,
## endDrag, seatFit, moverOf, tap). Where it differs:
##   - the snap offers only the open page's own pairs. The web offers any type-compatible pair and
##     leaves right and wrong to the player; here the page has to know when it is done. A loose
##     piece of hardware stands in for any loose one of its type (a dowel is a dowel).
##   - a dragged compound is a rigid set of poses, not physics bodies; the bodies follow the poses.
##   - auto pages (Steps.is_auto) are fastened here on arrival, at the export's poses, and logged.

## Where loose parts are laid: rows across the front of the room, clear of JOHNNY's spot at the
## origin. Metres, in the room's frame (floor top at y = 0, room 5 m square).
const LAY_X_MIN := -1.25
const LAY_X_MAX := 1.25
const LAY_Z_START := 0.45
const LAY_GAP := 0.06
const LAY_HARDWARE_GAP := 0.03
## How far a let-go part may already overlap what it rests on (m), and still rest on it.
const SETTLE_EPSILON := 1e-4

var data: ItemData
var bonds: Bonds
var steps: Steps
## One line per auto page, in page order.
var auto_log: Array[String] = []
var _lay_x := LAY_X_MIN
var _lay_z := LAY_Z_START
var _row_depth := 0.0


## What a release seats: the dragged part's pose at the seat, every pair, and the loose dowel the
## dragged one stands in for ("" when none).
class Offer:
	var pose: Transform3D
	var pairs: Array[Pair] = []
	var stand_in: String = ""


class Pair:
	var spec: int
	var hardware: String
	var hardware_connector: int
	var host: String
	var host_connector: int
	var mover: String


func _init(item_data: ItemData) -> void:
	data = item_data
	bonds = Bonds.new(data)
	steps = Steps.new(data)


## The assembled (finished, upright) pose of an instance, from the export.
func assembled(id: String) -> Transform3D:
	var inst := data.instance(id)
	return Transform3D(Basis(inst.rotation), inst.position)


func is_hardware(id: String) -> bool:
	return data.type_of(data.instance(id)).hardware


## Opens the current page: lays its loose parts on the floor; an auto page is fastened and the
## booklet turns, until a page the player builds is open or the manual ends.
func open_page() -> void:
	while not steps.is_done():
		var step := steps.current()
		if not steps.is_auto(step):
			for id: String in steps.parts_on(step):
				if not bonds.poses.has(id):
					lay(id)
			return
		_auto(step)
		var turned := steps.advance(bonds)
		assert(turned, "auto page %d did not complete" % step.number)


## Lays a part flat on the floor (its thinnest side down, longest along x) in the next free spot.
func lay(id: String) -> void:
	var size := data.type_of(data.instance(id)).size
	var axes: Array[int] = [0, 1, 2]
	axes.sort_custom(func(a: int, b: int) -> bool: return size[a] > size[b])
	# Columns of the basis: where the part's local x, y, z go in the world.
	var cols: Array[Vector3] = [Vector3.ZERO, Vector3.ZERO, Vector3.ZERO]
	cols[axes[0]] = Vector3.RIGHT
	cols[axes[1]] = Vector3.BACK
	cols[axes[2]] = Vector3.UP
	var basis := Basis(cols[0], cols[1], cols[2])
	if basis.determinant() < 0.0:
		cols[axes[1]] = Vector3.FORWARD
		basis = Basis(cols[0], cols[1], cols[2])
	var length := size[axes[0]]
	var depth := size[axes[1]]
	var gap := LAY_HARDWARE_GAP if is_hardware(id) else LAY_GAP
	if _lay_x + length > LAY_X_MAX:
		_lay_x = LAY_X_MIN
		_lay_z += _row_depth + gap
		_row_depth = 0.0
	var centre := Vector3(_lay_x + length / 2.0, size[axes[2]] / 2.0, _lay_z + depth / 2.0)
	bonds.poses[id] = Transform3D(basis, centre)
	_lay_x += length + gap
	_row_depth = maxf(_row_depth, depth)


## The open page's joints not seated yet.
func open_joints() -> Array[int]:
	var out: Array[int] = []
	var step := steps.current()
	if step == null or steps.is_auto(step):
		return out
	for i: int in step.joints:
		if bonds.joint_for_spec(i) == null:
			out.append(i)
	return out


## True when the part can be picked up: something joined to it still has a seat to make on the
## open page.
func can_drag(id: String) -> bool:
	if not bonds.poses.has(id):
		return false
	var members := bonds.compound(id, false)
	for i: int in open_joints():
		var spec := data.joints[i]
		if members.has(spec.host) or members.has(spec.hardware) or _stands_in(id, spec):
			return true
	return false


## Where the dragged part goes for the nearest open seat it could make, with every pose as it is
## now: its home pose against the part it seats on. Null when it has none.
func goal_for(id: String, pose: Transform3D) -> Variant:
	var i := _nearest_joint(id, pose)
	return null if i < 0 else goal(id, i)


## Self-aim and panel magnetism (src/game/toolAim.ts aimWeight/aimStep, the router's aimHardware
## and aimPanel): within a zone of where it goes, the carried part turns toward it, harder the
## nearer it is. Lone hardware turns only its end's axis onto the seat's (AIM.zone, AIM.rate);
## anything else turns to where it goes whole (PANEL.zone, PANEL.rate). Turns about the part's
## centre (the web turns hardware about its end). Returns the new pose.
func aim(id: String, pose: Transform3D, delta: float) -> Transform3D:
	var i := _nearest_joint(id, pose)
	if i < 0:
		return pose
	var home: Transform3D = goal(id, i)
	var lone := bonds.compound(id, false).size() == 1 and is_hardware(id)
	var zone := Constants.AIM.zone if lone else Constants.PANEL.zone
	var rate := Constants.AIM.rate if lone else Constants.PANEL.rate
	var t := clampf(1.0 - home.origin.distance_to(pose.origin) / zone, 0.0, 1.0)
	var weight := t * t * (3.0 - 2.0 * t)
	if weight <= 0.0:
		return pose
	var current := pose.basis.get_rotation_quaternion()
	var aimed := home.basis.get_rotation_quaternion()
	if lone:
		var axis := data.type_of(data.instance(id)).connectors[data.joints[i].hardware_connector].axis
		var turn := Snap.rotation_between(current * axis, aimed * axis)
		if turn.get_angle() < Constants.AIM.settled:
			return pose
		aimed = (turn * current).normalized()
	var eased := current.slerp(aimed, 1.0 - exp(-rate * weight * delta)).normalized()
	return Transform3D(Basis(eased), pose.origin)


## The open joint whose goal for `id` is nearest `pose`, or -1.
func _nearest_joint(id: String, pose: Transform3D) -> int:
	var best := -1
	var best_d := INF
	for i: int in open_joints():
		var home: Variant = goal(id, i)
		if home == null:
			continue
		var d := (home as Transform3D).origin.distance_to(pose.origin)
		if d < best_d:
			best_d = d
			best = i
	return best


## The seat on offer with `id` dragged to `pose` (its compound carried rigidly), or null. Lone
## hardware snaps one end by find_snap in the SNAP window; anything else is a panel fit in the
## PANEL window, seating every pair it lands at once.
func offer_for(id: String, pose: Transform3D) -> Offer:
	var members := bonds.compound(id, false)
	var carry := pose * bonds.poses[id].affine_inverse()
	var lone_hardware := members.size() == 1 and is_hardware(id)
	var carried: Array[Snap.WorldConnector] = []
	var seats: Array[Snap.WorldConnector] = []
	var specs: Dictionary[String, int] = {}
	var stand_ins: Dictionary[String, String] = {}
	for i: int in open_joints():
		var spec := data.joints[i]
		var hardware := spec.hardware
		var stand_in := ""
		if lone_hardware and spec.hardware != id and _stands_in(id, spec):
			hardware = id
			stand_in = spec.hardware
		var hw_in := members.has(hardware)
		var host_in := members.has(spec.host)
		if hw_in == host_in:
			continue
		var moving_part := hardware if hw_in else spec.host
		var moving_index := spec.hardware_connector if hw_in else spec.host_connector
		var fixed_part := spec.host if hw_in else spec.hardware
		var fixed_index := spec.host_connector if hw_in else spec.hardware_connector
		if not bonds.poses.has(fixed_part) or bonds.is_taken(moving_part, moving_index) or bonds.is_taken(fixed_part, fixed_index):
			continue
		var from := bonds.world_connector(moving_part, moving_index)
		from = Snap.WorldConnector.new(from.type, carry * from.position, (carry.basis * from.axis).normalized(), from.part, from.index)
		var to := bonds.world_connector(fixed_part, fixed_index)
		carried.append(from)
		seats.append(to)
		var key := _key(from, to)
		specs[key] = i
		stand_ins[key] = stand_in
	if carried.is_empty():
		return null
	var offer := Offer.new()
	if lone_hardware:
		var best: Snap.Offer = null
		for n: int in carried.size():
			var one := Snap.find_snap(_one(carried[n]), _one(seats[n]), Constants.SNAP.maxDistance, Constants.SNAP.maxAngle, data.compatible)
			if one != null and (best == null or one.distance < best.distance or (one.distance == best.distance and one.angle < best.angle)):
				best = one
		if best == null:
			return null
		offer.pose = Snap.apply_transform(best.transform, pose)
		var key := _key(best.from, best.to)
		offer.stand_in = stand_ins[key]
		offer.pairs.append(_pair(specs[key], best.from, best.to, id, members))
		return offer
	var page_pair := func(a: Snap.WorldConnector, b: Snap.WorldConnector) -> bool: return specs.has(_key(a, b))
	var fits := PanelFit.find_fits(carried, pose, seats, PanelFit.FitWindow.panel(), data.compatible, page_pair)
	var chosen: PanelFit.Fit = null
	for fit: PanelFit.Fit in fits:
		if chosen == null or fit.pairs.size() > chosen.pairs.size() or (fit.pairs.size() == chosen.pairs.size() and fit.distance < chosen.distance):
			chosen = fit
	if chosen == null:
		return null
	offer.pose = chosen.pose
	for p: PanelFit.Pair in chosen.pairs:
		offer.pairs.append(_pair(specs[_key(p.hole, p.end)], p.hole, p.end, id, members))
	return offer


## Lets go on an offer: the dragged part (and its compound) to the seat, every pair seated.
## Returns the dragged part's id, which is the stand-in's when one stood in.
func seat(id: String, offer: Offer) -> String:
	var dragged := id
	if offer.stand_in != "":
		# The picked dowel becomes the one the page names; the named one takes the picked one's
		# spot on the floor.
		bonds.swap_ids(id, offer.stand_in)
		dragged = offer.stand_in
	bonds.move_compound(dragged, offer.pose)
	for p: Pair in offer.pairs:
		var hardware := offer.stand_in if p.hardware == id and offer.stand_in != "" else p.hardware
		var mover := offer.stand_in if p.mover == id and offer.stand_in != "" else p.mover
		bonds.seat(hardware, p.hardware_connector, p.host, p.host_connector, mover, p.spec)
	return dragged


## A tap on a part: every seated tap-kind joint touching it pushed home, and, for a panel, those
## its assembly was carried in on (the router's tap and pressCarried); then the booklet turns
## through every page now complete. Returns the joints pressed.
func tap(id: String) -> Array[Bonds.Joint]:
	var pressed := bonds.tap(id, behind)
	pressed.append_array(press_carried(id))
	turn_pages()
	return pressed


## A panel carried in on its hardware, or with its assembly, sits in seats it touches only through
## them: a tap on it pushes those home too (pressCarried).
func press_carried(id: String) -> Array[Bonds.Joint]:
	var out: Array[Bonds.Joint] = []
	if not is_panel(id):
		return out
	var members := bonds.compound_of(id)
	for joint: Bonds.Joint in bonds.joints.duplicate():
		if not members.has(joint.mover) or joint.hardware == id or joint.host == id or not Fastener.is_tap_kind(joint.kind):
			continue
		if members.has(joint.hardware) and members.has(joint.host):
			continue
		if bonds.apply(joint, Fastener.TAP, 0.0, "", behind(joint)):
			out.append(joint)
	return out


## A back fitting pressed home lands in whichever part holds its tip once home, its sink depth
## down the hole: the part behind it, or "" (behind).
func behind(joint: Bonds.Joint) -> String:
	if not Fastener.passes_through(joint.kind):
		return ""
	var hole := bonds.world_connector(joint.host, joint.host_connector)
	var tip := hole.position - hole.axis * float(data.sink_depth.get(joint.kind, 0.0))
	for id: String in bonds.poses:
		if id == joint.host or not can_pass_into(id):
			continue
		var local := bonds.poses[id].affine_inverse() * tip
		var half := data.type_of(data.instance(id)).size / 2.0
		if absf(local.x) <= half.x + 1e-9 and absf(local.y) <= half.y + 1e-9 and absf(local.z) <= half.z + 1e-9:
			return id
	return ""


## Turns every complete page and opens the next.
func turn_pages() -> void:
	while not steps.is_done() and steps.advance(bonds):
		open_page()


## A part a whole fit seats: it has connectors, every one a hole (isPanelType).
func is_panel(id: String) -> bool:
	var connectors := data.type_of(data.instance(id)).connectors
	return not connectors.is_empty() and can_pass_into(id)


## A part a fastener's tip can pass into: no fastener end on it (canPassInto).
func can_pass_into(id: String) -> bool:
	for c: ItemData.Connector in data.type_of(data.instance(id)).connectors:
		if data.compatible.has(c.type):
			return false
	return true


## The world box of a part at its pose now: centre and half-extents.
func box_of(id: String) -> AABB:
	var half := DragMath.rotated_half_extents(data.type_of(data.instance(id)).size / 2.0, bonds.poses[id].basis)
	return AABB(bonds.poses[id].origin - half, half * 2.0)


## The world box `members` fill together.
func box_of_set(members: Dictionary[String, bool]) -> AABB:
	var box := AABB()
	var first := true
	for id: String in members:
		if not bonds.poses.has(id):
			continue
		box = box_of(id) if first else box.merge(box_of(id))
		first = false
	return box


## What a let-go part does with no physics to drop it: `members` come straight down until the
## lowest of them rests on the floor or on the top of something under it (another part's box
## overlapping it across). Never up.
func settle(members: Dictionary[String, bool]) -> void:
	var drop := INF
	for id: String in members:
		if not bonds.poses.has(id):
			continue
		var box := box_of(id)
		var support := 0.0
		for other: String in bonds.poses:
			if members.has(other):
				continue
			var under := box_of(other)
			var top := under.end.y
			if top > box.position.y + SETTLE_EPSILON:
				continue
			var overlap_x := minf(box.end.x, under.end.x) - maxf(box.position.x, under.position.x)
			var overlap_z := minf(box.end.z, under.end.z) - maxf(box.position.z, under.position.z)
			if overlap_x > SETTLE_EPSILON and overlap_z > SETTLE_EPSILON:
				support = maxf(support, top)
		drop = minf(drop, box.position.y - support)
	if drop > 0.0 and drop < INF:
		for id: String in members:
			if bonds.poses.has(id):
				bonds.poses[id].origin.y -= drop


## How far the build is from the finished item: the worst offset (m) and turn (rad) of any
## instance from its assembled pose, and which. A piece of hardware's turn is its end axis's.
func worst_error() -> Dictionary:
	var worst := {"offset": 0.0, "turn": 0.0, "offset_id": "", "turn_id": ""}
	for inst: ItemData.Instance in data.instances:
		if not bonds.poses.has(inst.id):
			return {"offset": INF, "turn": INF, "offset_id": inst.id, "turn_id": inst.id}
		var pose := bonds.poses[inst.id]
		var offset := pose.origin.distance_to(inst.position)
		var turn := pose.basis.get_rotation_quaternion().angle_to(inst.rotation)
		if is_hardware(inst.id):
			# A fastener is round about its end's axis (snapMath straightens only the axis), so
			# its turn is how far that axis is off.
			var axis := data.type_of(inst).connectors[0].axis
			turn = (pose.basis * axis).angle_to(Basis(inst.rotation) * axis)
		if offset > float(worst["offset"]):
			worst["offset"] = offset
			worst["offset_id"] = inst.id
		if turn > float(worst["turn"]):
			worst["turn"] = turn
			worst["turn_id"] = inst.id
	return worst


func _auto(step: ItemData.Step) -> void:
	if step.tip:
		var ref := _anchor()
		bonds.move_compound(ref, assembled(ref))
	for id: String in step.parts:
		if bonds.poses.has(id):
			continue
		if step.pose == "parts":
			lay(id)
		else:
			var ref := _anchor()
			bonds.poses[id] = bonds.poses[ref] * assembled(ref).affine_inverse() * assembled(id)
	var seated: Array[Bonds.Joint] = []
	for i: int in step.joints:
		if bonds.joint_for_spec(i) != null:
			continue
		var spec := data.joints[i]
		if not bonds.poses.has(spec.host):
			lay(spec.host)
		# The hardware at its seat's mouth against its host, as the export has it home, backed out
		# by its sink: the machine drives it home.
		var home := bonds.poses[spec.host] * assembled(spec.host).affine_inverse() * assembled(spec.hardware)
		var axis := bonds.world_connector(spec.host, spec.host_connector).axis
		var sink: float = data.sink_depth.get(spec.kind, 0.0)
		bonds.poses[spec.hardware] = Transform3D(home.basis, home.origin + axis * sink)
		var joint := bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.mover, i)
		joint.auto = true
		seated.append(joint)
	# Bolts before the cams that catch them (seatHome); a cam a later page turns stays seated.
	for joint: Bonds.Joint in seated:
		if joint.kind != Fastener.CAM:
			bonds.drive(joint, "", behind(joint))
	for joint: Bonds.Joint in seated:
		if joint.kind == Fastener.CAM and step.turns.has(joint.spec):
			bonds.drive(joint, data.joints[joint.spec].captured)
	for i: int in step.turns:
		var joint := bonds.joint_for_spec(i)
		joint.auto = true
		bonds.drive(joint, data.joints[i].captured)
	auto_log.append(steps.auto_line(step))


## The part the build hangs together on: the first instance (assembled order) of the largest
## compound.
func _anchor() -> String:
	var best := ""
	var best_size := 0
	for inst: ItemData.Instance in data.instances:
		if not bonds.poses.has(inst.id):
			continue
		var n := bonds.compound(inst.id, false).size()
		if n > best_size:
			best_size = n
			best = inst.id
	return best


## `id`'s home pose for export joint `i`, against the side it does not carry, or null.
func goal(id: String, i: int) -> Variant:
	var spec := data.joints[i]
	var members := bonds.compound(id, false)
	var hardware := spec.hardware
	if members.size() == 1 and is_hardware(id) and _stands_in(id, spec):
		hardware = id
	var hw_in := members.has(hardware)
	if hw_in == members.has(spec.host):
		return null
	var moving := hardware if hw_in else spec.host
	var fixed := spec.host if hw_in else spec.hardware
	if not bonds.poses.has(fixed):
		return null
	# Measured through a panel on each side where there is one: a dowel is round about its axis,
	# so its own spin says nothing about where its panel goes.
	var fixed_ref := _panel_of(fixed)
	var moving_ref := _panel_of(id)
	var moving_named := spec.hardware if moving == hardware and moving_ref == id else moving_ref
	var ref_home := bonds.poses[fixed_ref] * assembled(fixed_ref).affine_inverse() * assembled(moving_named)
	return ref_home * bonds.relative_pose(moving_ref, id)


## A panel joined to `id` (`id` itself when it is one), first in assembled order; `id` when it is
## lone hardware.
func _panel_of(id: String) -> String:
	if not is_hardware(id):
		return id
	var members := bonds.compound(id, false)
	for inst: ItemData.Instance in data.instances:
		if members.has(inst.id) and not is_hardware(inst.id):
			return inst.id
	return id


## True when lone loose hardware `id` can stand in for the joint's hardware: the same type, both
## loose, neither seated.
func _stands_in(id: String, spec: ItemData.JointSpec) -> bool:
	if id == spec.hardware:
		return true
	if not is_hardware(id) or bonds.is_seated(id) or bonds.is_seated(spec.hardware):
		return false
	return data.instance(id).type == data.instance(spec.hardware).type and bonds.poses.has(spec.hardware)


func _pair(spec: int, from: Snap.WorldConnector, to: Snap.WorldConnector, dragged: String, members: Dictionary[String, bool]) -> Pair:
	var s := data.joints[spec]
	var p := Pair.new()
	p.spec = spec
	var hardware_end := from if from.type in data.compatible else to
	var hole := to if hardware_end == from else from
	p.hardware = hardware_end.part
	p.hardware_connector = hardware_end.index
	p.host = hole.part
	p.host_connector = hole.index
	assert(p.host == s.host and p.host_connector == s.host_connector, "pair is not export joint %d" % spec)
	# The mover (moverOf): the moving side's panel; for a carried dowel's end, the carried panel
	# it sits in; lone hardware moves itself.
	var moving := from.part
	if moving == dragged and members.size() == 1:
		p.mover = moving
	elif not is_hardware(moving):
		p.mover = moving
	else:
		p.mover = moving
		for joint: Bonds.Joint in bonds.joints:
			if joint.hardware == moving and members.has(joint.host) and not is_hardware(joint.host):
				p.mover = joint.host
				break
	return p


static func _key(a: Snap.WorldConnector, b: Snap.WorldConnector) -> String:
	return "%s#%d>%s#%d" % [a.part, a.index, b.part, b.index]


static func _one(c: Snap.WorldConnector) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = [c]
	return out
