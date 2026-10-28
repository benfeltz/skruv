class_name Play
extends RefCounted
## The build as it is played: the booklet (Steps), the graph and poses (Bonds), the loose parts on
## the floor, the seat on offer for a part held at a pose, seating it, tapping it home and turning
## pages. Pure: the router (logic/router.gd) drives it for the mouse and the headless hand alike.
##
## The snap is the web's (src/scene/gestureRouter.ts snapCandidate, fitCandidate, settled,
## seatFit, moverOf): any type-compatible pair of free connectors seats. Hardware seats by one end
## (Snap.find_snap in the SNAP window); a panel by a whole fit of its holes and its carried
## hardware's ends (PanelFit in the PANEL window), ranked where it goes first (FitRank), the offer
## held against one as good (FitRank.held_offer). A seat that would hold a part through the floor
## or a wall is refused. The booklet only advises: a page turns once its joints are in.
##
## With Constants.knobs.pageGating on, 2.0.4.3's rule instead: a pair seats only if it is one the
## open page still wants (by type, so any dowel stands in for the one named), only parts of the
## types it wants can be picked up, and a page's loose parts come out only when it opens. Off, the
## whole box is out from the start.
##
## The booklet goes by type (Steps.key_of): a page is done once the build holds as many seats of each
## (host type, hole, hardware type) as the manual asks for by then, whichever instances they are, so
## a horizontal turned end for end, its dowels swapped, still turns the page.

## Where loose parts are laid: rows across the front of the room, clear of JOHNNY's spot at the
## origin. Metres, in the room's frame (floor top at y = 0).
const LAY_X_MIN := -2.2
const LAY_X_MAX := 2.2
const LAY_Z_START := 0.45
const LAY_GAP := 0.12
const LAY_HARDWARE_GAP := 0.03
## How far a let-go part may already overlap what it rests on (m), and still rest on it.
const SETTLE_EPSILON := 1e-4
## A panel laid in (not seated: it has no fastener of its own, the back panel before its fittings, a
## shelf on its pins) lies where it goes within this far (m) and this turn (rad). Not the web's: its
## booklet never checks; these are the Godot booklet's.
const PLACE_REACH := 0.03
const PLACE_TURN := (10.0 * PI) / 180.0

var data: ItemData
var bonds: Bonds
var steps: Steps
var relatives: FitRank.Relatives
## Constants.knobs.pageGating when the build began.
var gating: bool
## One line per auto page, in page order.
var auto_log: Array[String] = []
var _lay_x := LAY_X_MIN
var _lay_z := LAY_Z_START
var _row_depth := 0.0


## A seat on offer: the pose it holds the dragged part at and every pair it seats; for a panel's
## fit which pairs (`key`), whether it is where the panel goes, and where the finger had the panel
## when it was first offered (`taken`).
class Offer:
	var pose: Transform3D
	var pairs: Array[Pair] = []
	var key: String = ""
	var preferred: bool = false
	var taken: Transform3D
	var has_taken: bool = false


## One pair a release seats: the carried side's connector on the other's, and the part that moves.
class Pair:
	var a: String
	var a_index: int
	var b: String
	var b_index: int
	var mover: String


## What a drag carries: the part, where it was when the drag began, and each rider with where it
## was then (the router's carry).
class Carry:
	var part: String
	var start: Transform3D
	var riders: Dictionary[String, Transform3D] = {}

	## Where every carried part is with `part` at `pose`.
	func pose_of(id: String, pose: Transform3D) -> Transform3D:
		return pose if id == part else Bonds.carry_pose(start, pose, riders[id])

	func has(id: String) -> bool:
		return id == part or riders.has(id)


func _init(item_data: ItemData, gate: bool = Constants.knobs.pageGating) -> void:
	data = item_data
	gating = gate
	bonds = Bonds.new(data)
	steps = Steps.new(data)
	relatives = FitRank.preferred_relatives(data, is_panel)


## The assembled (finished, upright) pose of an instance, from the export.
func assembled(id: String) -> Transform3D:
	var inst := data.instance(id)
	return Transform3D(Basis(inst.rotation), inst.position)


func is_hardware(id: String) -> bool:
	return data.type_of(data.instance(id)).hardware


func type_of(id: String) -> String:
	return data.instance(id).type


