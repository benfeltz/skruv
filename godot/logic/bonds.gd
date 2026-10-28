class_name Bonds
extends RefCounted
## The assembly graph: what is seated in what, every part's pose, and the physics bonds the
## fastened joints call for. The port of src/game/assembly.ts (createAssembly whole, minus the
## stud's hand turns and the slide, which JOHNNY has none of), plus the poses the web keeps on its
## physics bodies. Pure: part ids and connector indices in, records out; poses are Transform3D.
##
## A joint is one seated connector pair, normalised so `hardware` is the fastener-end side and
## `host` the hole side, with its Fastener machine. `mover` is the part dragged into the seat.
## There is no notion of a correct assembly here: any type-compatible seated pair fastens.
## `spec` names the export's joint a seat is, when it is one (logic/play.gd names them; a pair
## the item never makes is -1).
##
## bonds() is the web's: each fastened piece of hardware embeds in its first host (a shelf pin is
## rigid, so a shelf can rest on it), and two hosts sharing fastened hardware are bridged, with
## angular play while only dowels hold them (FASTENER.angularPlayDegrees, 0) and rigid once a cam
## locks or a screw drives home.


class Joint:
	var id: int
	var spec: int = -1
	var hardware: String
	var hardware_connector: int
	var host: String
	var host_connector: int
	var kind: String
	var mover: String
	var fastener: Fastener
	## A pressed back fitting's far panel; a locked cam's caught bolt ("" none).
	var through: String = ""
	var captured: String = ""
	## Put in by the loop on a page it fastens itself (until every kind is played).
	var auto: bool = false


## A physics joint the graph calls for (the web's Bond): `b` held at `frame` in `a`'s frame,
## `mode` embed (b collides with nothing), rigid, or play (angular play about `pivot`, b-local).
class Bond:
	var key: String
	var a: String
	var b: String
	var mode: String
	var frame: Transform3D
	var pivot: Vector3
	var signature: String


## A turn a gesture on a part makes (the web's Turn, the tool grip only: JOHNNY turns nothing by
## hand): the tool's joint, the joints it turns, and the part and connector it turns about, with
## which way along that connector's axis a tightening turn is clockwise seen.
class Turn:
	var tool: Joint
	var joints: Array[Joint] = []
	var part: String
	var connector: int
	var sense: int = -1


var data: ItemData
var poses: Dictionary[String, Transform3D] = {}
var joints: Array[Joint] = []
var _next_id := 1


func _init(item_data: ItemData) -> void:
	data = item_data


func connector_of(part: String, index: int) -> ItemData.Connector:
	return data.type_of(data.instance(part)).connectors[index]


## Seats connector `ca` of `a` on connector `cb` of `b`, either way round; returns the joint. Moves
## nothing: the caller has put the parts at the seat.
func seat(a: String, ca: int, b: String, cb: int, mover: String, spec: int = -1) -> Joint:
	var ta := connector_of(a, ca).type
	var tb := connector_of(b, cb).type
	var joint := Joint.new()
	if data.compatible.get(ta, "") == tb:
		joint.hardware = a
		joint.hardware_connector = ca
		joint.host = b
		joint.host_connector = cb
	elif data.compatible.get(tb, "") == ta:
		joint.hardware = b
		joint.hardware_connector = cb
		joint.host = a
		joint.host_connector = ca
	else:
		push_error("Bonds: %s does not seat on %s" % [ta, tb])
		return null
	joint.id = _next_id
	_next_id += 1
	joint.spec = spec
	joint.kind = data.kinds[connector_of(joint.hardware, joint.hardware_connector).type]
	joint.mover = mover
	joint.fastener = Fastener.create(joint.kind)
	joints.append(joint)
	return joint


func unseat(joint: Joint) -> void:
	joints.erase(joint)


## The seat the export's joint `spec` is in, or null.
func joint_for_spec(spec: int) -> Joint:
	for joint: Joint in joints:
		if joint.spec == spec:
			return joint
	return null


## Every joint `part` is the hardware or host of (jointsOf).
func joints_of(part: String) -> Array[Joint]:
	var out: Array[Joint] = []
	for joint: Joint in joints:
		if joint.hardware == part or joint.host == part:
			out.append(joint)
	return out


## True when a locked cam holds this bolt's head (isHeld).
func is_held(bolt: String) -> bool:
	for joint: Joint in joints:
		if joint.kind == Fastener.CAM and joint.fastener.state == Fastener.LOCKED and joint.captured == bolt:
			return true
	return false


