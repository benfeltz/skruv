class_name Item
extends Node3D
## The item built from ItemData: one RigidBody3D (box shape and box mesh) per assembled instance
## at its assembled pose, lifted DROP_HEIGHT off the floor, and one locked Generic6DOFJoint3D per
## joint the exporter lists (plus one to the joint's `through` panel and its `captured` bolt).
## Every number about the item comes from the data; this file only turns records into nodes.
##
## Collisions follow the web build (src/physics/world.ts): hardware seated in a hole collides
## with nothing, since it sits inside the wood; a shelf pin stays solid so a shelf rests on it.

## How far above its assembled pose the whole item starts, so it drops onto the floor.
const DROP_HEIGHT := 0.02
## The one fastener kind whose hardware stays solid once seated (a shelf rests on it).
const SOLID_KIND := "pin"

var data: ItemData
var bodies: Dictionary[String, RigidBody3D] = {}
var joints: Array[Generic6DOFJoint3D] = []


func _init(item_data: ItemData = null) -> void:
	data = item_data


func _ready() -> void:
	if data == null:
		data = ItemData.load_file(ItemData.JOHNNY_PATH)
	var embedded := _embedded_hardware()
	for inst: ItemData.Instance in data.instances:
		var body := _make_body(inst, data.type_of(inst))
		if embedded.has(inst.id):
			body.collision_layer = 0
			body.collision_mask = 0
		bodies[inst.id] = body
		add_child(body)
	for spec: ItemData.JointSpec in data.joints:
		_lock(spec.host, spec.hardware, spec.position)
		if spec.through != "":
			_lock(spec.through, spec.hardware, spec.position)
		if spec.captured != "":
			_lock(spec.hardware, spec.captured, spec.position)


## Hardware that sits inside wood once seated: every jointed hardware instance not of SOLID_KIND.
func _embedded_hardware() -> Dictionary[String, bool]:
	var out: Dictionary[String, bool] = {}
	for spec: ItemData.JointSpec in data.joints:
		if spec.kind != SOLID_KIND:
			out[spec.hardware] = true
	return out


## A joint with every axis locked, anchored at `at` (world, at the assembled pose plus the drop).
func _lock(a: String, b: String, at: Vector3) -> void:
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
	body.mass = part.mass
	var shape := BoxShape3D.new()
	shape.size = part.size
	var collider := CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	var box := BoxMesh.new()
	box.size = part.size
	var mesh := MeshInstance3D.new()
	mesh.mesh = box
	var material := StandardMaterial3D.new()
	material.albedo_color = part.color
	mesh.material_override = material
	body.add_child(mesh)
	return body