## Opens the current page. Gated, its loose parts are laid on the floor as it opens; else the whole
## box is out from the first page. An auto page is fastened and the booklet turns, until a page the
## player builds is open or the manual ends.
func open_page() -> void:
	if not gating:
		for inst: ItemData.Instance in data.box():
			if not bonds.poses.has(inst.id):
				lay(inst.id)
	while not steps.is_done():
		var step := steps.current()
		if not steps.is_auto(step):
			for id: String in steps.parts_on(step) + tools_of(step):
				if not bonds.poses.has(id):
					lay(id)
			return
		_auto(step)
		var turned := steps.advance(bonds, is_placed, build_basis)
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


## The box's parts of the page's tool type.
func tools_of(step: ItemData.Step) -> Array[String]:
	var out: Array[String] = []
	for inst: ItemData.Instance in data.extras:
		if inst.type == step.tool:
			out.append(inst.id)
	return out


## The open page's joints not seated by name yet (the hand's list).
func open_joints() -> Array[int]:
	var out: Array[int] = []
	var step := steps.current()
	if step == null or steps.is_auto(step):
		return out
	for i: int in step.joints:
		if bonds.joint_for_spec(i) == null:
			out.append(i)
	return out


## True when the part can be picked up: any part in the room; gated, only one with something on
## the open page (it, or what is joined to it, or a loose part of a type the page wants).
func can_drag(id: String) -> bool:
	if not bonds.poses.has(id):
		return false
	if not gating:
		return true
	var wanted := steps.wanted_types(bonds)
	for member: String in bonds.compound(id, false):
		if wanted.has(type_of(member)):
			return true
	return false


# --- seats ------------------------------------------------------------------------------


## Every free connector a carried part could seat on: on every part in the room but the carried
## ones and `exclude`.
func seats_for(carry: Carry, exclude: Dictionary[String, bool] = {}) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	var seated := Tools.seated_hardware(bonds)
	for id: String in bonds.poses:
		if carry.has(id) or exclude.has(id):
			continue
		for c: Snap.WorldConnector in bonds.free_connectors(id):
			if Tools.is_seat_target(c, seated):
				out.append(c)
	return out


## What a carried panel seats by with it at `pose`: its free holes and those of every panel it
## carries, and the free fastener ends of the hardware it carries (carriedConnectors).
func carried_connectors(carry: Carry, pose: Transform3D) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	for id: String in [carry.part] + carry.riders.keys():
		var at := carry.pose_of(id, pose)
		var connectors := data.type_of(data.instance(id)).connectors
		for i: int in connectors.size():
			if bonds.is_taken(id, i):
				continue
			var c := connectors[i]
			if id != carry.part and not is_panel(id) and not data.compatible.has(c.type):
				continue
			out.append(Snap.in_world(c.type, c.position, c.axis, at, id, i))
	return out


## Where `panel` goes on each part in the room it meets in the finished item, as they lie now; and
## where it goes when any panel it carries goes on one (preferredFor).
func preferred_for(carry: Carry) -> Array[Transform3D]:
	var out: Array[Transform3D] = []
	for host: String in bonds.poses:
		if carry.has(host):
			continue
		var at := bonds.poses[host]
		out.append_array(FitRank.preferred_poses(relatives, type_of(host), at, type_of(carry.part)))
		for member: String in carry.riders:
			if not is_panel(member):
				continue
			for pose: Transform3D in FitRank.preferred_poses(relatives, type_of(host), at, type_of(member)):
				out.append(FitRank.preferred_through(pose, carry.riders[member], carry.start))
	return out


