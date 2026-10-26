extends SceneTree
## Compile check: loads every project script and exits 1 if any fails to compile.
## `godot --check-only` prints parse errors but exits 0 on 4.7.2, so it can't gate the loop.
## Run: godot --headless --path godot -s res://scripts/check.gd --quit-after 300
## Prints "check: ok" on success; loop.sh requires that line, so a hang or crash never passes.

const SKIP_DIRS: PackedStringArray = ["res://.godot", "res://addons"]


func _initialize() -> void:
	# Never reload this file: replacing the running script's bytecode crashes the VM.
	var own_path: String = (get_script() as Script).resource_path
	var scripts: PackedStringArray = []
	_collect("res://", scripts)
	var failed: PackedStringArray = []
	for path: String in scripts:
		if path == own_path:
			continue
		# load() returns a non-null script even when it fails to compile; can_instantiate() is the test.
		var script := ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE) as GDScript
		if script == null or not script.can_instantiate():
			failed.append(path)
	if failed.is_empty():
		print("check: ok, %d scripts compile" % scripts.size())
		quit(0)
	else:
		printerr("check: %d of %d scripts failed: %s" % [failed.size(), scripts.size(), ", ".join(failed)])
		quit(1)


func _collect(dir_path: String, out: PackedStringArray) -> void:
	if dir_path.trim_suffix("/") in SKIP_DIRS:
		return
	for file: String in DirAccess.get_files_at(dir_path):
		if file.get_extension() == "gd":
			out.append(dir_path.path_join(file))
	for sub: String in DirAccess.get_directories_at(dir_path):
		_collect(dir_path.path_join(sub), out)
