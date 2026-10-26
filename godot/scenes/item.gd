class_name Item
extends Node3D
## The item built from ItemData: one RigidBody3D (box shape and box mesh) per assembled instance
## at its assembled pose, lifted DROP_HEIGHT off the floor, and one locked Generic6DOFJoint3D per
## joint the exporter lists (plus one to the joint's `through` panel and its `captured` bolt).
## Every number about the item comes from the data; this file only turns records into nodes.
##
## With `compound` it is instead one RigidBody3D carrying every part's shape and mesh, no joints:
## the control for the jointed build (tuning attempt 3, step 5).
##
## Collisions follow the web build (src/physics/world.ts): hardware seated in a hole collides
## with nothing, since it sits inside the wood; a shelf pin stays solid so a shelf rests on it.

## How far above its assembled pose the whole item starts, so it drops onto the floor.
const DROP_HEIGHT := 0.02
## The one fastener kind whose hardware stays solid once seated (a shelf rests on it).
const SOLID_KIND := "pin"
## Tuning attempt 2 (step 5): anchor each joint midway between its two parts' centres instead
## of at the hole. False anchors at the hole.
const ANCHOR_AT_MIDPOINT := true
## Tuning attempt 5 (step 5, beyond the plan): no body simulates lighter than this (kg), as in the
## web build (PHYSICS.minBodyMass, src/constants.ts), whose Rapier joints went soft the same way:
## a 1 g pin under a 2 kg shelf. The data keeps the true masses.
const MIN_BODY_MASS := 0.2

var data: ItemData
var compound: bool
## The body each instance rides on: its own, or the one compound body.
var bodies: Dictionary[String, RigidBody3D] = {}
## Each instance's pose in its body's frame: identity for its own body.
var local: Dictionary[String, Transform3D] = {}
var joints: Array[Generic6DOFJoint3D] = []


func _init(item_data: ItemData = null, as_compound: bool = false) -> void:
	data = item_data
	compound = as_compound


func _ready() -> void:
	if data == null:
		data = ItemData.load_file(ItemData.JOHNNY_PATH)
	var embedded := _embedded_hardware()
	if compound:
		_build_compound(embedded)
		return
	for inst: ItemData.Instance in data.instances:
		var body := _make_body(inst, data.type_of(inst))
		if embedded.has(inst.id):
			body.collision_layer = 0
			body.collision_mask = 0
		bodies[inst.id] = body
		local[inst.id] = Transform3D.IDENTITY
		add_child(body)
	for spec: ItemData.JointSpec in data.joints:
		_lock(spec.host, spec.hardware, spec.position)
		if spec.through != "":
			_lock(spec.through, spec.hardware, spec.position)
		if spec.captured != "":
			_lock(spec.hardware, spec.captured, spec.position)


## The mass a part simulates with: its own, floored at MIN_BODY_MASS.
static func sim_mass(part: ItemData.PartType) -> float:
	return maxf(part.mass, MIN_BODY_MASS)


## An instance's world pose now.
func pose_of(id: String) -> Transform3D:
	return bodies[id].global_transform * local[id]


## Every part on one body at its assembled pose, raised by the drop; embedded hardware is drawn
## but has no shape, as it collides with nothing in the jointed build either.
func _build_compound(embedded: Dictionary[String, bool]) -> void:
	var body := RigidBody3D.new()
	body.name = "Compound"
	body.position = Vector3(0.0, DROP_HEIGHT, 0.0)
	var mass := 0.0
	for inst: ItemData.Instance in data.instances:
		var part := data.type_of(inst)
		var at := Transform3D(Basis(inst.rotation), inst.position)
		mass += part.mass
		if not embedded.has(inst.id):
			var collider := _make_collider(part)
			collider.transform = at
			body.add_child(collider)
		var mesh := _make_mesh(part)
		mesh.transform = at
		body.add_child(mesh)
		bodies[inst.id] = body
		local[inst.id] = at
	body.mass = mass
	add_child(body)


## Hardware that sits inside wood once seated: every jointed hardware instance not of SOLID_KIND.
func _embedded_hardware() -> Dictionary[String, bool]:
	var out: Dictionary[String, bool] = {}
	for spec: ItemData.JointSpec in data.joints:
		if spec.kind != SOLID_KIND:
			out[spec.hardware] = true
	return out


## A joint with every axis locked, anchored at `hole` (world, at the assembled pose), or midway
## between the two parts with ANCHOR_AT_MIDPOINT; raised by the drop.
func _lock(a: String, b: String, hole: Vector3) -> void:
	var at := hole
	if ANCHOR_AT_MIDPOINT:
		at = (data.instance(a).position + data.instance(b).position) / 2.0
	var joint := Generic6DOFJoint3D.new()
	joint.name = "%s~%s" % [a, b]
	joint.position = at + Vector3(0.0, DROP_HEIGHT, 0.0)
	for axis: String in ["x", "y", "z"]:
		joint.set("linear_limit_%s/enabled" % axis, true)
		joint.set("linear_limit_%s/upper_distance" % axis, 0.0)
		joint.set("linear_limit_%s/lower_distance" % axis, 0.0)
		joint.set("angular_limit_%s/enabled" % axis, true)
		joint.set("angular_limit_%s/upper_angle" % axis, 0.0)
		joint.set("angular_limit_%s/lower_angle" % axis, 0.0)
	add_child(joint)
	joint.node_a = joint.get_path_to(bodies[a])
	joint.node_b = joint.get_path_to(bodies[b])
	joints.append(joint)

## Where an instance starts: its assembled pose, raised by the drop.
static func start_transform(inst: ItemData.Instance) -> Transform3D:
	return Transform3D(Basis(inst.rotation), inst.position + Vector3(0.0, DROP_HEIGHT, 0.0))


func _make_body(inst: ItemData.Instance, part: ItemData.PartType) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.name = inst.id
	body.transform = start_transform(inst)
	body.mass = sim_mass(part)
	body.add_child(_make_collider(part))
	body.add_child(_make_mesh(part))
	return body


func _make_collider(part: ItemData.PartType) -> CollisionShape3D:
	var shape := BoxShape3D.new()
	shape.size = part.size
	var collider := CollisionShape3D.new()
	collider.shape = shape
	return collider


func _make_mesh(part: ItemData.PartType) -> MeshInstance3D:
	var box := BoxMesh.new()
	box.size = part.size
	var mesh := MeshInstance3D.new()
	mesh.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = part.color
	mesh.material_override = material
	return mesh