## The seat on offer with the carried part held at `pose` (snapCandidate): a panel's best whole
## fit, held against `current` (hysteresis); for anything else the nearest compatible free pair.
## Null when none, or when the seat would hold it through the floor or a wall.
func snap_candidate(carry: Carry, pose: Transform3D, current: Offer, exclude: Dictionary[String, bool] = {}) -> Offer:
	var seats := seats_for(carry, exclude)
	if is_panel(carry.part):
		return FitRank.held_offer(current, fit_candidate(carry, pose, seats), pose)
	var dragged := bonds.free_connectors(carry.part)
	var moved: Array[Snap.WorldConnector] = []
	var seated := Tools.seated_hardware(bonds)
	for c: Snap.WorldConnector in dragged:
		if not Tools.is_seat_target(c, seated):
			continue
		var local := connector_local(c)
		moved.append(Snap.in_world(c.type, local.position, local.axis, pose, c.part, c.index))
	var best: Snap.Offer = null
	for from: Snap.WorldConnector in moved:
		for to: Snap.WorldConnector in seats:
			if gating and not allows(from, to):
				continue
			var one := Snap.find_snap(_one(from), _one(to), Constants.SNAP.maxDistance, Constants.SNAP.maxAngle, data.compatible)
			if one != null and (best == null or one.distance < best.distance or (one.distance == best.distance and one.angle < best.angle)):
				best = one
	if best == null:
		return null
	var offer := Offer.new()
	offer.pose = Snap.apply_transform(best.transform, pose)
	if not Assist.fits_room(offer.pose, data.type_of(data.instance(carry.part)).size):
		return null
	offer.pairs.append(_pair(best.from, best.to, carry.part))
	offer.key = _key(best.from, best.to)
	return offer


## A carried panel's best whole fit on `seats` with it at `pose`, where it goes first, kept in the
## room; `accept(key, preferred)` narrows which fits it takes (fitCandidate).
func fit_candidate(carry: Carry, pose: Transform3D, seats: Array[Snap.WorldConnector], accept: Callable = Callable()) -> Offer:
	var allowed := Callable()
	if gating:
		allowed = allows
	var fits := PanelFit.find_fits(carried_connectors(carry, pose), pose, seats, PanelFit.FitWindow.panel(), data.compatible, allowed)
	for ranked: FitRank.Ranked in FitRank.rank_fits(fits, preferred_for(carry)):
		var key := _fit_key(ranked.fit)
		if accept.is_valid() and not bool(accept.call(key, ranked.preferred)):
			continue
		if not _carry_fits_room(carry, ranked.fit.pose):
			continue
		var offer := Offer.new()
		offer.pose = ranked.fit.pose
		if ranked.preferred and _spin_free(ranked.fit):
			offer.pose = _spun_where_it_goes(ranked.fit, pose, carry)
		offer.key = key
		offer.preferred = ranked.preferred
		for p: PanelFit.Pair in ranked.fit.pairs:
			offer.pairs.append(_pair(p.hole, p.end, carry.part, carry))
		return offer
	return null


## The bolt a cam's recess would catch now: the nearest screwed bolt head within captureRadius, any
## bolt, or "" (the router's crankContext, capture over screwedHeads).
func captured_for(joint: Bonds.Joint) -> String:
	if joint.kind != Fastener.CAM:
		return ""
	var heads: Dictionary[String, Vector3] = {}
	for bolt: Bonds.Joint in bonds.screwed_bolts():
		var connectors := data.type_of(data.instance(bolt.hardware)).connectors
		for i: int in connectors.size():
			if connectors[i].type == "hexSocket":
				heads[bolt.hardware] = bonds.world_connector(bolt.hardware, i).position
	return Tools.capture(bonds.world_connector(joint.host, joint.host_connector).position, heads)


## True when a fit's pairs all lie on one line along their axis: nothing in them sets its spin
## about that axis (a plinth on one dowel).
static func _spin_free(fit: PanelFit.Fit) -> bool:
	var first := fit.pairs[0].end
	for p: PanelFit.Pair in fit.pairs:
		var off := p.end.position - first.position
		if (off - first.axis * off.dot(first.axis)).length() > Constants.PANEL.matchTolerance:
			return false
	return true


## A spin-free fit where it goes (not in the web: there it seats at whatever spin the panel had,
## up to PANEL.matchAngle off, since magnetism stops once the fit is where it goes): the spin taken
## from where it goes, the seed pair still seated where the fit seats it.
func _spun_where_it_goes(fit: PanelFit.Fit, pose: Transform3D, carry: Carry) -> Transform3D:
	var best: Transform3D = fit.pose
	var best_turn := INF
	for p: Transform3D in preferred_for(carry):
		var turn := p.basis.get_rotation_quaternion().angle_to(fit.pose.basis.get_rotation_quaternion())
		if turn < best_turn:
			best_turn = turn
			best = p
	if best_turn > Constants.PANEL.matchAngle:
		return fit.pose
	var hole := fit.pairs[0].hole
	var landed := fit.transform * hole.position
	var local := pose.affine_inverse() * hole.position
	return Transform3D(best.basis, landed - best.basis * local)


