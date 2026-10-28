extends GdUnitTestSuite
## scenes/world.tscn is a container: its file holds the World node and nothing else, and JOHNNY
## is inserted at runtime from items/johnny.json, never stored in the scene: as the build by
## default, or standing with `start_assembled`.

const SCENE_PATH := "res://scenes/world.tscn"


func test_scene_file_holds_only_the_world_node() -> void:
	var scene: PackedScene = load(SCENE_PATH)
	var state := scene.get_state()
	assert_int(state.get_node_count()).is_equal(1)
	assert_str(String(state.get_node_type(0))).is_equal("Node3D")


func test_the_loop_arrives_at_runtime_with_the_box_laid_out() -> void:
	var world := auto_free((load(SCENE_PATH) as PackedScene).instantiate()) as World
	assert_object(world).is_not_null()
	add_child(world)
	var data := ItemData.load_file(ItemData.JOHNNY_PATH)
	assert_object(world.room).is_not_null()
	assert_object(world.item).is_null()
	assert_object(world.loop).is_not_null()
	# The whole box: the assembled parts, the spares and the tools.
	assert_int(world.loop.bodies.size()).is_equal(data.box().size())
	# The web's open snap (pageGating off, the default): the whole box is out from the start.
	assert_bool(world.loop.play.gating).is_false()
	for id: String in world.loop.bodies:
		assert_bool(world.loop.bodies[id].visible).override_failure_message("%s not shown" % id).is_true()


func test_johnny_stands_at_runtime_from_the_export_when_asked() -> void:
	var world := auto_free((load(SCENE_PATH) as PackedScene).instantiate()) as World
	world.start_assembled = true
	add_child(world)
	var data := ItemData.load_file(ItemData.JOHNNY_PATH)
	assert_int(world.item.bodies.size()).is_equal(data.instances.size())
	assert_object(world.loop).is_null()
