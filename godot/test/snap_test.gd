extends GdUnitTestSuite
## logic/snap.gd and logic/panel_fit.gd against the ideas of test/snapMath.test.ts: nearest pair
## wins, out of distance or angle is null, the transform seats the hole on the end. The
## vocabulary is the export's (ItemData.compatible), never a copy.

const DEG := PI / 180.0
const TOL_DISTANCE := 0.05
const TOL_ANGLE := 30.0 * DEG
const EPS := 1e-6

var compatible: Dictionary[String, String]


func before() -> void:
	compatible = ItemData.load_file(ItemData.JOHNNY_PATH).compatible


func _c(type: String, position: Vector3, axis: Vector3) -> Snap.WorldConnector:
	return Snap.WorldConnector.new(type, position, axis.normalized())


func _list(items: Array) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	for c: Snap.WorldConnector in items:
		out.append(c)
	return out


## A hole in a panel's top face, mouth facing up.
func _hole() -> Snap.WorldConnector:
	return _c("dowelHole", Vector3(1, 0.016, 2), Vector3.UP)


func _snap(ends: Array, holes: Array) -> Snap.Offer:
	return Snap.find_snap(_list(ends), _list(holes), TOL_DISTANCE, TOL_ANGLE, compatible)


func test_constants_are_the_web_builds() -> void:
	assert_float(Constants.SNAP.maxDistance).is_equal(0.08)
	assert_float(Constants.SNAP.maxAngle).is_equal_approx(40.0 * DEG, EPS)
	assert_float(Constants.GESTURE.tapMaxDistance).is_equal(10.0)
	assert_int(Constants.GESTURE.tapMaxMs).is_equal(350)
	assert_float(Constants.GESTURE.hoverLift).is_equal(0.03)


func test_pairs_an_end_with_its_hole_either_way_and_nothing_else() -> void:
	assert_bool(Snap.are_compatible("dowelEnd", "dowelHole", compatible)).is_true()
	assert_bool(Snap.are_compatible("dowelHole", "dowelEnd", compatible)).is_true()
	assert_bool(Snap.are_compatible("dowelEnd", "camBoltHole", compatible)).is_false()
	assert_bool(Snap.are_compatible("dowelHole", "dowelHole", compatible)).is_false()


func test_finds_a_compatible_pair_within_tolerance() -> void:
	var end := _c("dowelEnd", Vector3(1.02, 0.04, 2), Vector3.DOWN)
	var hole := _hole()
	var snap := _snap([end], [hole])
	assert_object(snap).is_not_null()
	assert_object(snap.from).is_same(end)
	assert_object(snap.to).is_same(hole)
	assert_float(snap.distance).is_equal_approx(Vector2(0.02, 0.024).length(), EPS)
	assert_float(snap.angle).is_equal_approx(0.0, EPS)


func test_never_matches_incompatible_types_however_close() -> void:
	var bolt := _c("boltThread", _hole().position, Vector3.DOWN)
	assert_object(_snap([bolt], [_hole()])).is_null()


func test_rejects_a_pair_just_outside_the_distance() -> void:
	assert_object(_snap([_c("dowelEnd", Vector3(1, 0.016 + 0.0499, 2), Vector3.DOWN)], [_hole()])).is_not_null()
	assert_object(_snap([_c("dowelEnd", Vector3(1, 0.016 + 0.0501, 2), Vector3.DOWN)], [_hole()])).is_null()


func test_rejects_a_pair_just_outside_the_angle() -> void:
	var tilted := func(deg: float) -> Vector3: return Vector3(sin(deg * DEG), -cos(deg * DEG), 0)
	assert_object(_snap([_c("dowelEnd", Vector3(1, 0.03, 2), tilted.call(29.9))], [_hole()])).is_not_null()
	assert_object(_snap([_c("dowelEnd", Vector3(1, 0.03, 2), tilted.call(30.1))], [_hole()])).is_null()


func test_rejects_an_end_pointing_out_of_the_hole() -> void:
	assert_object(_snap([_c("dowelEnd", Vector3(1, 0.03, 2), Vector3.UP)], [_hole()])).is_null()