## A panel's fit on offer as it stands at release, searched again from where the panel is held:
## the same pairs if they are still there, else as many of them as still line up (never a pair it
## did not offer, and where it goes only if it was), else none (settled).
func settled(carry: Carry, held: Transform3D, offer: Offer, exclude: Dictionary[String, bool] = {}) -> Offer:
	if not is_panel(carry.part):
		return offer
	var seats := seats_for(carry, exclude)
	var same := fit_candidate(carry, held, seats, func(key: String, _preferred: bool) -> bool: return key == offer.key)
	if same != null:
		return same
	var offered := offer.key.split(",")
	return fit_candidate(carry, held, seats, func(key: String, preferred: bool) -> bool:
		for pair: String in key.split(","):
			if not offered.has(pair):
				return false
		return preferred or not offer.preferred)


## Lets go on an offer: the carried parts are already at its pose (the router moved them); every
## pair is seated and named. Returns the joints.
func seat(offer: Offer, carried: Dictionary[String, bool] = {}) -> Array[Bonds.Joint]:
	var out: Array[Bonds.Joint] = []
	for p: Pair in offer.pairs:
		var joint := bonds.seat(p.a, p.a_index, p.b, p.b_index, p.mover)
		if joint != null:
			out.append(joint)
	name_seats(out, carried)
	return out


## Names `fresh` seats for the export's joints they are (the booklet itself goes by type, but the
## names say which instance is which). When a seat is not exactly the manual's, a part of the
## moving side is re-expressed by one of its symmetries (a horizontal turned end for end) or swaps
## names with another of its type, and the hardware seated in it takes the names the manual gives
## those holes; the first relabeling that names every fresh seat without unnaming one is kept.
## Nothing physical changes.
func name_seats(fresh: Array[Bonds.Joint], carried: Dictionary[String, bool] = {}) -> void:
	var named := _name_all()
	if _all_named(fresh):
		return
	# A loose piece of hardware in a hole the manual gives another of its type takes that one's name
	# (a dowel is a dowel).
	for joint: Bonds.Joint in fresh:
		if joint.spec >= 0 or bonds.joints_of(joint.hardware).size() != 1:
			continue
		for i: int in data.joints.size():
			var s := data.joints[i]
			if s.host == joint.host and s.host_connector == joint.host_connector and bonds.joint_for_spec(i) == null and _loose_alike(s.hardware, joint.hardware):
				bonds.swap_ids(joint.hardware, s.hardware)
				break
	named = _name_all()
	if _all_named(fresh):
		return
	# Only what moved is relabeled: the build it seated on keeps its names.
	var movers: Dictionary[String, bool] = {}
	for joint: Bonds.Joint in fresh:
		if carried.is_empty():
			movers[joint.mover] = true
	for id: String in carried:
		movers[id] = true
	for id: String in movers.keys():
		if not is_panel(id):
			movers.erase(id)
	for panel: String in movers:
		var others: Array[String] = [panel]
		for inst: ItemData.Instance in data.box():
			if inst.type == type_of(panel) and inst.id != panel and not others.has(inst.id):
				others.append(inst.id)
		for as_name: String in others:
			var syms: Array = [null]
			syms.append_array(bonds.symmetries(type_of(panel)))
			for sym: Variant in syms:
				if as_name == panel and sym == null:
					continue
				var saved := _snapshot()
				var at := panel
				if as_name != panel:
					bonds.swap_ids(panel, as_name)
					at = as_name
				if sym != null:
					bonds.apply_symmetry(at, sym as Bonds.Symmetry)
				_rename_hardware_in(at)
				if as_name != panel:
					_rename_hardware_in(panel)
				var now := _name_all()
				if now >= named + _unnamed(fresh) and _all_named(fresh):
					return
				_restore(saved)
	_name_all()


## True when `named` (the manual's) and `seated` are the same type and `named` is in no seat.
func _loose_alike(named: String, seated: String) -> bool:
	return named != seated and type_of(named) == type_of(seated) and bonds.joints_of(named).is_empty()


