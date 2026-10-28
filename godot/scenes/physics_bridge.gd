class_name PhysicsBridge
extends Node3D
## Physics as you build: the role of the web's src/physics/world.ts (and the compound seam the
## router drives it through). Every part in the box is a Jolt body. Each physics tick the router
## (logic/router.gd `kinematic`) says which are held: those follow their poses as kinematic bodies;
## every other part is the simulation's, and its pose is read back into the build (Play's poses),
## so the logic sees where it really is. A pose the logic moved since the last tick (a press pushing
## a panel home, a seat) is put on the body at once. Fastened joints become physics joints from
## Bonds.bonds() as the graph changes, rebuilt only when a bond's signature does: every mode a
## locked Generic6DOFJoint3D, since FASTENER.angularPlayDegrees is 0 (the web's 'play' is then a
## fixed joint too); embedded hardware collides with nothing while it is embedded, a shelf pin
## stays solid.
##
## The step is Godot's fixed physics tick (physics/common/physics_ticks_per_second, 60 Hz, the
## web's PHYSICS.timestep): Godot already runs whole fixed steps, so the web's accumulator
## (src/physics/stepping.ts) is the engine's own here.
##
## Tuning (step 7): `MIN_BODY_MASS` is the web's PHYSICS.minBodyMass, off (0) until an attempt
## turns it on.

## No body simulates lighter than this (kg); 0 keeps the true masses (the 2.0.4.2 setting).
const MIN_BODY_MASS := 0.0
## A pose the logic moved by more than this since the bridge last wrote it is put on the body.
const MOVED_M := 1e-7

var play: Play
var router: Router
var bodies: Dictionary[String, RigidBody3D] = {}
var joints: Dictionary[String, Generic6DOFJoint3D] = {}
var _signatures: Dictionary[String, String] = {}
var _last: Dictionary[String, Transform3D] = {}


func _init(r: Router) -> void:
	router = r
	play = r.play
	name = "PhysicsBridge"
	router.physics = true


func _ready() -> void:
	for inst: ItemData.Instance in play.data.box():
		var part := play.data.type_of(inst)
		var body := RigidBody3D.new()
		body.name = inst.id
		body.mass = maxf(part.mass, MIN_BODY_MASS)
		body.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		body.freeze = true
		body.visible = false
		body.collision_layer = 0
		body.collision_mask = 0
		body.add_child(Item.make_collider(part))
		body.add_child(Item.make_mesh(part))
		bodies[inst.id] = body
		add_child(body)


func _physics_process(_delta: float) -> void:
	sync()


## One tick's hand-over: dynamic poses read back (or put on the body, if the logic moved them),
## every body held or let go, then the physics joints brought in line with the graph.
func sync() -> void:
	var poses := play.bonds.poses
	for id: String in bodies:
		var body := bodies[id]
		if not poses.has(id) or body.freeze or not _last.has(id):
			continue
		if poses[id].origin.distance_to(_last[id].origin) > MOVED_M or not poses[id].basis.is_equal_approx(_last[id].basis):
			_teleport(body, poses[id])
		else:
			poses[id] = Bonds.orthonormal(body.global_transform)
	var held := router.kinematic()
	var embedded := _embedded()
	for id: String in bodies:
		var body := bodies[id]
		var posed := poses.has(id)
		body.visible = posed
		if not posed:
			body.freeze = true
			body.collision_layer = 0
			body.collision_mask = 0
			continue
		var solid := not embedded.has(id)
		body.collision_layer = 1 if solid else 0
		body.collision_mask = 1 if solid else 0
		var kinematic := held.has(id)
		if kinematic:
			body.freeze = true
			body.global_transform = poses[id]
		elif body.freeze:
			# Let go: back to the simulation at rest, so it drops rather than flies.
			body.global_transform = poses[id]
			body.freeze = false
			body.linear_velocity = Vector3.ZERO
			body.angular_velocity = Vector3.ZERO
		_last[id] = poses[id]
	# Joints last: Godot takes each body's frame from where it stands when the joint is made, so the
	# bodies first take the poses the logic gave them (a dowel just pressed home).
	_reconcile()


