class_name Lift
extends RefCounted
## The elevation line's maths and its hold: the port of src/game/liftLine.ts (liftRange,
## fractionOf, heightAt, easeHeight, shiftScroll, selectsDuringHold) and the hold state of
## src/scene/liftHold.ts, without the physics seam: while held (Shift down on the desktop) the
## held part's centre rides at `height`, easing toward `goal` at LIFT_LINE.easeRate; let go, it drops.
## Pure: heights in metres.

var part := ""
var height := 0.0
var goal := 0.0
## The range the held part's centre may take: resting on the floor up to the ceiling.
var span := Vector2.ZERO


## The centre-height range for a part reaching `half_height` either side of a point `centre`
## above its own centre (liftRange).
static func lift_range(half_height: float, centre: float = 0.0) -> Vector2:
	var room := DragMath.room()
	var lo := DragMath.clamp_lift(-INF, half_height, room.y, Constants.GESTURE.ceilingMargin) - centre
	var hi := DragMath.clamp_lift(INF, half_height, room.y, Constants.GESTURE.ceilingMargin) - centre
	return Vector2(lo, hi)


## Where `h` sits on the line, 0..1; a part too tall to lift reads 0 (fractionOf).
static func fraction_of(h: float, r: Vector2) -> float:
	return clampf((h - r.x) / (r.y - r.x), 0.0, 1.0) if r.y > r.x else 0.0


## The height a line fraction stands for (heightAt).
static func height_at(fraction: float, r: Vector2) -> float:
	return r.x + clampf(fraction, 0.0, 1.0) * (r.y - r.x)


## `current` eased toward `target` over `delta` s at `rate` 1/s (easeHeight).
static func ease_height(current: float, target: float, rate: float, delta: float) -> float:
	return current + (target - current) * (1.0 - exp(-rate * delta))


## Shift + scroll as a lift (px, up positive), or NAN without Shift (shiftScroll); macOS turns a
## Shift scroll sideways, so dx stands in when dy is 0.
static func shift_scroll(dx: float, dy: float, shift: bool) -> float:
	if not shift:
		return NAN
	return -(dy if dy != 0.0 else dx)


## Whether a tap on `tapped` ("" empty space) may change the selection while the line holds `held`
## (selectsDuringHold).
static func selects_during_hold(tapped: String, held: String) -> bool:
	return held == "" or tapped == "" or tapped == held


func is_holding() -> bool:
	return part != ""


## Takes `id` up at centre height `at`, within `r`.
func begin(id: String, at: float, r: Vector2) -> void:
	part = id
	span = r
	height = clampf(at, r.x, r.y)
	goal = height


func target(h: float) -> void:
	goal = clampf(h, span.x, span.y)


func jump(h: float) -> void:
	height = clampf(h, span.x, span.y)
	goal = height


func end() -> void:
	part = ""


## One frame of easing toward the goal.
func update(delta: float) -> void:
	if part != "":
		height = ease_height(height, goal, Constants.LIFT_LINE.easeRate, delta)
