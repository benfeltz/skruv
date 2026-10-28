extends SceneTree
## The project's entry point, in place of a main scene: `godot --path godot -s res://main.gd`.
## User args (after `--`): `--assembled` stands the finished JOHNNY (2.0.4.2's build) instead of
## the build; `--autoplay` has the loop play the manual itself; `--shots=<dir>` saves its PNGs there
## and quits when done; `--gating` turns Constants.knobs.pageGating on (2.0.4.3's page-gated snap).


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.has("--gating"):
		Constants.knobs.pageGating = true
	var world := World.new()
	world.name = "World"
	world.start_assembled = args.has("--assembled")
	world.autoplay = args.has("--autoplay")
	for arg: String in args:
		if arg.begins_with("--shots="):
			world.shots = arg.trim_prefix("--shots=")
	root.add_child(world)
