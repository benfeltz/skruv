class_name PanelFit
extends RefCounted
## Panel fit: where a carried panel seats by all its holes at once. The port of
## src/game/panelFit.ts findFits (the search; the web's "where it goes" ranking is replaced by
## the caller's `allowed` pairs, see the README). Pure: Snap.WorldConnector records, Transform3D
## poses.
##
##   seed  a hole within the window of a free end that takes it: the hole's axis straightened
##         onto the end's, as find_snap seats hardware
##   spin  the turn about that axis that lands a second hole on a second end
##   fit   every hole that then sits on a compatible end, axis against axis: the pairs a
##         release seats, all at once

## The same pose to within rounding.
const SAME := 1e-6


## The fit search's window (FitWindow): seeding reach and skew, and how exactly a further hole
## must sit, across and along its end's axis.
class FitWindow:
	var max_distance: float
	var max_angle: float
	var match_tolerance: float
	var seat_slack: float
	var match_angle: float

	## Constants.PANEL's window.
	static func panel() -> FitWindow:
		var w := FitWindow.new()
		w.max_distance = Constants.PANEL.maxDistance
		w.max_angle = Constants.PANEL.maxAngle
		w.match_tolerance = Constants.PANEL.matchTolerance
		w.seat_slack = Constants.PANEL.seatSlack
		w.match_angle = Constants.PANEL.matchAngle
		return w


## One hole of the panel on one end it seats on.
class Pair:
	var hole: Snap.WorldConnector
	var end: Snap.WorldConnector


## A whole-panel fit: the pose it seats the panel at, the transform carrying it there, every pair
## it seats (the seed pair first), how far the panel's centre moves, and the seed's skew.
class Fit:
	var pose: Transform3D
	var transform: Transform3D
	var pairs: Array[Pair] = []
	var distance: float
	var angle: float


## Every whole-panel fit of `holes` (world space, with the panel at `pose`) onto `ends`. Fits
## seating the same pairs are one, the nearer kept. Unranked. `allowed(hole, end) -> bool`, when
## given, narrows which pairs may seed, spin or seat beyond type compatibility (the loop passes
## the open page's pairs; the web passes nothing).
static func find_fits(holes: Array[Snap.WorldConnector], pose: Transform3D, ends: Array[Snap.WorldConnector], window: FitWindow, compatible: Dictionary[String, String], allowed: Callable = Callable()) -> Array[Fit]:
	var fits: Dictionary[String, Fit] = {}
	var reach: Dictionary[String, float] = {}
	for h: int in holes.size():
		var hole := holes[h]
		for e: int in ends.size():
			var end := ends[e]
			if allowed.is_valid() and not allowed.call(hole, end):
				continue
			var seed := Snap.find_snap([hole] as Array[Snap.WorldConnector], [end] as Array[Snap.WorldConnector], window.max_distance, window.max_angle, compatible)
			if seed == null:
				continue
			var turns := _spins(seed.transform, hole, end, holes, ends, window, compatible, allowed)
			if turns.is_empty():
				turns.append(seed.transform)
			for transform: Transform3D in turns:
				var pairs := _pairs_of(transform, holes, ends, window, compatible, allowed)
				var has_seed := false
				for p: Vector2i in pairs:
					if p.x == h and p.y == e:
						has_seed = true
				if not has_seed:
					continue
				var moved := Snap.apply_transform(transform, pose)
				var distance := moved.origin.distance_to(pose.origin)
				var keys: PackedStringArray = []
				for p: Vector2i in pairs:
					keys.append("%d:%d" % [p.x, p.y])
				keys.sort()
				var key := ",".join(keys)
				var known: Fit = fits.get(key)
				if known != null:
					var same := absf(known.distance - distance) < SAME
					if (reach[key] <= seed.distance) if same else (known.distance < distance):
						continue
				reach[key] = seed.distance
				var fit := Fit.new()
				fit.pose = moved
				fit.transform = transform
				fit.distance = distance
				fit.angle = seed.angle
				# The seed pair first: it is the one reported.
				for p: Vector2i in pairs:
					if p.x == h:
						fit.pairs.append(_pair(holes[p.x], ends[p.y]))
				for p: Vector2i in pairs:
					if p.x != h:
						fit.pairs.append(_pair(holes[p.x], ends[p.y]))
				fits[key] = fit
	var out: Array[Fit] = []
	out.assign(fits.values())
	return out


