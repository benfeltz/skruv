class_name Hello
extends Node3D
## The trivial scene that proves the loop: a floor, a box, a camera and a light,
## built in _ready() with no .tscn.

const FLOOR_SIZE := Vector2(6.0, 6.0)
const FLOOR_COLOR := Color(0.82, 0.71, 0.55)
const BOX_SIZE := Vector3(1.0, 1.0, 1.0)
const BOX_COLOR := Color(0.15, 0.35, 0.85)
const CAMERA_POSITION := Vector3(3.0, 2.5, 4.0)
const LIGHT_ROTATION_DEG := Vector3(-50.0, 35.0, 0.0)


func _ready() -> void:
	add_child(_make_floor())
	add_child(_make_box())
	add_child(_make_light())
	add_child(_make_camera())


func _make_floor() -> MeshInstance3D:
	var plane := PlaneMesh.new()
	plane.size = FLOOR_SIZE
	var node := MeshInstance3D.new()
	node.name = "Floor"
	node.mesh = plane
	node.material_override = _flat(FLOOR_COLOR)
	return node


func _make_box() -> MeshInstance3D:
	var box := BoxMesh.new()
	box.size = BOX_SIZE
	var node := MeshInstance3D.new()
	node.name = "Box"
	node.mesh = box
	node.material_override = _flat(BOX_COLOR)
	node.position = Vector3(0.0, BOX_SIZE.y / 2.0, 0.0)
	return node


func _make_light() -> DirectionalLight3D:
	var node := DirectionalLight3D.new()
	node.name = "Sun"
	node.rotation_degrees = LIGHT_ROTATION_DEG
	node.shadow_enabled = true
	return node


func _make_camera() -> Camera3D:
	var node := Camera3D.new()
	node.name = "Camera"
	node.look_at_from_position(CAMERA_POSITION, Vector3.ZERO)
	node.current = true
	return node


func _flat(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	return material
