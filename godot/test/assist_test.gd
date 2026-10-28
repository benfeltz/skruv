extends GdUnitTestSuite
## logic/assist.gd against test/toolAim.test.ts: aim strength, the nearest target, the aimed
## rotation, the framerate-independent step and the aim angle; and the room check a seat passes.

const EPS := 1e-6


func test_aim_weight_is_one_on_the_target_zero_at_the_edge_and_falls_between() -> void:
	assert_float(Assist.aim_weight(0.0, 0.3)).is_equal(1.0)
	assert_float(Assist.aim_weight(0.3, 0.3)).is_equal(0.0)
	assert_float(Assist.aim_weight(0.5, 0.3)).is_equal(0.0)
	var last := 1.0
	for n: int in range(1, 30):
		var w := Assist.aim_weight(0.01 * n, 0.3)
		assert_float(w).is_less_equal(last)
		last = w


func test_nearest_target_inside_the_zone_or_none() -> void:
	var targets: Array[Snap.WorldConnector] = [Snap.WorldConnector.new("dowelHole", Vector3(0.2, 0, 0)), Snap.WorldConnector.new("dowelHole", Vector3(0.1, 0, 0))]
	assert_object(Assist.nearest_target(Vector3.ZERO, targets, 0.3)).is_same(targets[1])
	assert_object(Assist.nearest_target(Vector3.ZERO, targets, 0.05)).is_null()


func test_the_aimed_rotation_points_the_tip_straight_in() -> void:
	var rotation := Basis(Vector3(1, 1, 0).normalized(), 0.7)
	var tip := Vector3(0, -1, 0)
	var target_axis := Vector3(0, 0, 1)
	var aimed := Assist.aimed_rotation(rotation, tip, target_axis)
	assert_vector(aimed * tip).is_equal_approx(-target_axis, Vector3.ONE * EPS)
	assert_float(Assist.aim_angle(aimed, tip, target_axis)).is_equal_approx(0.0, 1e-4)


func test_aim_step_closes_the_same_share_at_any_framerate_and_nothing_at_zero() -> void:
	var from := Basis()
	var to := Basis(Vector3.UP, 1.0)
	var shares: Array[float] = []
	for fps: int in [30, 60, 120]:
		var r := from
		for n: int in fps / 2:
			r = Assist.aim_step(r, to, 1.0, Constants.AIM.rate, 1.0 / fps)
		shares.append(r.get_rotation_quaternion().angle_to(to.get_rotation_quaternion()))
	assert_float(shares[0]).is_equal_approx(shares[2], 1e-4)
	assert_bool(Assist.aim_step(from, to, 0.0, Constants.AIM.rate, 0.5).is_equal_approx(from)).is_true()


func test_aim_angle_straight_in_flat_and_away() -> void:
	var up := Vector3.UP
	assert_float(Assist.aim_angle(Basis(), Vector3.DOWN, up)).is_equal_approx(0.0, EPS)
	assert_float(Assist.aim_angle(Basis(), Vector3.RIGHT, up)).is_equal_approx(PI / 2.0, EPS)
	assert_float(Assist.aim_angle(Basis(), Vector3.UP, up)).is_equal_approx(PI, EPS)


func test_a_seat_through_the_floor_or_a_wall_is_refused() -> void:
	var size := Vector3(0.768, 0.016, 0.28)
	assert_bool(Assist.fits_room(Transform3D(Basis(), Vector3(0, 0.008, 0)), size)).is_true()
	assert_bool(Assist.fits_room(Transform3D(Basis(), Vector3(0, 0.0, 0)), size)).is_false()
	assert_bool(Assist.fits_room(Transform3D(Basis(), Vector3(Constants.ROOM.width / 2.0, 0.5, 0)), size)).is_false()
