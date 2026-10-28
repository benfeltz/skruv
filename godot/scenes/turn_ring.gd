class_name TurnRing
extends Control
## The turn ring: a flat dial round each fastener a seated tool is on, a ring, two arrowheads the
## tightening way, and an arc filling as it goes home. The port of src/ui/turnRing.ts's drawing.
## It only draws, in viewport px over the 3D view; where the dials are and what a press on one does
## are the router's (Router.dials, Router.hit_at). Sizes and colours: TURN_RING.

const TRACK_COLOR := Color(1, 1, 1, 0.55)
const ARC_COLOR := Color(0.95, 0.7, 0.25)
const STALLED_COLOR := Color(1, 1, 1, 0.45)
const ARROW_COLOR := Color(1, 1, 1)
const SEGMENTS := 64

var dials: Array[Dictionary] = []


func _init() -> void:
	name = "TurnRing"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)


func show_dials(next: Array[Dictionary]) -> void:
	dials = next
	queue_redraw()


func _draw() -> void:
	var r := Constants.TURN_RING.radius
	for dial: Dictionary in dials:
		var centre: Vector2 = dial["centre"]
		var flashing: bool = dial["flashing"]
		var stalled: bool = dial["stalled"]
		var clockwise: bool = dial["clockwise"]
		var progress: float = dial["progress"]
		draw_arc(centre, r, 0.0, TAU, SEGMENTS, ARC_COLOR if flashing else TRACK_COLOR, Constants.TURN_RING.width, true)
		# The arc from twelve o'clock, clockwise (anticlockwise mirrored).
		var sweep := Crank.arc_length(progress) / r
		if sweep > 0.0:
			var start := -PI / 2.0
			draw_arc(centre, r, start, start + (sweep if clockwise else -sweep), SEGMENTS, STALLED_COLOR if stalled else ARC_COLOR, Constants.TURN_RING.arcWidth, true)
		# Arrowheads at three and nine, pointing along the ring the tightening way.
		var s := Constants.TURN_RING.arrowSize
		for angle: float in [0.0, PI]:
			var at := centre + Vector2(cos(angle), sin(angle)) * r
			var along := Vector2(-sin(angle), cos(angle)) * (1.0 if clockwise else -1.0)
			var across := Vector2(cos(angle), sin(angle))
			draw_colored_polygon(PackedVector2Array([at + along * s / 2.0, at - along * s / 2.0 + across * s / 2.0, at - along * s / 2.0 - across * s / 2.0]), ARC_COLOR if flashing else ARROW_COLOR)