## Every joint named afresh by exact match; returns how many are named.
func _name_all() -> int:
	for joint: Bonds.Joint in bonds.joints:
		joint.spec = -1
	var n := 0
	for joint: Bonds.Joint in bonds.joints:
		for i: int in data.joints.size():
			var s := data.joints[i]
			if s.host == joint.host and s.host_connector == joint.host_connector and s.hardware == joint.hardware and bonds.joint_for_spec(i) == null:
				joint.spec = i
				n += 1
				break
	return n


func _all_named(fresh: Array[Bonds.Joint]) -> bool:
	for joint: Bonds.Joint in fresh:
		if bonds.joints.has(joint) and joint.spec < 0:
			return false
	return true


func _unnamed(fresh: Array[Bonds.Joint]) -> int:
	var n := 0
	for joint: Bonds.Joint in fresh:
		if joint.spec < 0:
			n += 1
	return n


## The hardware in `panel`'s holes takes the names the manual gives those holes.
func _rename_hardware_in(panel: String) -> void:
	for joint: Bonds.Joint in bonds.joints_of(panel).duplicate():
		if joint.host != panel:
			continue
		for s: ItemData.JointSpec in data.joints:
			if s.host == panel and s.host_connector == joint.host_connector and type_of(s.hardware) == type_of(joint.hardware):
				bonds.swap_ids(joint.hardware, s.hardware)
				break


## The graph's names and poses, to put back.
func _snapshot() -> Dictionary:
	var rows: Array = []
	for joint: Bonds.Joint in bonds.joints:
		rows.append([joint, joint.hardware, joint.hardware_connector, joint.host, joint.host_connector, joint.mover, joint.through, joint.captured, joint.spec])
	return {"poses": bonds.poses.duplicate(), "rows": rows}


func _restore(saved: Dictionary) -> void:
	bonds.poses.assign(saved["poses"])
	for row: Array in saved["rows"]:
		var joint: Bonds.Joint = row[0]
		joint.hardware = row[1]
		joint.hardware_connector = row[2]
		joint.host = row[3]
		joint.host_connector = row[4]
		joint.mover = row[5]
		joint.through = row[6]
		joint.captured = row[7]
		joint.spec = row[8]


## Gated: whether connector `a` may seat on `b`: the pair, by type, is one the open page still
## wants (either way round; any part of the type the page names stands in for it).
func allows(a: Snap.WorldConnector, b: Snap.WorldConnector) -> bool:
	var hardware := a if data.compatible.has(a.type) else b
	var host := b if hardware == a else a
	if Tools.is_tool_tip(hardware.type):
		var step := steps.current()
		return step != null and type_of(hardware.part) == step.tool
	return steps.wants(Steps.key(type_of(host.part), host.index, type_of(hardware.part)), bonds)


func connector_local(c: Snap.WorldConnector) -> ItemData.Connector:
	return bonds.connector_of(c.part, c.index)


## The carried part that moves for a pair: a panel's hole is the panel's; a carried piece of
## hardware's end, the carried panel it sits in; lone hardware moves itself (moverOf).
func _pair(from: Snap.WorldConnector, to: Snap.WorldConnector, dragged: String, carry: Carry = null) -> Pair:
	var p := Pair.new()
	p.a = from.part
	p.a_index = from.index
	p.b = to.part
	p.b_index = to.index
	p.mover = from.part
	if carry != null and not is_panel(from.part):
		for joint: Bonds.Joint in bonds.joints_of(from.part):
			if joint.hardware == from.part and carry.has(joint.host):
				p.mover = joint.host
				break
	elif from.part != dragged and carry == null:
		p.mover = dragged
	return p


## The carried set fits in the room at the dragged part's `pose`.
func _carry_fits_room(carry: Carry, pose: Transform3D) -> bool:
	for id: String in [carry.part] + carry.riders.keys():
		if not Assist.fits_room(carry.pose_of(id, pose), data.type_of(data.instance(id)).size):
			return false
	return true


static func _key(a: Snap.WorldConnector, b: Snap.WorldConnector) -> String:
	return "%s#%d>%s#%d" % [a.part, a.index, b.part, b.index]


static func _fit_key(fit: PanelFit.Fit) -> String:
	var keys: PackedStringArray = []
	for p: PanelFit.Pair in fit.pairs:
		keys.append(_key(p.hole, p.end))
	keys.sort()
	return ",".join(keys)


