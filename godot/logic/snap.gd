class_name Snap
extends RefCounted
## Connector snapping: the rigid transform that seats a dragged part's connector onto another
## part's. The port of src/game/snapMath.ts (findSnap, applyTransform). Pure: world-space
## connector records built by the caller, no nodes.
##
## Compatibility is type-level only (a dowel end fits a dowel hole), from the vocabulary the
## export carries (ItemData.compatible). Which instance mates with which is the caller's.
##
## A transform is a Transform3D: x ↦ basis·x + origin, the web's { rotation, translation }.


## A world-space connector, with the part and index it came from (the web's callers carry their
## own fields alongside; here they are fixed).
class WorldConnector:
	var type: String
	var position: Vector3
	var axis: Vector3
	var part: String
	var index: int

	func _init(t: String = "", p: Vector3 = Vector3.ZERO, a: Vector3 = Vector3.UP, part_id: String = "", i: int = -1) -> void:
		type = t
		position = p
		axis = a
		part = part_id
		index = i


## A snap on offer: the pair, how far apart and how skewed, and the transform that seats it.
class Offer:
	var from: WorldConnector
	var to: WorldConnector
	var distance: float
	var angle: float
	var transform: Transform3D


## True when an end of one type fits a hole of the other, either way round (vocabulary.ts areCompatible).
static func are_compatible(a: String, b: String, compatible: Dictionary[String, String]) -> bool:
	return compatible.get(a, "") == b or compatible.get(b, "") == a


## Angle between the dragged axis and the target's reversed axis (0 = seated head-on).
static func misalignment(a: Vector3, b: Vector3) -> float:
	return acos(clampf(-a.dot(b), -1.0, 1.0))


## Shortest rotation taking unit vector `from` onto unit vector `to` (geometry.ts rotationBetween,
## the same half-turn choice for opposite vectors).
static func rotation_between(from: Vector3, to: Vector3) -> Quaternion:
	var d := from.dot(to)
	if d < -1.0 + 1e-9:
		var ortho := from.cross(Vector3(1, 0, 0)) if absf(from.x) < 0.9 else from.cross(Vector3(0, 1, 0))
		ortho = ortho.normalized()
		return Quaternion(ortho.x, ortho.y, ortho.z, 0.0)
	var c := from.cross(to)
	return Quaternion(c.x, c.y, c.z, 1.0 + d).normalized()


## Best compatible pair within `max_distance` (m) and `max_angle` (rad) of axis anti-alignment,
## nearest first, then straightest, or null. The offer's transform carries `from` onto `to`
## with its axis reversed against `to`'s.
static func find_snap(dragged: Array[WorldConnector], others: Array[WorldConnector], max_distance: float, max_angle: float, compatible: Dictionary[String, String]) -> Offer:
	var best: Offer = null
	for from: WorldConnector in dragged:
		for to: WorldConnector in others:
			if not are_compatible(from.type, to.type, compatible):
				continue
			var distance := from.position.distance_to(to.position)
			if distance > max_distance:
				continue
			var angle := misalignment(from.axis, to.axis)
			if angle > max_angle:
				continue
			if best != null and (distance > best.distance or (distance == best.distance and angle >= best.angle)):
				continue
			best = Offer.new()
			best.from = from
			best.to = to
			best.distance = distance
			best.angle = angle
	if best == null:
		return null
	var rotation := rotation_between(best.from.axis, -best.to.axis)
	var basis := Basis(rotation)
	best.transform = Transform3D(basis, best.to.position - basis * best.from.position)
	return best


## A body pose carried by a snap transform (applyTransform): rotation composed on, re-normalised.
static func apply_transform(transform: Transform3D, pose: Transform3D) -> Transform3D:
	var moved := transform * pose
	return Transform3D(Basis(moved.basis.get_rotation_quaternion().normalized()), moved.origin)


## A part-local connector at a world pose (geometry.ts connectorInWorld).
static func in_world(type: String, local_position: Vector3, local_axis: Vector3, pose: Transform3D, part: String = "", index: int = -1) -> WorldConnector:
	return WorldConnector.new(type, pose * local_position, (pose.basis * local_axis).normalized(), part, index)
