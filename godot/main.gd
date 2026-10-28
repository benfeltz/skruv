extends SceneTree
## The project's entry point, in place of a main scene: `godot --path godot -s res://main.gd`.
## User args (after `--`): `--assembled` stands the finished JOHNNY (2.0.4.2's build) instead of
## the dowel loop; `--autoplay` has the loop play the manual itself; `--shots=<dir>` saves its
## PNGs there and quits when done.


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var world := World.new()
	world.name = "World"
	world.start_assembled = args.has("--assembled")
	world.autoplay = args.has("--autoplay")
	for arg: String in args:
		if arg.begins_with("--shots="):
			world.shots = arg.trim_prefix("--shots=")
	root.add_child(world)