## The part a bolt is screwed into, or "".
func screwed_host(bolt: String) -> String:
	for joint: Joint in joints:
		if joint.hardware == bolt and joint.kind == Fastener.BOLT and Fastener.is_fastened(joint.fastener):
			return joint.host
	return ""


## Screwed bolts: the only heads a cam can catch.
func screwed_bolts() -> Array[Joint]:
	var out: Array[Joint] = []
	for joint: Joint in joints:
		if joint.kind == Fastener.BOLT and Fastener.is_fastened(joint.fastener):
			out.append(joint)
	return out


## Feeds `event` to a joint's machine (apply). `captured` is the bolt a cam's recess would catch
## ("" none) and `through` the part behind a back fitting, from the caller's geometry. The pose of
## the mover's side follows the machine (_follow). True if it changed.
func apply(joint: Joint, event: String, radians: float = 0.0, captured: String = "", through: String = "") -> bool:
	var held := joint.kind == Fastener.BOLT and is_held(joint.hardware)
	var next := Fastener.transition(joint.fastener, event, radians, captured != "", held)
	if next == joint.fastener:
		return false
	var was := joint.fastener
	joint.fastener = next
	if Fastener.passes_through(joint.kind):
		joint.through = "" if not Fastener.is_fastened(next) else joint.through if Fastener.is_fastened(was) else through
	if joint.kind == Fastener.CAM:
		joint.captured = (joint.captured if joint.captured != "" else captured) if next.state == Fastener.LOCKED else ""
	_follow(joint)
	return true


## The single event that takes a joint all the way home through the events a player's hands send:
## one tap, or one full turn (drive). True if it ended fastened.
func drive(joint: Joint, captured: String = "", through: String = "") -> bool:
	if Fastener.is_tap_kind(joint.kind):
		apply(joint, Fastener.TAP, 0.0, captured, through)
	elif Fastener.is_crank_kind(joint.kind):
		apply(joint, Fastener.CRANK, Fastener.span_of(joint.kind), captured, through)
	return Fastener.is_fastened(joint.fastener)


## A tap on `part` pushes home every seated tap-kind joint touching it (tap); `through_of(joint)`
## gives a back fitting's far panel. Returns the joints that changed.
func tap(part: String, through_of: Callable = Callable()) -> Array[Joint]:
	var out: Array[Joint] = []
	for joint: Joint in joints_of(part):
		if not Fastener.is_tap_kind(joint.kind):
			continue
		var through: String = String(through_of.call(joint)) if through_of.is_valid() else ""
		if apply(joint, Fastener.TAP, 0.0, "", through):
			out.append(joint)
	return out


## Fastened hardware's joints, in seat order (fastenedOf).
func _fastened_of(hardware: String) -> Array[Joint]:
	var out: Array[Joint] = []
	for joint: Joint in joints:
		if joint.hardware == hardware and Fastener.is_fastened(joint.fastener):
			out.append(joint)
	return out


## The hosts a piece of fastened hardware joins, its first (embedding) host first (hostsOf).
func hosts_of(hardware: String) -> Array[String]:
	var hosts: Array[String] = []
	for joint: Joint in _fastened_of(hardware):
		if not hosts.has(joint.host):
			hosts.append(joint.host)
		if joint.through != "" and not hosts.has(joint.through):
			hosts.append(joint.through)
		if joint.captured != "":
			var host := screwed_host(joint.captured)
			if host != "" and not hosts.has(host):
				hosts.append(host)
	return hosts


## True when a joint that binds rigidly ties hosts `a` and `b` (boundBetween).
func bound_between(a: String, b: String) -> bool:
	for joint: Joint in joints:
		if not Fastener.binds_rigidly(joint.fastener):
			continue
		var other := screwed_host(joint.captured) if joint.kind == Fastener.CAM else joint.through
		if (joint.host == a and other == b) or (joint.host == b and other == a):
			return true
	return false


## Fastened tap-kind joints `part` can be pulled out of: it was pushed into the seat, and no
## locked cam or screwed screw binds the connection (pullable).
func pullable(part: String) -> Array[Joint]:
	var out: Array[Joint] = []
	for joint: Joint in joints:
		if joint.mover != part or not Fastener.is_tap_kind(joint.kind) or not Fastener.is_fastened(joint.fastener):
			continue
		var bound := false
		for other: String in hosts_of(joint.hardware):
			if other != joint.host and bound_between(joint.host, other):
				bound = true
		if not bound:
			out.append(joint)
	return out


