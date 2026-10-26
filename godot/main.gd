extends SceneTree
## The project's entry point, in place of a main scene: `godot --path godot -s res://main.gd`.


func _initialize() -> void:
	var hello := Hello.new()
	hello.name = "Hello"
	root.add_child(hello)