func _teleport(body: RigidBody3D, pose: Transform3D) -> void:
	body.global_transform = pose
	body.linear_velocity = Vector3.ZERO
	body.angular_velocity = Vector3.ZERO


## Hardware an embed bond holds: inside the wood, it collides with nothing.
func _embedded() -> Dictionary[String, bool]:
	var out: Dictionary[String, bool] = {}
	for bond: Bonds.Bond in play.bonds.bonds():
		if bond.mode == "embed":
			out[bond.b] = true
	return out


## The physics joints the graph calls for, made and unmade as bonds come and go (reconcile).
func _reconcile() -> void:
	var wanted: Dictionary[String, Bonds.Bond] = {}
	for bond: Bonds.Bond in play.bonds.bonds():
		wanted[bond.key] = bond
	for key: String in joints.keys():
		var next: Bonds.Bond = wanted.get(key)
		if next != null and next.signature == _signatures[key] and _ends(joints[key]) == [next.a, next.b]:
			continue
		joints[key].queue_free()
		joints.erase(key)
		_signatures.erase(key)
	for key: String in wanted:
		if joints.has(key):
			continue
		var bond := wanted[key]
		joints[key] = _lock(bond)
		_signatures[key] = bond.signature


func _ends(joint: Generic6DOFJoint3D) -> Array[String]:
	var out: Array[String] = [String(joint.get_meta("a")), String(joint.get_meta("b"))]
	return out


## A joint with every axis locked at the bond's pivot, holding the two bodies as they are now
## (Godot takes each body's frame from where they stand when the joint is made).
func _lock(bond: Bonds.Bond) -> Generic6DOFJoint3D:
	var joint := Generic6DOFJoint3D.new()
	joint.name = bond.key.replace(":", "_").replace("|", "~")
	joint.set_meta("a", bond.a)
	joint.set_meta("b", bond.b)
	joint.position = play.bonds.poses[bond.b] * bond.pivot
	for axis: String in ["x", "y", "z"]:
		joint.set("linear_limit_%s/enabled" % axis, true)
		joint.set("linear_limit_%s/upper_distance" % axis, 0.0)
		joint.set("linear_limit_%s/lower_distance" % axis, 0.0)
		joint.set("angular_limit_%s/enabled" % axis, true)
		joint.set("angular_limit_%s/upper_angle" % axis, 0.0)
		joint.set("angular_limit_%s/lower_angle" % axis, 0.0)
	add_child(joint)
	joint.node_a = joint.get_path_to(bodies[bond.a])
	joint.node_b = joint.get_path_to(bodies[bond.b])
	return joint


## How far the build has moved since `from` (poses by id): the largest offset (m) and turn (rad)
## of any assembled part, and which.
func moved_since(from: Dictionary[String, Transform3D]) -> Dictionary:
	var worst := {"offset": 0.0, "turn": 0.0, "offset_id": "", "turn_id": ""}
	for inst: ItemData.Instance in play.data.instances:
		var now := bodies[inst.id].global_transform
		var offset := now.origin.distance_to(from[inst.id].origin)
		var turn := now.basis.get_rotation_quaternion().angle_to(from[inst.id].basis.get_rotation_quaternion())
		if offset > float(worst["offset"]):
			worst["offset"] = offset
			worst["offset_id"] = inst.id
		if turn > float(worst["turn"]):
			worst["turn"] = turn
			worst["turn_id"] = inst.id
	return worst


## Every assembled part's body pose now.
func snapshot() -> Dictionary[String, Transform3D]:
	var out: Dictionary[String, Transform3D] = {}
	for inst: ItemData.Instance in play.data.instances:
		out[inst.id] = bodies[inst.id].global_transform
	return out


## Bodies asleep, of the assembled parts.
func asleep() -> int:
	var n := 0
	for inst: ItemData.Instance in play.data.instances:
		if bodies[inst.id].sleeping:
			n += 1
	return n
