extends GdUnitTestSuite
## scenes/world.tscn is a container: its file holds the World node and nothing else, and JOHNNY
## is inserted at runtime from items/johnny.json, never stored in the scene.

const SCENE_PATH := "res://scenes/world.tscn"


func test_scene_file_holds_only_the_world_node() -> void:
	var scene: PackedScene = load(SCENE_PATH)
	var state := scene.get_state()
	assert_int(state.get_node_count()).is_equal(1)
	assert_str(String(state.get_node_type(0))).is_equal("Node3D")


func test_johnny_arrives_at_runtime_from_the_export() -> void:
	var world := auto_free((load(SCENE_PATH) as PackedScene).instantiate()) as World
	assert_object(world).is_not_null()
	add_child(world)
	var data := ItemData.load_file(ItemData.JOHNNY_PATH)
	assert_int(world.item.bodies.size()).is_equal(data.instances.size())
	assert_object(world.room).is_not_null()
