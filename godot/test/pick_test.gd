extends GdUnitTestSuite
## logic/pick.gd against test/pickMath.test.ts's cases, and the box casts the router picks with.

const R := Constants.PICK.fingerRadius


func _panel_hit() -> Pick.Hit:
	return Pick.Hit.new("sidePanel-1", Vector3.ZERO, 1.0)


func _proxy(part: String, distance: float, miss: float) -> Pick.Hit:
	return Pick.Hit.new(part, Vector3.ZERO, distance, miss, distance)


func _empty() -> Array[Pick.Hit]:
	var out: Array[Pick.Hit] = []
	return out


func _of(hits: Array) -> Array[Pick.Hit]:
	var out: Array[Pick.Hit] = []
	out.assign(hits)
	return out


func test_the_small_part_wins_when_the_finger_is_over_it() -> void:
	var near := _proxy("dowel-1", 0.98, R * 0.98 * 0.5)
	assert_object(Pick.prefer_hit(_panel_hit(), _of([near]))).is_same(near)


func test_the_panel_stays_when_the_finger_is_beside_the_hardware() -> void:
	var panel := _panel_hit()
	assert_object(Pick.prefer_hit(panel, _of([_proxy("dowel-1", 0.98, 0.1)]))).is_same(panel)
	assert_object(Pick.prefer_hit(panel, _of([_proxy("dowel-1", 0.98, R * 0.98 * 1.01)]))).is_same(panel)


func test_the_finger_scales_with_distance() -> void:
	var far := Pick.Hit.new("sidePanel-1", Vector3.ZERO, 3.0)
	assert_str(Pick.prefer_hit(far, _of([_proxy("dowel-1", 2.0, R * 1.6)])).part).is_equal("dowel-1")
	assert_object(Pick.prefer_hit(far, _of([_proxy("dowel-1", 0.5, R * 1.6)]))).is_same(far)


func test_hardware_behind_the_panel_is_never_picked() -> void:
	var panel := _panel_hit()
	assert_object(Pick.prefer_hit(panel, _of([_proxy("dowel-1", 1.2, 0.0)]))).is_same(panel)


func test_the_part_squarely_under_the_finger_beats_a_grazed_neighbour() -> void:
	var touched := _proxy("dowel-1", 0.97, 0.0)
	var grazed := _proxy("dowel-2", 0.95, R * 0.5)
	assert_object(Pick.prefer_hit(_panel_hit(), _of([touched, grazed]))).is_same(touched)
	assert_object(Pick.prefer_hit(_panel_hit(), _of([grazed, touched]))).is_same(touched)


func test_with_nothing_real_the_nearest_proxy_is_the_press() -> void:
	var a := _proxy("dowel-1", 0.5, 0.01)
	var b := _proxy("dowel-2", 0.5, 0.02)
	assert_object(Pick.prefer_hit(null, _of([b, a]))).is_same(a)
	assert_object(Pick.prefer_hit(null, _empty())).is_null()


func test_ray_box_reach_is_zero_through_and_measures_beside() -> void:
	var half := Vector3(0.5, 0.5, 0.5)
	var through := Pick.ray_box_reach(Vector3(0, 0, 5), Vector3(0, 0, -1), half)
	assert_float(through.x).is_equal(0.0)
	assert_float(through.y).is_equal_approx(4.5, 1e-9)
	var beside := Pick.ray_box_reach(Vector3(1.5, 0, 5), Vector3(0, 0, -1), half)
	assert_float(beside.x).is_equal_approx(1.0, 1e-6)
	# Beside a box the gap is flat along its length: the depth is anywhere on that stretch.
	assert_float(beside.y).is_between(4.49, 5.51)


func test_a_cast_picks_a_dowel_lying_on_a_panel_by_its_proxy() -> void:
	var boxes: Array[Pick.Box] = []
	boxes.append(Pick.Box.new("panel", Transform3D(Basis(), Vector3(0, 0.008, 0)), Vector3(0.8, 0.016, 0.3)))
	boxes.append(Pick.Box.new("dowel", Transform3D(Basis(), Vector3(0.1, 0.02, 0)), Vector3(0.008, 0.008, 0.03)))
	# Straight down, 5 mm beside the dowel: the panel's top is hit first, but the finger is on the dowel.
	var hit := Pick.pick(Vector3(0.1 + 0.009, 1.0, 0), Vector3.DOWN, boxes)
	assert_str(hit.part).is_equal("dowel")
	# 10 cm away: the panel.
	assert_str(Pick.pick(Vector3(0.2, 1.0, 0), Vector3.DOWN, boxes).part).is_equal("panel")
	assert_object(Pick.pick(Vector3(2, 1.0, 0), Vector3.DOWN, boxes)).is_null()
