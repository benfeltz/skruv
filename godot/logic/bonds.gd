class_name Bonds
extends RefCounted
## The assembly graph for the loop: what is seated in what, every part's pose, and the bonds
## the fastened joints call for. The slice of src/game/assembly.ts the dowel loop needs (seat,
## apply, tap, seatHome, relativePose, carryPose, bonds), plus the poses the web keeps on its
## physics bodies. Pure: part ids and connector indices in, records out; poses are Transform3D.
##
## A joint is one seated connector pair, `hardware` the fastener-end side and `host` the hole
## side, with its Fastener machine. `mover` is the part dragged into the seat: its side is the
## one a press pushes home (a dowel into its hole, a panel down onto its dowels).
##
## The web's bonds() bridges two hosts with angular play while only dowels hold them;
## FASTENER.angularPlayDegrees is 0, so every bond here is rigid: a locked joint between the
## hardware and each host, the 2.0.4.2 shape.


class Joint:
	var id: int
	## The export's joint this seat is, or -1 for a pair the item never makes.
	var spec: int
	var hardware: String
	var hardware_connector: int
	var host: String
	var host_connector: int
	var kind: String
	var mover: String
	var fastener: Fastener
	## A fitting's far panel and a cam's bolt, from the export (auto-fastened kinds only).
	var through: String
	var captured: String


## A rigid physics joint the graph calls for: `b` held at `frame` in `a`'s frame.
class Bond:
	var a: String
	var b: String
	var frame: Transform3D


var data: ItemData
var poses: Dictionary[String, Transform3D] = {}
var joints: Array[Joint] = []
var _next_id := 1


func _init(item_data: ItemData) -> void:
	data = item_data


## Seats connector `hardware_connector` of `hardware` in `host_connector` of `host`. Moves
## nothing: the caller has put the parts at the seat. Returns the joint.
func seat(hardware: String, hardware_connector: int, host: String, host_connector: int, mover: String, spec: int = -1) -> Joint:
	var joint := Joint.new()
	joint.id = _next_id
	_next_id += 1
	joint.spec = spec
	joint.hardware = hardware
	joint.hardware_connector = hardware_connector
	joint.host = host
	joint.host_connector = host_connector
	joint.kind = data.kinds[_connector(hardware, hardware_connector).type]
	joint.mover = mover
	joint.fastener = Fastener.create(joint.kind)
	joints.append(joint)
	return joint


## The seat the export's joint `spec` is in, or null.
func joint_for_spec(spec: int) -> Joint:
	for joint: Joint in joints:
		if joint.spec == spec:
			return joint
	return null


## Feeds `event` to a joint's machine. A tap kind's pose follows its state: pressed, the mover's
## side is pushed in until the end sits its sink depth down the hole; pulled, back to the mouth.
## True if the machine changed.
func apply(joint: Joint, event: String) -> bool:
	var next := Fastener.transition(joint.fastener, event)
	if next == joint.fastener:
		return false
	joint.fastener = next
	_follow(joint)
	return true


## A tap on `part` pushes home every seated tap-kind joint touching it, or carried in by it (a
## panel tapped down onto its dowels, or carried in on them: the web's tap and pressCarried).
## Returns the joints that changed.
func tap(part: String) -> Array[Joint]:
	var members := compound(part, true)
	var out: Array[Joint] = []
	for joint: Joint in joints:
		var touching := joint.hardware == part or joint.host == part
		var carried := members.has(joint.mover) and not (members.has(joint.hardware) and members.has(joint.host))
		if (touching or carried) and Fastener.is_tap_kind(joint.kind) and apply(joint, Fastener.TAP):
			out.append(joint)
	return out


## Seats each pair and drives it home by the event a player's hands send (seatHome; one tap for
## a tap kind). Returns the joints.
func seat_home(pairs: Array[Dictionary]) -> Array[Joint]:
	var out: Array[Joint] = []
	for p: Dictionary in pairs:
		var joint := seat(p["hardware"], p["hardware_connector"], p["host"], p["host_connector"], p["mover"], p.get("spec", -1))
		apply(joint, Fastener.TAP)
		out.append(joint)
	return out


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
		poses[id] = _orthonormal(delta * poses[id])


