class_name World
extends Node3D
## The room with the item standing in it.

var room: Room
var item: Item


func _ready() -> void:
	room = Room.new()
	room.name = "Room"
	add_child(room)
	item = Item.new()
	item.name = "Item"
	add_child(item)
