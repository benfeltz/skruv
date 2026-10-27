@tool
class_name Stillness
extends RefCounted
## One measurement of how still the item is, against its assembled pose (Item.pose_of, so the compound control reads the same way): the fastest body, the
## farthest any body sits from its assembled position, the largest turn away from its assembled
## rotation, how many bodies sleep, and the lowest point of any body. Reads bodies, moves nothing.

var time_s: float
var max_speed: float
var max_angular_speed: float
var max_offset: float
var max_turn_deg: float
var asleep: int
var bodies: int
var lowest_y: float


static func measure(item: Item, time_s: float) -> Stillness:
	var s := Stillness.new()
	s.time_s = time_s
	s.lowest_y = INF
	for inst: ItemData.Instance in item.data.instances:
		var body: RigidBody3D = item.bodies[inst.id]
		var pose := item.pose_of(inst.id)
		var basis := pose.basis
		s.bodies += 1
		if body.sleeping:
			s.asleep += 1
		s.max_speed = maxf(s.max_speed, body.linear_velocity.length())
		s.max_angular_speed = maxf(s.max_angular_speed, body.angular_velocity.length())
		s.max_offset = maxf(s.max_offset, pose.origin.distance_to(inst.position))
		var turn := rad_to_deg(basis.get_rotation_quaternion().angle_to(inst.rotation))
		s.max_turn_deg = maxf(s.max_turn_deg, turn)
		s.lowest_y = minf(s.lowest_y, pose.origin.y - _half_height(basis, item.data.type_of(inst).size))
	return s


## Half the vertical extent of a box of `size` turned by `basis`.
static func _half_height(basis: Basis, size: Vector3) -> float:
	var row := Vector3(basis.x.y, basis.y.y, basis.z.y)
	return (absf(row.x) * size.x + absf(row.y) * size.y + absf(row.z) * size.z) / 2.0


func all_asleep() -> bool:
	return asleep == bodies


func line() -> String:
	return "stillness: t=%.2fs speed=%.5fm/s spin=%.5frad/s offset=%.2fmm turn=%.3fdeg asleep=%d/%d lowest=%.2fmm" % [
		time_s, max_speed, max_angular_speed, max_offset * 1000.0, max_turn_deg, asleep, bodies, lowest_y * 1000.0]


## One line per body farther than `max_offset` from its assembled position or turned more than
## `max_turn_deg` from its assembled rotation: which parts moved, and how far.
static func movers(item: Item, max_offset: float, max_turn_deg: float) -> PackedStringArray:
	var out: PackedStringArray = []
	for inst: ItemData.Instance in item.data.instances:
		var pose := item.pose_of(inst.id)
		var offset := pose.origin.distance_to(inst.position)
		var turn := rad_to_deg(pose.basis.get_rotation_quaternion().angle_to(inst.rotation))
		if offset > max_offset or turn > max_turn_deg:
			out.append("moved: %s offset=%.1fmm turn=%.2fdeg dy=%.1fmm" % [inst.id, offset * 1000.0, turn, (pose.origin.y - inst.position.y) * 1000.0])
	return out
