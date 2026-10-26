extends GdUnitTestSuite
## Headless: godot --headless --path godot -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd --ignoreHeadlessMode -a res://test


func test_hello_builds_four_children() -> void:
	var hello: Hello = auto_free(Hello.new())
	add_child(hello)
	assert_int(hello.get_child_count()).is_equal(4)


func test_hello_has_floor_box_sun_camera() -> void:
	var hello: Hello = auto_free(Hello.new())
	add_child(hello)
	assert_object(hello.get_node("Floor")).is_instanceof(MeshInstance3D)
	assert_object(hello.get_node("Box")).is_instanceof(MeshInstance3D)
	assert_object(hello.get_node("Sun")).is_instanceof(DirectionalLight3D)
	assert_object(hello.get_node("Camera")).is_instanceof(Camera3D)
