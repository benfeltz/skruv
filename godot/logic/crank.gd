class_name Crank
extends RefCounted
## Crank gesture maths and the turn ring's: circular pointer motion about a fastener's on-screen
## centre becomes signed turn; a still press drives it home over time; the dial says how far a turn
## has gone. The port of src/game/crankMath.ts (createCrank, tightenSign), src/game/driveMath.ts
## (driveRadians, ratchetTicks) and src/game/turnRing.ts (the dial's rules), whole. Pure: viewport
## px (y down) and world directions in, radians out.

var deadzone: float
var total := 0.0
var _last := Vector2.ZERO
var _has_last := false


func _init(dz: float = Constants.FASTENER.crankDeadzone) -> void:
	deadzone = dz


## Radians swept since the previous point, clockwise on screen positive, measured about the centre
## given with it (it may move between calls). Within `deadzone` px of the centre nothing counts and
## the sweep picks up afresh once the pointer leaves (createCrank move).
func move(centre: Vector2, point: Vector2) -> float:
	if point.distance_to(centre) < deadzone:
		_has_last = false
		return 0.0
	var delta := -DragMath.arc_delta(centre, _last, point) if _has_last else 0.0
	_last = point
	_has_last = true
	total += delta
	return delta


## +1 when a clockwise sweep on screen tightens: the camera looks along the into-the-hole direction
## (a right-hand thread seen from the head); -1 from the far side (tightenSign).
static func tighten_sign(into_hole: Vector3, view_direction: Vector3) -> int:
	return 1 if into_hole.dot(view_direction) >= 0.0 else -1


## Radians one frame of `delta` s adds so a whole `span` takes `seconds` (driveRadians).
static func drive_radians(span: float, seconds: float, delta: float) -> float:
	return span * delta / seconds


## Whole `step` boundaries crossed going from `before` to `after` radians, either way (ratchetTicks).
static func ratchet_ticks(before: float, after: float, step: float) -> int:
	var notch := func(r: float) -> int: return floori(r / step + 1e-12)
	return absi(int(notch.call(after)) - int(notch.call(before)))


# --- the dial (src/game/turnRing.ts) ------------------------------------------------------


## How far a turn's dial is filled: its least-advanced joint's progress (turnProgress).
static func turn_progress(turn: Bonds.Turn) -> float:
	var least := 1.0
	for joint: Bonds.Joint in turn.joints:
		least = minf(least, joint.fastener.progress)
	return least if not turn.joints.is_empty() else 0.0


## Every joint of the turn home: the dial flashes on arriving here (isTurnHome).
static func is_turn_home(turn: Bonds.Turn) -> bool:
	if turn.joints.is_empty():
		return false
	for joint: Bonds.Joint in turn.joints:
		if not Fastener.is_home(joint.fastener):
			return false
	return true


## Turned all the way yet not home: a cam with no screwed bolt to catch (isStalled, isTurnStalled).
static func is_turn_stalled(turn: Bonds.Turn) -> bool:
	for joint: Bonds.Joint in turn.joints:
		if joint.fastener.progress >= 1.0 and not Fastener.is_fastened(joint.fastener):
			return true
	return false


## Whether a screen point is on the dial's grab band round `centre` (dialHit).
static func dial_hit(point: Vector2, centre: Vector2) -> bool:
	return absf(point.distance_to(centre) - Constants.TURN_RING.radius) <= Constants.TURN_RING.band


## How long the progress arc is, px along the ring (arcLength).
static func arc_length(progress: float) -> float:
	return clampf(progress, 0.0, 1.0) * TAU * Constants.TURN_RING.radius


## Whether the arrows point clockwise on screen (tightensClockwise).
static func tightens_clockwise(into_hole: Vector3, view_direction: Vector3) -> bool:
	return tighten_sign(into_hole, view_direction) > 0


## Of the dials whose band takes `point`, the one a press there means: one still to go home before
## one that is, then the nearest ring line (pickDial). Each dial is {centre: Vector2, home: bool}.
static func pick_dial(point: Vector2, dials: Array[Dictionary]) -> int:
	var best := -1
	for n: int in dials.size():
		var centre: Vector2 = dials[n]["centre"]
		if not dial_hit(point, centre):
			continue
		if best < 0:
			best = n
			continue
		var home: bool = dials[n]["home"]
		var best_home: bool = dials[best]["home"]
		var off := absf(point.distance_to(centre) - Constants.TURN_RING.radius)
		var best_off := absf(point.distance_to(Vector2(dials[best]["centre"])) - Constants.TURN_RING.radius)
		if (best_home and not home) or (home == best_home and off < best_off):
			best = n
	return best
