class_name World
extends Node3D
## The room with the item dropped into it. Once a second it prints a Stillness line (fastest
## body, farthest offset from the assembled pose, largest turn, bodies asleep, lowest point), so
## any run's log shows whether the item settles.

var room: Room
var item: Item
var _ticks := 0


func _ready() -> void:
	print("world: physics engine %s, %d Hz" % [ProjectSettings.get_setting("physics/3d/physics_engine"), Engine.physics_ticks_per_second])
	room = Room.new()
	room.name = "Room"
	add_child(room)
	item = Item.new()
	item.name = "Item"
	add_child(item)
	print("world: %d bodies, %d joints" % [item.bodies.size(), item.joints.size()])


func _physics_process(_delta: float) -> void:
	_ticks += 1
	if _ticks % Engine.physics_ticks_per_second == 0:
		print(Stillness.measure(item, float(_ticks) / Engine.physics_ticks_per_second).line())