## `b`'s pose in `a`'s frame (relativePose).
func relative_pose(a: String, b: String) -> Transform3D:
	return poses[a].affine_inverse() * poses[b]


## Where `pose` ends up when what it is rigidly attached to moves from `from` to `to` (carryPose).
static func carry_pose(from: Transform3D, to: Transform3D, pose: Transform3D) -> Transform3D:
	return _orthonormal(to * (from.affine_inverse() * pose))


## The hardware's pose in its host's frame with its end `sink` deep down the hole, turned
## straight into it (seatedPose / restPoseAt).
func seated_pose(joint: Joint, sink: float) -> Transform3D:
	var h := _connector(joint.hardware, joint.hardware_connector)
	var o := _connector(joint.host, joint.host_connector)
	var current := relative_pose(joint.host, joint.hardware).basis.get_rotation_quaternion()
	var rotation := (Snap.rotation_between(current * h.axis, -o.axis) * current).normalized()
	var target := o.position - o.axis * sink
	return Transform3D(Basis(rotation), target - rotation * h.position)


## How deep a joint's end sits down its hole now (m, along the hole's axis).
func depth(joint: Joint) -> float:
	var hole := world_connector(joint.host, joint.host_connector)
	var end := world_connector(joint.hardware, joint.hardware_connector)
	return (hole.position - end.position).dot(hole.axis)


## The physics joints the fastened pairs call for: each piece of fastened hardware locked to its
## host, and to a fitting's far panel and a cam's bolt, at the poses they hold now.
func bonds() -> Array[Bond]:
	var out: Array[Bond] = []
	for joint: Joint in joints:
		if not Fastener.is_fastened(joint.fastener):
			continue
		out.append(_bond(joint.host, joint.hardware))
		if joint.through != "":
			out.append(_bond(joint.through, joint.hardware))
		if joint.captured != "":
			out.append(_bond(joint.hardware, joint.captured))
	return out


## A connector of `part` in world space at its pose now.
func world_connector(part: String, index: int) -> Snap.WorldConnector:
	var c := _connector(part, index)
	return Snap.in_world(c.type, c.position, c.axis, poses[part], part, index)


## Every connector of `part` no joint uses, in world space (a filled hole and an end already in
## one take no second).
func free_connectors(part: String) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	var connectors := data.type_of(data.instance(part)).connectors
	for i: int in connectors.size():
		if not is_taken(part, i):
			out.append(world_connector(part, i))
	return out


func is_taken(part: String, index: int) -> bool:
	for joint: Joint in joints:
		if (joint.hardware == part and joint.hardware_connector == index) or (joint.host == part and joint.host_connector == index):
			return true
	return false


func is_seated(part: String) -> bool:
	for joint: Joint in joints:
		if joint.hardware == part or joint.host == part or joint.through == part or joint.captured == part:
			return true
	return false


## Swaps two loose instances of one type: each takes the other's pose. A dowel is a dowel; the
## one the player picked becomes the one the manual names.
func swap(a: String, b: String) -> void:
	var pose := poses[a]
	poses[a] = poses[b]
	poses[b] = pose


func _bond(a: String, b: String) -> Bond:
	var bond := Bond.new()
	bond.a = a
	bond.b = b
	bond.frame = relative_pose(a, b)
	return bond


func _connector(part: String, index: int) -> ItemData.Connector:
	return data.type_of(data.instance(part)).connectors[index]


## A tap kind's pose follows its machine: the mover's side (and what is fastened to it) slides
## along the hole's axis until the end sits sink × progress deep. Nothing moves when that side
## is already held to the other through other fastened joints (a panel's second dowel, pressed
## by the first one's push).
func _follow(joint: Joint) -> void:
	var want: float = data.sink_depth.get(joint.kind, 0.0) * joint.fastener.progress
	var delta := want - depth(joint)
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


static func _orthonormal(t: Transform3D) -> Transform3D:
	return Transform3D(Basis(t.basis.get_rotation_quaternion().normalized()), t.origin)
