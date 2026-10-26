extends SceneTree
## The project's entry point, in place of a main scene: `godot --path godot -s res://main.gd`.


func _initialize() -> void:
	var room := Room.new()
	room.name = "Room"
	root.add_child(room)
