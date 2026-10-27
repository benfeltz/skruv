extends SceneTree
## The project's entry point, in place of a main scene: `godot --path godot -s res://main.gd`.


func _initialize() -> void:
	var world := World.new()
	world.name = "World"
	root.add_child(world)