func test_picks_the_nearest_of_several() -> void:
	var far := _c("dowelHole", Vector3(1.03, 0.016, 2), Vector3.UP)
	var near := _c("dowelHole", Vector3(1.01, 0.016, 2), Vector3.UP)
	var snap := _snap([_c("dowelEnd", Vector3(1, 0.03, 2), Vector3.DOWN)], [far, near])
	assert_object(snap.to).is_same(near)


func test_transform_seats_the_connector_and_anti_aligns_the_axes() -> void:
	var axis := Vector3(sin(20 * DEG), -cos(20 * DEG), 0)
	var end := _c("dowelEnd", Vector3(1.01, 0.04, 2.01), axis)
	var t := _snap([end], [_hole()]).transform
	assert_vector(t * end.position).is_equal_approx(_hole().position, Vector3.ONE * EPS)
	assert_vector(t.basis * end.axis).is_equal_approx(Vector3.DOWN, Vector3.ONE * EPS)


func test_apply_transform_carries_a_body_so_its_connector_lands() -> void:
	# The body's connector sits 0.015 below its centre.
	var pose := Transform3D(Basis.IDENTITY, Vector3(1.01, 0.05, 2))
	var end := _c("dowelEnd", Vector3(1.01, 0.035, 2), Vector3.DOWN)
	var seated := Snap.apply_transform(_snap([end], [_hole()]).transform, pose)
	assert_vector(seated.origin).is_equal_approx(Vector3(1, 0.031, 2), Vector3.ONE * EPS)
	assert_bool(seated.basis.is_equal_approx(Basis.IDENTITY)).is_true()


func test_apply_transform_composes_onto_the_body_rotation() -> void:
	var quarter_y := Basis(Vector3.UP, PI / 2.0)
	var seated := Snap.apply_transform(Transform3D(quarter_y, Vector3.ZERO), Transform3D(quarter_y, Vector3.ZERO))
	assert_vector(seated.basis * Vector3(1, 0, 0)).is_equal_approx(Vector3(-1, 0, 0), Vector3.ONE * EPS)


func test_rotation_between_opposite_vectors_is_a_half_turn() -> void:
	var q := Snap.rotation_between(Vector3.UP, Vector3.DOWN)
	assert_vector(q * Vector3.UP).is_equal_approx(Vector3.DOWN, Vector3.ONE * EPS)


## A panel with two holes facing down, carried turned 15° and 3 cm off two dowel ends standing
## up: the fit seats both at once and puts the panel back square over them.
func test_panel_fit_seats_every_hole_at_once() -> void:
	var holes_local := [Vector3(-0.2, -0.008, 0), Vector3(0.2, -0.008, 0)]
	var ends := _list([_c("dowelEnd", Vector3(-0.2, 0.1, 0), Vector3.UP), _c("dowelEnd", Vector3(0.2, 0.1, 0), Vector3.UP)])
	var goal := Transform3D(Basis.IDENTITY, Vector3(0, 0.108, 0))
	var carried := Transform3D(Basis(Vector3.UP, 15 * DEG), Vector3(0.03, 0.12, 0.01))
	var holes: Array[Snap.WorldConnector] = []
	for p: Vector3 in holes_local:
		holes.append(_c("dowelHole", carried * p, carried.basis * Vector3.DOWN))
	var fits := PanelFit.find_fits(holes, carried, ends, PanelFit.FitWindow.panel(), compatible)
	var best: PanelFit.Fit = null
	for fit: PanelFit.Fit in fits:
		if best == null or fit.pairs.size() > best.pairs.size():
			best = fit
	assert_object(best).is_not_null()
	assert_int(best.pairs.size()).is_equal(2)
	assert_vector(best.pose.origin).is_equal_approx(goal.origin, Vector3.ONE * EPS)
	assert_bool(best.pose.basis.is_equal_approx(goal.basis)).is_true()


func test_panel_fit_finds_nothing_out_of_reach() -> void:
	var ends := _list([_c("dowelEnd", Vector3(0, 0.1, 0), Vector3.UP)])
	var holes := _list([_c("dowelHole", Vector3(0, 0.3, 0), Vector3.DOWN)])
	assert_int(PanelFit.find_fits(holes, Transform3D.IDENTITY, ends, PanelFit.FitWindow.panel(), compatible).size()).is_equal(0)
