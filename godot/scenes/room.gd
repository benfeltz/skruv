class_name Room
extends Node3D
## A bare room: a floor that bodies land on, three walls, a sun, ambient light and a camera
## framing the item at the origin. Built in _ready(); no .tscn. The room's own sizes live here;
## the item's never do.

const FLOOR_SIZE := Vector2(5.0, 5.0)
const FLOOR_THICKNESS := 0.1
const WALL_HEIGHT := 2.6
const WALL_THICKNESS := 0.1
const FLOOR_COLOR := Color(0.62, 0.48, 0.34)
const WALL_COLOR := Color(0.86, 0.84, 0.80)
const SKY_COLOR := Color(0.55, 0.62, 0.72)
const AMBIENT_COLOR := Color(0.85, 0.85, 0.9)
const AMBIENT_ENERGY := 0.45
const SUN_ROTATION_DEG := Vector3(-55.0, 30.0, 0.0)
const SUN_ENERGY := 1.1
const CAMERA_POSITION := Vector3(1.4, 1.4, 2.3)
const CAMERA_TARGET := Vector3(0.0, 0.95, 0.0)
const CAMERA_FOV := 60.0


func _ready() -> void:
	add_child(_make_floor())
	var half := FLOOR_SIZE / 2.0
	add_child(_make_wall("BackWall", Vector3(0.0, WALL_HEIGHT / 2.0, -half.y - WALL_THICKNESS / 2.0), Vector3(FLOOR_SIZE.x, WALL_HEIGHT, WALL_THICKNESS)))
	add_child(_make_wall("LeftWall", Vector3(-half.x - WALL_THICKNESS / 2.0, WALL_HEIGHT / 2.0, 0.0), Vector3(WALL_THICKNESS, WALL_HEIGHT, FLOOR_SIZE.y)))
	add_child(_make_wall("RightWall", Vector3(half.x + WALL_THICKNESS / 2.0, WALL_HEIGHT / 2.0, 0.0), Vector3(WALL_THICKNESS, WALL_HEIGHT, FLOOR_SIZE.y)))
	add_child(_make_sun())
	add_child(_make_environment())
	add_child(_make_camera())


## The floor's top face is y = 0.
func _make_floor() -> StaticBody3D:
	return _make_slab("Floor", Vector3(0.0, -FLOOR_THICKNESS / 2.0, 0.0), Vector3(FLOOR_SIZE.x, FLOOR_THICKNESS, FLOOR_SIZE.y), FLOOR_COLOR)


func _make_wall(wall_name: String, at: Vector3, size: Vector3) -> StaticBody3D:
	return _make_slab(wall_name, at, size, WALL_COLOR)


func _make_slab(slab_name: String, at: Vector3, size: Vector3, color: Color) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = slab_name
	body.position = at
	var shape := BoxShape3D.new()
	shape.size = size
	var collider := CollisionShape3D.new()
	collider.shape = shape
	body.add_child(collider)
	var box := BoxMesh.new()
	box.size = size
	var mesh := MeshInstance3D.new()
	mesh.mesh = box
	mesh.material_override = _flat(color)
	body.add_child(mesh)
	return body


func _make_sun() -> DirectionalLight3D:
	var node := DirectionalLight3D.new()
	node.name = "Sun"
	node.rotation_degrees = SUN_ROTATION_DEG
	node.light_energy = SUN_ENERGY
	node.shadow_enabled = true
	return node


func _make_environment() -> WorldEnvironment:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = SKY_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = AMBIENT_COLOR
	env.ambient_light_energy = AMBIENT_ENERGY
	var node := WorldEnvironment.new()
	node.name = "Environment"
	node.environment = env
	return node


func _make_camera() -> Camera3D:
	var node := Camera3D.new()
	node.name = "Camera"
	node.fov = CAMERA_FOV
	node.look_at_from_position(CAMERA_POSITION, CAMERA_TARGET)
	node.current = true
	return node


static func _flat(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	return material
