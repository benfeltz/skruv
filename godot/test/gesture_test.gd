extends GdUnitTestSuite
## logic/gesture.gd against the ideas of src/game/gestureState.ts: tap vs drag at
## GESTURE.tapMaxDistance / tapMaxMs, who owns a press, and the camera handed back on every end.

const PART := {"kind": "part", "id": "dowel-1"}


func test_a_still_quick_press_on_a_part_is_a_tap() -> void:
	var g := Gesture.new()
	assert_object(g.down(1, 100, 100, 0, PART)).is_null()
	assert_str(g.owner).is_equal(Gesture.DRAG_PART)
	var e := g.up(1, 100 + Constants.GESTURE.tapMaxDistance, 100, Constants.GESTURE.tapMaxMs)
	assert_str(e.type).is_equal(Gesture.TAP)
	assert_str(String(e.hit["id"])).is_equal("dowel-1")
	assert_str(g.phase()).is_equal("idle")


func test_a_slow_press_is_no_tap() -> void:
	var g := Gesture.new()
	g.down(1, 100, 100, 0, PART)
	assert_object(g.up(1, 100, 100, Constants.GESTURE.tapMaxMs + 1)).is_null()


func test_moving_past_the_tap_distance_starts_a_drag() -> void:
	var g := Gesture.new()
	g.down(1, 100, 100, 0, PART)
	assert_object(g.move(1, 100 + Constants.GESTURE.tapMaxDistance, 100)).is_null()
	var start := g.move(1, 100 + Constants.GESTURE.tapMaxDistance + 1, 100)
	assert_str(start.type).is_equal(Gesture.DRAG_START)
	assert_str(start.owner).is_equal(Gesture.DRAG_PART)
	assert_bool(g.camera_enabled()).is_false()
	assert_str(g.move(1, 150, 120).type).is_equal(Gesture.DRAG_MOVE)
	var end := g.up(1, 150, 120, 2000)
	assert_str(end.type).is_equal(Gesture.DRAG_END)
	assert_bool(g.camera_enabled()).is_true()


func test_empty_space_is_the_cameras_and_a_tap_there_has_no_hit() -> void:
	var g := Gesture.new()
	g.down(1, 10, 10, 0)
	assert_str(g.owner).is_equal(Gesture.CAMERA)
	assert_bool(g.camera_enabled()).is_true()
	assert_object(g.move(1, 200, 200)).is_null()
	assert_object(g.up(1, 200, 200, 100)).is_null()
	g.down(2, 10, 10, 0)
	var tap := g.up(2, 10, 10, 50)
	assert_str(tap.type).is_equal(Gesture.TAP)
	assert_bool(tap.hit.is_empty()).is_true()


func test_a_right_button_press_on_a_part_is_the_cameras_and_never_a_tap() -> void:
	var g := Gesture.new()
	g.down(1, 100, 100, 0, PART, 1)
	assert_str(g.owner).is_equal(Gesture.CAMERA)
	assert_object(g.up(1, 100, 100, 10)).is_null()


func test_the_wheel_lifts_only_a_dragged_part() -> void:
	var g := Gesture.new()
	assert_object(g.wheel(10)).is_null()
	g.down(1, 100, 100, 0, PART)
	assert_object(g.wheel(10)).is_null()
	g.move(1, 150, 100)
	var lift := g.wheel(10)
	assert_str(lift.type).is_equal(Gesture.LIFT)
	assert_float(lift.dy).is_equal(-10.0)


func test_cancel_mid_drag_hands_the_camera_back() -> void:
	var g := Gesture.new()
	g.down(1, 100, 100, 0, PART)
	g.move(1, 150, 100)
	assert_str(g.cancel(1).type).is_equal(Gesture.DRAG_CANCEL)
	assert_bool(g.camera_enabled()).is_true()
	assert_str(g.phase()).is_equal("idle")
