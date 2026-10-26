extends GdUnitTestSuite
## The room builds its floor, three walls, sun, environment and camera; the floor's top is y = 0.


func test_room_has_its_parts() -> void:
	var room: Room = auto_free(Room.new())
	add_child(room)
	for child_name: String in ["Floor", "BackWall", "LeftWall", "RightWall"]:
		assert_object(room.get_node(child_name)).is_instanceof(StaticBody3D)
	assert_object(room.get_node("Sun")).is_instanceof(DirectionalLight3D)
	assert_object(room.get_node("Environment")).is_instanceof(WorldEnvironment)
	assert_object(room.get_node("Camera")).is_instanceof(Camera3D)


func test_floor_top_is_zero() -> void:
	var room: Room = auto_free(Room.new())
	add_child(room)
	var floor_body := room.get_node("Floor") as StaticBody3D
	assert_float(floor_body.position.y + Room.FLOOR_THICKNESS / 2.0).is_equal_approx(0.0, 1e-6)