## True when every fastener on `part` is back to plain seated (canRelease).
func can_release(part: String) -> bool:
	var fasteners: Array[Fastener] = []
	for joint: Joint in joints_of(part):
		fasteners.append(joint.fastener)
	return Fastener.can_release(fasteners)


## The crank joint a tool on connector `seat` of `part` (a bolt head, a cam's slot) would turn,
## or null; a hex at an end that is itself in a hole is buried (turnedFrom).
func turned_from(part: String, seat_index: int) -> Joint:
	var at := connector_of(part, seat_index).position
	var turned: Joint = null
	for joint: Joint in joints:
		if joint.hardware != part or not Fastener.is_crank_kind(joint.kind):
			continue
		if connector_of(part, joint.hardware_connector).position.distance_to(at) <= Constants.FASTENER.mateTolerance:
			return null
		if turned == null:
			turned = joint
	return turned


## The other connectors of `part` at the very spot connector `index` is (coincident).
func coincident(part: String, index: int) -> Array[int]:
	var out: Array[int] = []
	var connectors := data.type_of(data.instance(part)).connectors
	var at := connectors[index].position
	for i: int in connectors.size():
		if i != index and connectors[i].position.distance_to(at) <= Constants.FASTENER.mateTolerance:
			out.append(i)
	return out


## The turn a gesture on `part` makes: a seated tool's (its joints empty when what it sits on has
## nothing to turn), or null (turnOf; JOHNNY has no hand turns).
func turn_of(part: String) -> Turn:
	for joint: Joint in joints:
		if joint.hardware == part and joint.kind == Fastener.TOOL:
			var turn := Turn.new()
			turn.tool = joint
			var target := turned_from(joint.host, joint.host_connector)
			if target != null:
				turn.joints.append(target)
			turn.part = joint.host
			turn.connector = joint.host_connector
			return turn
	return null


## Every seated tool's turn (turns).
func turns() -> Array[Turn]:
	var out: Array[Turn] = []
	for joint: Joint in joints:
		if joint.kind == Fastener.TOOL:
			out.append(turn_of(joint.hardware))
	return out


## The joints a turn moves now, tightening (1) or loosening (-1): its one while it has turn left
## (advancing).
static func advancing(turn: Turn, direction: int) -> Array[Joint]:
	var out: Array[Joint] = []
	for joint: Joint in turn.joints:
		if (joint.fastener.progress < 1.0) if direction > 0 else (joint.fastener.progress > 0.0):
			out.append(joint)
	return out


## Every part reachable from `part` through fastened joints, itself included (compoundOf), the
## web's edges: hardware to host, to a fitting's far panel and to a cam's caught bolt.
func compound_of(part: String) -> Dictionary[String, bool]:
	return compound(part, true)


## Every part joined to `part`, `part` included: through every joint, or only fastened ones.
func compound(part: String, fastened_only: bool) -> Dictionary[String, bool]:
	var seen: Dictionary[String, bool] = {part: true}
	var frontier: Array[String] = [part]
	while not frontier.is_empty():
		var at: String = frontier.pop_back()
		for joint: Joint in joints:
			if fastened_only and not Fastener.is_fastened(joint.fastener):
				continue
			var ends: Array[String] = [joint.hardware, joint.host]
			if joint.through != "":
				ends.append(joint.through)
			if joint.captured != "":
				ends.append(joint.captured)
			if not ends.has(at):
				continue
			for other: String in ends:
				if not seen.has(other):
					seen[other] = true
					frontier.append(other)
	return seen


## Moves `part` to `pose` and everything joined to it with it, rigidly.
func move_compound(part: String, pose: Transform3D, fastened_only: bool = false) -> void:
	var delta := pose * poses[part].affine_inverse()
	for id: String in compound(part, fastened_only):
		poses[id] = orthonormal(delta * poses[id])


## Moves every part in `members` by the rigid motion that takes `part` to `pose`.
func move_set(members: Dictionary[String, bool], part: String, pose: Transform3D) -> void:
	var delta := pose * poses[part].affine_inverse()
	for id: String in members:
		poses[id] = orthonormal(delta * poses[id])


## `b`'s pose in `a`'s frame (relativePose).
func relative_pose(a: String, b: String) -> Transform3D:
	return poses[a].affine_inverse() * poses[b]


