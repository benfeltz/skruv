@tool
class_name World
extends Node3D
## The room with the dowel loop inserted at runtime (scenes/loop.gd), or with `start_assembled`
## the finished item dropped into it, as 2.0.4.2 had it. With the finished item it prints a
## Stillness line once a second (fastest body, farthest offset from the assembled pose, largest
## turn, bodies asleep, lowest point), so any run's log shows whether the item settles.
##
## @tool so scenes/world.tscn shows the room and JOHNNY in the editor's viewport too: the editor
## runs _ready() and builds both from code and items/johnny.json, as the game does. Nothing it
## builds is owned by the scene, so none of it is ever saved into the .tscn. Physics and the
## stillness log run only in the game.

## Stand the finished JOHNNY up (2.0.4.2's stillness build) instead of playing the dowel loop.
## The editor always shows the standing build: the loop runs only in the game.
@export var start_assembled := false
## The loop plays the manual itself (scenes/loop.gd autoplay), saving its shots in `shots`.
var autoplay := false
var shots := ""

var room: Room
## The standing build, when start_assembled (or in the editor).
var item: Item
## The dowel loop, otherwise.
var loop: Loop
var _ticks := 0


func _ready() -> void:
	if not Engine.is_editor_hint():
		print("world: physics engine %s, %d Hz" % [ProjectSettings.get_setting("physics/3d/physics_engine"), Engine.physics_ticks_per_second])
	room = Room.new()
	room.name = "Room"
	add_child(room)
	if start_assembled or Engine.is_editor_hint():
		item = Item.new()
		item.name = "Item"
		add_child(item)
		if not Engine.is_editor_hint():
			print("world: %d bodies, %d joints" % [item.bodies.size(), item.joints.size()])
		return
	loop = Loop.new(null, autoplay, shots)
	loop.name = "Loop"
	add_child(loop)


func _physics_process(_delta: float) -> void:
	if Engine.is_editor_hint() or item == null:
		return
	_ticks += 1
	if _ticks % Engine.physics_ticks_per_second == 0:
		print(Stillness.measure(item, float(_ticks) / Engine.physics_ticks_per_second).line())
