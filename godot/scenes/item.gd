class_name Item
extends Node3D
## The item built from ItemData: one RigidBody3D (box shape and box mesh) per assembled instance
## at its assembled pose, lifted DROP_HEIGHT off the floor. Every number about the item comes
## from the data; this file only knows how to turn a record into a body.

## How far above its assembled pose the whole item starts, so it drops onto the floor.
const DROP_HEIGHT := 0.02

var data: ItemData
var bodies: Dictionary[String, RigidBody3D] = {}


func _init(item_data: ItemData = null) -> void:
	data = item_data


func _ready() -> void:
	if data == null:
		data = ItemData.load_file(ItemData.JOHNNY_PATH)
	for inst: ItemData.Instance in data.instances:
		var body := _make_body(inst, data.type_of(inst))
		bodies[inst.id] = body
		add_child(body)


## Where an instance starts: its assembled pose, raised by the drop.
static func start_transform(inst: ItemData.Instance) -> Transform3D:
	return Transform3D(Basis(inst.rotation), inst.position + Vector3(0.0, DROP_HEIGHT, 0.0))


func _make_body(inst: ItemData.Instance, part: ItemData.PartType) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.name = inst.id
	body.transform = start_transform(inst)
	body.mass = part.mass
	body.freeze = true
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