## Where `pose` ends up when what it is rigidly attached to moves from `from` to `to` (carryPose).
static func carry_pose(from: Transform3D, to: Transform3D, pose: Transform3D) -> Transform3D:
	return orthonormal(to * (from.affine_inverse() * pose))


## The hardware's pose in its host's frame with its end `sink` deep down the hole, turned straight
## into it, its twist about the axis kept (seatedPose).
func seated_pose(joint: Joint, sink: float) -> Transform3D:
	var current := relative_pose(joint.host, joint.hardware).basis.get_rotation_quaternion()
	var h := connector_of(joint.hardware, joint.hardware_connector)
	var o := connector_of(joint.host, joint.host_connector)
	var rotation := (Snap.rotation_between(current * h.axis, -o.axis) * current).normalized()
	return rest_pose_at(joint, rotation, sink)


## The hardware's pose in its host's frame at `rotation`, its end `sink` deep (restPoseAt).
func rest_pose_at(joint: Joint, rotation: Quaternion, sink: float) -> Transform3D:
	var h := connector_of(joint.hardware, joint.hardware_connector)
	var o := connector_of(joint.host, joint.host_connector)
	var target := o.position - o.axis * sink
	return Transform3D(Basis(rotation), target - rotation * h.position)


## How deep a joint's end sits down its hole now (m, along the hole's axis).
func depth(joint: Joint) -> float:
	var hole := world_connector(joint.host, joint.host_connector)
	var end := world_connector(joint.hardware, joint.hardware_connector)
	return (hole.position - end.position).dot(hole.axis)


## How deep a joint's fastener sits in its hole by its machine (sinkOf); a cam turns in place, so
## until it locks it sits at the mouth.
func sink_of(joint: Joint) -> float:
	if joint.kind == Fastener.CAM and not Fastener.is_fastened(joint.fastener):
		return 0.0
	return data.sink_depth.get(joint.kind, 0.0) * joint.fastener.progress


## The physics joints the graph calls for, from the poses now (bonds): see the header. A bond
## whose signature is unchanged needs no rebuild.
func bonds() -> Array[Bond]:
	var out: Array[Bond] = []
	var bridges: Dictionary[String, Array] = {}
	var seen: Dictionary[String, bool] = {}
	for joint: Joint in joints:
		if not Fastener.is_fastened(joint.fastener) or seen.has(joint.hardware):
			continue
		var hardware := joint.hardware
		seen[hardware] = true
		var fastened := _fastened_of(hardware)
		var first := fastened[0]
		var sink := sink_of(first)
		var mode := "rigid" if first.kind == Fastener.PIN else "embed"
		var embed := Bond.new()
		embed.key = "embed:" + hardware
		embed.a = first.host
		embed.b = hardware
		embed.mode = mode
		embed.frame = seated_pose(first, sink)
		embed.pivot = connector_of(hardware, first.hardware_connector).position
		embed.signature = "%s|%d|%f" % [mode, first.id, sink]
		out.append(embed)
		var hosts := hosts_of(hardware)
		for n: int in range(1, hosts.size()):
			var other := hosts[n]
			var second: Joint = null
			for j: Joint in fastened:
				if j.host == other:
					second = j
			var bridge := Bond.new()
			bridge.a = first.host
			bridge.b = other
			if second != null and Fastener.is_tap_kind(first.kind) and Fastener.is_tap_kind(second.kind):
				# Through a dowel: each end sits its sink deep, so the hosts close up flush.
				var in_first := seated_pose(first, sink_of(first))
				var in_second := seated_pose(second, sink_of(second))
				bridge.frame = in_first * in_second.affine_inverse()
				bridge.pivot = connector_of(other, second.host_connector).position
				bridge.mode = "play"
				bridge.signature = "%d+%d" % [first.id, second.id]
			else:
				# A back fitting into what lies behind, a cam onto another host's bolt: as they are.
				bridge.frame = relative_pose(first.host, other)
				bridge.pivot = poses[other].affine_inverse() * world_connector(first.host, first.host_connector).position
				bridge.mode = "rigid" if Fastener.binds_rigidly(first.fastener) else "play"
				bridge.signature = "live"
			var key := pair_key(bridge.a, bridge.b)
			if not bridges.has(key):
				bridges[key] = []
			bridges[key].append(bridge)
	for key: String in bridges:
		var entries: Array = bridges[key]
		var chosen: Bond = entries[0]
		var rigid := false
		for e: Bond in entries:
			if e.signature != "live" and chosen.signature == "live":
				chosen = e
			if e.mode == "rigid":
				rigid = true
		var bond := Bond.new()
		bond.key = "bridge:" + key
		bond.a = chosen.a
		bond.b = chosen.b
		bond.mode = "rigid" if rigid else "play"
		bond.frame = chosen.frame
		bond.pivot = chosen.pivot
		bond.signature = "%s|%s" % [bond.mode, chosen.signature]
		out.append(bond)
	return out


