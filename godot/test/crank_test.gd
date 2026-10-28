extends GdUnitTestSuite
## logic/crank.gd against test/crankMath.test.ts, test/driveMath.test.ts and test/turnRing.test.ts.

const EPS := 1e-6
const C := Vector2(100, 100)


func test_a_clockwise_sweep_on_screen_is_positive_and_sums() -> void:
	var crank := Crank.new()
	assert_float(crank.move(C, C + Vector2(50, 0))).is_equal(0.0)
	# Screen y grows down: from three o'clock to six o'clock is clockwise as seen.
	assert_float(crank.move(C, C + Vector2(0, 50))).is_equal_approx(PI / 2.0, EPS)
	assert_float(crank.move(C, C + Vector2(-50, 0))).is_equal_approx(PI / 2.0, EPS)
	assert_float(crank.total).is_equal_approx(PI, EPS)
	assert_float(crank.move(C, C + Vector2(0, 50))).is_equal_approx(-PI / 2.0, EPS)


func test_the_deadzone_drops_motion_near_the_centre_and_restarts_after() -> void:
	var crank := Crank.new()
	crank.move(C, C + Vector2(50, 0))
	assert_float(crank.move(C, C + Vector2(Constants.FASTENER.crankDeadzone - 1.0, 0))).is_equal(0.0)
	assert_float(crank.move(C, C + Vector2(0, 50))).is_equal(0.0)
	assert_float(crank.move(C, C + Vector2(-50, 0))).is_equal_approx(PI / 2.0, EPS)


func test_the_centre_may_move_between_steps() -> void:
	var crank := Crank.new()
	crank.move(C, C + Vector2(50, 0))
	var moved := C + Vector2(10, 0)
	assert_float(crank.move(moved, moved + Vector2(0, 50))).is_greater(0.0)


func test_tighten_sign_follows_which_side_the_camera_looks_from() -> void:
	assert_int(Crank.tighten_sign(Vector3.DOWN, Vector3(0, -1, 0.2))).is_equal(1)
	assert_int(Crank.tighten_sign(Vector3.DOWN, Vector3(0, 1, 0.2))).is_equal(-1)


func test_hold_to_drive_takes_drive_seconds_whatever_the_span() -> void:
	for span: float in [Constants.FASTENER.boltRadians, Constants.FASTENER.quarterTurn]:
		var sum := 0.0
		for n: int in roundi(Constants.FASTENER.driveSeconds * 60.0):
			sum += Crank.drive_radians(span, Constants.FASTENER.driveSeconds, 1.0 / 60.0)
		assert_float(sum).is_equal_approx(span, 1e-6)


func test_ratchet_ticks_count_boundaries_either_way_however_sliced() -> void:
	var step := Constants.FASTENER.ratchetRadians
	assert_int(Crank.ratchet_ticks(0.0, step * 3.5, step)).is_equal(3)
	assert_int(Crank.ratchet_ticks(step * 3.5, 0.0, step)).is_equal(3)
	var ticks := 0
	for n: int in 16:
		ticks += Crank.ratchet_ticks(n * TAU / 32.0, (n + 1) * TAU / 32.0, step)
	assert_int(ticks).is_equal(4)


func test_the_dial_band_and_the_press_on_overlapping_dials() -> void:
	var r := Constants.TURN_RING.radius
	assert_bool(Crank.dial_hit(C + Vector2(r, 0), C)).is_true()
	assert_bool(Crank.dial_hit(C, C)).is_false()
	var dials: Array[Dictionary] = [{"centre": C, "home": true}, {"centre": C + Vector2(10, 0), "home": false}]
	# On both bands: the one still to go home.
	assert_int(Crank.pick_dial(C + Vector2(r + 5, 0), dials)).is_equal(1)
	assert_int(Crank.pick_dial(C + Vector2(500, 0), dials)).is_equal(-1)
	assert_float(Crank.arc_length(1.0)).is_equal_approx(TAU * r, EPS)
	assert_float(Crank.arc_length(2.0)).is_equal_approx(TAU * r, EPS)
