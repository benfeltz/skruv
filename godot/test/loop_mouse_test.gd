extends GdUnitTestSuite
## The mouse path through scenes/loop.gd, headless: real InputEventMouse events pushed into the
## viewport pick a loose dowel by raycast, drag it on the hover plane to its hole, let go onto the
## seat on offer, and click it home. What a hand on a mouse does in the windowed run, minus the
## hand. Feel (is the hover height right, is the ghost readable) stays Ben's to judge.

## Frames the drag is held still near the hole, so self-aim turns the dowel and the offer appears.
const HOLD_FRAMES := 30
const MOVE_STEPS := 8

var loop: Loop


func before_test() -> void:
	var room: Room = auto_free(Room.new())
	add_child(room)
	loop = auto_free(Loop.new())
	add_child(loop)
	# Colliders reach the physics space on the next physics step.
	await get_tree().physics_frame
	await get_tree().physics_frame


func _screen(world: Vector3) -> Vector2:
	return get_viewport().get_camera_3d().unproject_position(world)


func _button(at: Vector2, pressed: bool) -> void:
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_LEFT
	e.pressed = pressed
	e.position = at
	e.global_position = at
	get_viewport().push_input(e)


func _motion(at: Vector2) -> void:
	var e := InputEventMouseMotion.new()
	e.position = at
	e.global_position = at
	get_viewport().push_input(e)


func test_a_dowel_dragged_with_the_mouse_seats_and_a_click_presses_it() -> void:
	var play := loop.play
	var i := play.open_joints()[0]
	var spec := play.data.joints[i]
	var dowel := spec.hardware
	var from := _screen(play.bonds.poses[dowel].origin)
	_button(from, true)
	# Past the tap distance: the drag starts and the dowel rides the hover plane.
	_motion(from + Vector2(Constants.GESTURE.tapMaxDistance + 5.0, 0.0))
	assert_str(loop.router.drag.part).is_equal(dowel)
	var seat: Transform3D = play.goal(dowel, i)
	var to := loop.router.screen_for(seat.origin)
	for n: int in range(1, MOVE_STEPS + 1):
		_motion(from.lerp(to, float(n) / MOVE_STEPS))
	for frame: int in HOLD_FRAMES:
		await get_tree().process_frame
	assert_object(loop.router.drag.snapped).override_failure_message("no seat on offer with the dowel over its hole").is_not_null()
	_button(to, false)
	assert_object(loop.router.drag).is_null()
	var joint := play.bonds.joint_for_spec(i)
	assert_object(joint).override_failure_message("release did not seat %s" % dowel).is_not_null()
	assert_str(joint.fastener.state).is_equal(Fastener.SEATED)
	# A click on the seated dowel: a tap, and it goes home.
	await get_tree().process_frame
	var at := _screen(play.bonds.poses[dowel].origin)
	_button(at, true)
	_button(at, false)
	assert_str(joint.fastener.state).is_equal(Fastener.PRESSED)
	assert_int(play.steps.done_count(play.steps.current(), play.bonds)).is_equal(1)


func _distance() -> float:
	var camera := loop.router.camera
	return camera.free.distance_to(camera.target)


## A Mac trackpad has no wheel: Godot sends its pinch as a magnify gesture and its two-finger
## scroll as a pan gesture. Both zoom the camera over empty space, as the wheel does.
func test_a_trackpad_pinch_and_two_finger_scroll_zoom_the_camera() -> void:
	var at := Vector2(get_viewport().get_visible_rect().size.x * 0.5, 4.0)
	var before := _distance()
	var pinch := InputEventMagnifyGesture.new()
	pinch.factor = 1.25
	pinch.position = at
	get_viewport().push_input(pinch)
	for frame: int in 30:
		await get_tree().process_frame
	var pinched := _distance()
	assert_float(pinched).override_failure_message("pinch out did not zoom in: %.3f -> %.3f" % [before, pinched]).is_less(before)
	var swipe := InputEventPanGesture.new()
	swipe.delta = Vector2(0.0, 3.0)
	swipe.position = at
	get_viewport().push_input(swipe)
	for frame: int in 30:
		await get_tree().process_frame
	assert_float(_distance()).override_failure_message("two-finger scroll down did not zoom out").is_greater(pinched)


func test_a_pinch_dollies_by_its_own_factor() -> void:
	assert_float(OrbitCamera._zoom_scale(Loop.pinch_px(1.1))).is_equal_approx(1.0 / 1.1, 1e-6)
	assert_float(Loop.pinch_px(1.0)).is_equal(0.0)
	assert_float(Loop.pinch_px(0.9)).is_greater(0.0)