static func _pair(hole: Snap.WorldConnector, end: Snap.WorldConnector) -> Pair:
	var p := Pair.new()
	p.hole = hole
	p.end = end
	return p


## `transform`, then a turn of `angle` about the line through `centre` along unit `axis`.
static func _spun(transform: Transform3D, axis: Vector3, angle: float, centre: Vector3) -> Transform3D:
	var turn := Quaternion(axis, angle)
	var rotation := (turn * transform.basis.get_rotation_quaternion()).normalized()
	return Transform3D(Basis(rotation), turn * (transform.origin - centre) + centre)


## The seed turned about the end's axis, once per second pair a turn within max_angle lands.
static func _spins(seed: Transform3D, hole: Snap.WorldConnector, end: Snap.WorldConnector, holes: Array[Snap.WorldConnector], ends: Array[Snap.WorldConnector], window: FitWindow, compatible: Dictionary[String, String], allowed: Callable) -> Array[Transform3D]:
	var axis := end.axis
	var out: Array[Transform3D] = []
	for second: Snap.WorldConnector in holes:
		if second == hole:
			continue
		var p := _across(seed * second.position, end.position, axis)
		# On the seed's own axis: its spin says nothing.
		if p.length() < window.match_tolerance:
			continue
		for other: Snap.WorldConnector in ends:
			if other == end or not Snap.are_compatible(second.type, other.type, compatible):
				continue
			if allowed.is_valid() and not allowed.call(second, other):
				continue
			var q := _across(other.position, end.position, axis)
			if absf(p.length() - q.length()) > window.match_tolerance:
				continue
			var angle := atan2(axis.dot(p.cross(q)), p.dot(q))
			if absf(angle) <= window.max_angle:
				out.append(_spun(seed, axis, angle, end.position))
	return out


static func _across(point: Vector3, origin: Vector3, axis: Vector3) -> Vector3:
	var offset := point - origin
	return offset - axis * offset.dot(axis)


## The pairs `transform` seats, as (hole index, end index): each hole carried onto the nearest
## compatible end within match_tolerance across the end's axis and seat_slack along it, axis
## against axis within match_angle, one end per hole.
static func _pairs_of(transform: Transform3D, holes: Array[Snap.WorldConnector], ends: Array[Snap.WorldConnector], window: FitWindow, compatible: Dictionary[String, String], allowed: Callable) -> Array[Vector2i]:
	var candidates: Array[Vector3] = []  # (hole, end, distance)
	for i: int in holes.size():
		var position := transform * holes[i].position
		var axis := transform.basis * holes[i].axis
		for j: int in ends.size():
			var end := ends[j]
			if not Snap.are_compatible(holes[i].type, end.type, compatible):
				continue
			if allowed.is_valid() and not allowed.call(holes[i], end):
				continue
			var offset := end.position - position
			var slide := offset.dot(end.axis)
			var off_axis := (offset - end.axis * slide).length()
			if absf(slide) > window.seat_slack or off_axis > window.match_tolerance:
				continue
			if Snap.misalignment(axis, end.axis) > window.match_angle:
				continue
			candidates.append(Vector3(i, j, offset.length()))
	candidates.sort_custom(func(a: Vector3, b: Vector3) -> bool: return a.z < b.z)
	var taken: Dictionary[int, bool] = {}
	var seated: Dictionary[int, bool] = {}
	var out: Array[Vector2i] = []
	for c: Vector3 in candidates:
		var hole := int(c.x)
		var end := int(c.y)
		if seated.has(hole) or taken.has(end):
			continue
		seated[hole] = true
		taken[end] = true
		out.append(Vector2i(hole, end))
	return out
