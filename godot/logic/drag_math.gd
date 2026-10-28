class_name DragMath
extends RefCounted
## Drag and rotation maths for part manipulation: the port of src/game/dragMath.ts, whole. Pure:
## vectors and Transform3D poses in and out. Screen points are viewport px, y down.

const PARALLEL_EPSILON := 1e-9


## Where a ray meets the plane y = plane_y, or null when parallel or pointing away
## (intersectDragPlane).
static func intersect_drag_plane(origin: Vector3, direction: Vector3, plane_y: float) -> Variant:
	if absf(direction.y) < PARALLEL_EPSILON:
		return null
	var t := (plane_y - origin.y) / direction.y
	if t < 0.0:
		return null
	return Vector3(origin.x + t * direction.x, plane_y, origin.z + t * direction.z)


## The grab offset (x, z) that keeps a part at `part_xz` once the finger's ray meets the moved
## plane at `on_plane` (rebaseDragOffset).
static func rebase_drag_offset(part_xz: Vector2, on_plane: Vector3) -> Vector2:
	return Vector2(part_xz.x - on_plane.x, part_xz.y - on_plane.z)


## A part's centre clamped so its (half x, half z) footprint stays `margin` inside the walls of a
## room centred on the origin (clampToRoom).
static func clamp_to_room(p: Vector3, half: Vector2, room: Vector3, margin: float) -> Vector3:
	var limit_x := maxf(0.0, room.x / 2.0 - margin - half.x)
	var limit_z := maxf(0.0, room.z / 2.0 - margin - half.y)
	return Vector3(clampf(p.x, -limit_x, limit_x), p.y, clampf(p.z, -limit_z, limit_z))


## A lifted part's centre height: its bottom on or above the floor, its top `margin` below the
## room's height (clampLift).
static func clamp_lift(y: float, half_height: float, room_height: float, margin: float) -> float:
	var ceiling := maxf(half_height, room_height - margin - half_height)
	return minf(ceiling, maxf(half_height, y))


## How far (px) a pointer has travelled from `start` to `point` along the screen direction `axis`
## (pullAlong); 0 for a degenerate axis.
static func pull_along(start: Vector2, point: Vector2, axis: Vector2) -> float:
	var length := axis.length()
	if length < PARALLEL_EPSILON:
		return 0.0
	return (point - start).dot(axis) / length


## The nearest detent to `angle` every `step` radians, halfway rounding away from zero; a zero
## step leaves it (quantizeAngle).
static func quantize_angle(angle: float, step: float) -> float:
	if step == 0.0:
		return angle
	var detents := roundf(absf(angle) / step)
	return signf(angle) * detents * step


## Signed angle swept round screen point `centre` from `from` to `to`, in (-π, π]; screen y grows
## down, so an anticlockwise sweep as seen is positive (arcDelta).
static func arc_delta(centre: Vector2, from: Vector2, to: Vector2) -> float:
	var a0 := atan2(centre.y - from.y, from.x - centre.x)
	var a1 := atan2(centre.y - to.y, to.x - centre.x)
	var delta := a1 - a0
	if delta > PI:
		delta -= TAU
	if delta <= -PI:
		delta += TAU
	return delta


## World half-extents of a box of half-sizes `half` turned by `basis` (rotatedHalfExtents).
static func rotated_half_extents(half: Vector3, basis: Basis) -> Vector3:
	var out := Vector3.ZERO
	for row: int in 3:
		out[row] = absf(basis[0][row]) * half.x + absf(basis[1][row]) * half.y + absf(basis[2][row]) * half.z
	return out


## True when a box at `p` with world half-extents `half` lies above the floor and inside the walls,
## give or take `tolerance` (fitsInRoom).
static func fits_in_room(p: Vector3, half: Vector3, room: Vector3, tolerance: float = 0.0) -> bool:
	return p.y - half.y >= -tolerance and absf(p.x) + half.x <= room.x / 2.0 + tolerance and absf(p.z) + half.z <= room.z / 2.0 + tolerance


## Seat assist's law: `pose` eased toward `target` by an exponential pull of `strength` (1/s) over
## `delta` s, framerate-independent (easeToward).
static func ease_toward(pose: Transform3D, target: Transform3D, strength: float, delta: float) -> Transform3D:
	var t := 1.0 - exp(-strength * delta)
	var from := pose.basis.get_rotation_quaternion()
	var to := target.basis.get_rotation_quaternion()
	return Transform3D(Basis(from.slerp(to, t).normalized()), pose.origin.lerp(target.origin, t))


## The room as the clamps take it: width, height (the lift ceiling), depth.
static func room() -> Vector3:
	return Vector3(Constants.ROOM.width, Constants.ROOM.height, Constants.ROOM.depth)
