class_name Assist
extends RefCounted
## Self-aim and seat assist: carried hardware turns its fastener end toward the nearest seat that
## takes it, harder the nearer; a carried panel turns toward where it goes; a part with a seat on
## offer glides into it. The port of src/game/toolAim.ts whole (aimWeight, nearestTarget, aimAngle,
## aimedRotation, aimStep) and the router's seatPose room check. Pure: Basis rotations, Vector3
## positions; the router feeds it every frame.


## Aim strength `distance` m from a target: 1 on it, easing to 0 at `zone` (aimWeight).
static func aim_weight(distance: float, zone: float) -> float:
	var t := clampf(1.0 - distance / zone, 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


## The connector nearest `tip` strictly inside `zone`, or null (nearestTarget).
static func nearest_target(tip: Vector3, targets: Array[Snap.WorldConnector], zone: float) -> Snap.WorldConnector:
	var best: Snap.WorldConnector = null
	var best_d := INF
	for target: Snap.WorldConnector in targets:
		var d := target.position.distance_to(tip)
		if d < zone and d < best_d:
			best_d = d
			best = target
	return best


## How far (rad) an end along local `axis` at `rotation` is from pointing straight into a target
## facing `target_axis` (aimAngle).
static func aim_angle(rotation: Basis, axis: Vector3, target_axis: Vector3) -> float:
	return acos(clampf(-(rotation * axis).dot(target_axis), -1.0, 1.0))


## `rotation` turned by the smallest extra rotation that points the tip straight into the target
## (aimedRotation).
static func aimed_rotation(rotation: Basis, tip_axis: Vector3, target_axis: Vector3) -> Basis:
	var q := rotation.get_rotation_quaternion()
	return Basis((Snap.rotation_between((q * tip_axis).normalized(), -target_axis) * q).normalized())


## One frame of aiming: `rotation` eased toward `aimed` at rate·weight 1/s over `delta` s (aimStep).
static func aim_step(rotation: Basis, aimed: Basis, weight: float, rate: float, delta: float) -> Basis:
	var t := 1.0 - exp(-rate * weight * delta)
	return Basis(rotation.get_rotation_quaternion().slerp(aimed.get_rotation_quaternion(), t).normalized())


## True when a part of `size` at `pose` sits above the floor and inside the walls within
## SNAP.roomTolerance: the router refuses a seat that would hold it through them (seatPose).
static func fits_room(pose: Transform3D, size: Vector3) -> bool:
	var half := DragMath.rotated_half_extents(size / 2.0, pose.basis)
	return DragMath.fits_in_room(pose.origin, half, DragMath.room(), Constants.SNAP.roomTolerance)