static func _one(c: Snap.WorldConnector) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = [c]
	return out


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
	while not steps.is_done() and steps.advance(bonds, is_placed, build_basis):
		open_page()


# --- panels laid in -----------------------------------------------------------------------


## How the build stands: the move taking the finished item onto the build as it lies now, read off
## the part it hangs together on.
func build_frame() -> Transform3D:
	var ref := _anchor()
	return bonds.poses[ref] * assembled(ref).affine_inverse()


func build_basis() -> Basis:
	return build_frame().basis


## Where a part of `id`'s type goes in the build as it stands: each finished place of its type.
func places_of(id: String) -> Array[Transform3D]:
	var frame := build_frame()
	var out: Array[Transform3D] = []
	for inst: ItemData.Instance in data.instances:
		if inst.type == type_of(id):
			out.append(Bonds.orthonormal(frame * assembled(inst.id)))
	return out


## True when `id` lies at one of its type's places in the build, within PLACE_REACH and PLACE_TURN
## (either way round, for a part that is the same turned).
func is_placed(id: String) -> bool:
	if not bonds.poses.has(id):
		return false
	var pose := bonds.poses[id]
	for place: Transform3D in places_of(id):
		if pose.origin.distance_to(place.origin) > PLACE_REACH:
			continue
		var turns: Array[Basis] = [place.basis]
		for sym: Bonds.Symmetry in bonds.symmetries(type_of(id)):
			turns.append(place.basis * sym.turn.inverse())
		for b: Basis in turns:
			if pose.basis.get_rotation_quaternion().angle_to(b.get_rotation_quaternion()) <= PLACE_TURN:
				return true
	return false


## The page's panels still to lay in, each with where the hand puts it: its type's free place
## nearest it.
func unplaced() -> Dictionary[String, Transform3D]:
	var out: Dictionary[String, Transform3D] = {}
	var step := steps.current()
	if step == null or steps.is_auto(step):
		return out
	var taken: Array[Transform3D] = []
	for id: String in steps.laid_in(step):
		if is_placed(id):
			continue
		for place: Transform3D in places_of(id):
			var free := true
			for other: String in bonds.poses:
				if other != id and type_of(other) == type_of(id) and bonds.poses[other].origin.distance_to(place.origin) <= PLACE_REACH:
					free = false
			for t: Transform3D in taken:
				if t.origin.distance_to(place.origin) <= PLACE_REACH:
					free = false
			if free:
				out[id] = place
				taken.append(place)
				break
	return out


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
## instance from its assembled pose, in the build's own frame (the room position and heading are
## the player's), and which. A piece of hardware's turn is its end axis's.
func worst_error(built_only: bool = false) -> Dictionary:
	var worst := {"offset": 0.0, "turn": 0.0, "offset_id": "", "turn_id": ""}
	var built := bonds.compound(_anchor(), false)
	# Measured in the build's own frame: where it stands in the room is the player's.
	var frame := build_frame().affine_inverse()
	for inst: ItemData.Instance in data.instances:
		if built_only and not built.has(inst.id):
			continue
		if not bonds.poses.has(inst.id):
			return {"offset": INF, "turn": INF, "offset_id": inst.id, "turn_id": inst.id}
		var pose := Bonds.orthonormal(frame * bonds.poses[inst.id])
		var offset := pose.origin.distance_to(inst.position)
		var turn := pose.basis.get_rotation_quaternion().angle_to(inst.rotation)
		if is_hardware(inst.id):
			# A fastener is round about its end's axis (snapMath straightens only the axis), so
			# its turn is how far that axis is off.
			var axis := data.type_of(inst).connectors[0].axis
			turn = (pose.basis * axis).angle_to(Basis(inst.rotation) * axis)
			# A part whose two ends are alike (a dowel) is the same either way round.
			for sym: Bonds.Symmetry in bonds.symmetries(inst.type):
				if (sym.turn * axis).dot(axis) < -0.5:
					turn = minf(turn, PI - turn)
					break
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
		if step.pose == "parts":
			if not bonds.poses.has(id):
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
	var moving_named := spec.hardware if moving == hardware and moving_ref == id and is_hardware(id) else moving_ref
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