static func pair_key(a: String, b: String) -> String:
	return "%s|%s" % [a, b] if a < b else "%s|%s" % [b, a]


## A connector of `part` in world space at its pose now.
func world_connector(part: String, index: int) -> Snap.WorldConnector:
	var c := connector_of(part, index)
	return Snap.in_world(c.type, c.position, c.axis, poses[part], part, index)


## Every connector of `part` no joint takes, in world space.
func free_connectors(part: String) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	var connectors := data.type_of(data.instance(part)).connectors
	for i: int in connectors.size():
		if not is_taken(part, i):
			out.append(world_connector(part, i))
	return out


## True when a joint takes the connector, or one at its very spot (occupied: a filled hole, an end
## already in one, a head with a tool on it).
func is_taken(part: String, index: int) -> bool:
	for joint: Joint in joints:
		if joint.hardware == part and (joint.hardware_connector == index or coincident(part, joint.hardware_connector).has(index)):
			return true
		if joint.host == part and (joint.host_connector == index or coincident(part, joint.host_connector).has(index)):
			return true
	return false


func is_seated(part: String) -> bool:
	for joint: Joint in joints:
		if joint.hardware == part or joint.host == part or joint.through == part or joint.captured == part:
			return true
	return false


## Swaps two parts' names everywhere (poses and joints): two instances of one type are the same
## part, so this changes nothing physical. The picked part takes the name the manual gives it.
func swap_ids(a: String, b: String) -> void:
	if a == b:
		return
	var pa: Variant = poses.get(a)
	var pb: Variant = poses.get(b)
	poses.erase(a)
	poses.erase(b)
	if pa != null:
		poses[b] = pa
	if pb != null:
		poses[a] = pb
	for joint: Joint in joints:
		joint.hardware = _swapped(joint.hardware, a, b)
		joint.host = _swapped(joint.host, a, b)
		joint.mover = _swapped(joint.mover, a, b)
		joint.through = _swapped(joint.through, a, b)
		joint.captured = _swapped(joint.captured, a, b)


static func _swapped(id: String, a: String, b: String) -> String:
	return b if id == a else a if id == b else id


## The physics joints the 2.0.4.3 build stood on at "done": every piece of fastened hardware locked
## to its host and to a fitting's far panel and a cam's bolt (kept until physics joins the build).
func locks() -> Array[Bond]:
	var out: Array[Bond] = []
	for joint: Joint in joints:
		if not Fastener.is_fastened(joint.fastener):
			continue
		out.append(_lock(joint.host, joint.hardware))
		if joint.through != "":
			out.append(_lock(joint.through, joint.hardware))
		if joint.captured != "":
			out.append(_lock(joint.hardware, joint.captured))
	return out


func _lock(a: String, b: String) -> Bond:
	var bond := Bond.new()
	bond.a = a
	bond.b = b
	bond.mode = "rigid"
	bond.frame = relative_pose(a, b)
	return bond


## The mover's side follows the machine: it slides along the hole's axis until the end sits
## sink_of deep. Nothing moves when that side is already held to the other through other fastened
## joints (a panel's second dowel, pressed by the first one's push).
func _follow(joint: Joint) -> void:
	var delta := sink_of(joint) - depth(joint)
	if absf(delta) < 1e-9:
		return
	var axis := world_connector(joint.host, joint.host_connector).axis
	# Each side as fastened to the rest, the joint's own edge left out.
	var saved := joint.fastener
	joint.fastener = Fastener.create(joint.kind)
	var hardware_side := compound(joint.hardware, true)
	var host_side := compound(joint.host, true)
	joint.fastener = saved
	if hardware_side.has(joint.host):
		return
	var host_moves := host_side.has(joint.mover) and not hardware_side.has(joint.mover)
	var members := host_side if host_moves else hardware_side
	var shift := axis * delta if host_moves else -axis * delta
	for id: String in members:
		poses[id] = Transform3D(poses[id].basis, poses[id].origin + shift)


static func orthonormal(t: Transform3D) -> Transform3D:
	return Transform3D(Basis(t.basis.get_rotation_quaternion().normalized()), t.origin)
