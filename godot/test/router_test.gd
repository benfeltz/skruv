extends GdUnitTestSuite
## logic/router.gd, headless, with the real export: a part pressed and dragged by screen points
## through the camera's view, its seat offered and taken on release; a seated part dragged away
## leaves its seat; the wheel and the elevation line lift; a panel carries what is seated in it.

const MS := 16
const HOLD_FRAMES := 30
const DT := 1.0 / 60.0

var data: ItemData


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


func _router() -> Router:
	var play := Play.new(data)
	play.open_page()
	var router := Router.new(play)
	router.camera.frame(Loop.CAMERA_POSITION, Loop.CAMERA_TARGET)
	return router


## Seats export joint `i` straight in the graph: the hardware at its hole's mouth, seated.
func _seat(play: Play, i: int) -> Bonds.Joint:
	var spec := data.joints[i]
	var home: Transform3D = play.goal(spec.hardware, i)
	var axis := play.bonds.world_connector(spec.host, spec.host_connector).axis
	play.bonds.poses[spec.hardware] = Transform3D(home.basis, home.origin + axis * data.sink_depth[spec.kind])
	return play.bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.mover, i)


## Press on `id`, move past the tap distance: a drag of it begins.
func _grab(router: Router, id: String, t: int) -> Vector2:
	var centre := router.play.bonds.poses[id].origin
	router.camera.frame(centre + Vector3(0.0, 1.0, 1.0).normalized() * Hand.VIEW_DISTANCE, centre)
	var at := router.point_on(id)
	assert_bool(at.x >= 0.0).override_failure_message("no screen point picks %s" % id).is_true()
	router.press(Router.LEFT, at, t)
	at += Vector2(Constants.GESTURE.tapMaxDistance + 2.0, 0.0)
	router.motion(at)
	assert_object(router.drag).override_failure_message("no drag of %s" % id).is_not_null()
	return at


func _carry_to(router: Router, target: Vector3) -> Vector2:
	var at := router.screen_for(target)
	router.motion(at)
	for i: int in HOLD_FRAMES:
		router.update(DT)
	return at


func test_a_dowel_dragged_by_screen_points_seats_on_release() -> void:
	var router := _router()
	var play := router.play
	var i := play.open_joints()[0]
	var dowel := data.joints[i].hardware
	_grab(router, dowel, 0)
	assert_str(router.drag.part).is_equal(dowel)
	assert_bool(router.camera.enabled).is_false()
	var seat: Transform3D = play.goal(dowel, i)
	# Lift it to the seat's height, then over it.
	router.wheel(-(seat.origin.y - router.drag.height) / Constants.GESTURE.desktopLiftRate, Vector2.ZERO)
	assert_float(router.drag.height).is_equal_approx(seat.origin.y, 1e-6)
	var at := _carry_to(router, seat.origin + Vector3(0.01, 0, 0.01))
	assert_object(router.drag.snapped).override_failure_message("no seat on offer over the hole").is_not_null()
	router.release(Router.LEFT, at, 2000)
	assert_object(router.drag).is_null()
	assert_bool(router.camera.enabled).is_true()
	var joint := play.bonds.joint_for_spec(i)
	assert_object(joint).is_not_null()
	# A click on it now taps it home.
	var on := router.point_on(dowel)
	router.press(Router.LEFT, on, 3000)
	router.release(Router.LEFT, on, 3000 + MS)
	assert_str(joint.fastener.state).is_equal(Fastener.PRESSED)


func test_a_seated_dowel_dragged_away_leaves_its_seat() -> void:
	var router := _router()
	var play := router.play
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	_seat(play, i)
	assert_object(play.bonds.joint_for_spec(i)).is_not_null()
	_grab(router, spec.hardware, 0)
	assert_object(play.bonds.joint_for_spec(i)).override_failure_message("still seated once dragged").is_null()


func test_a_pressed_dowel_is_no_drag_away_it_moves_its_compound() -> void:
	var router := _router()
	var play := router.play
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	_seat(play, i)
	play.tap(spec.hardware)
	_grab(router, spec.hardware, 0)
	assert_str(router.drag.mode).is_equal(Router.COMPOUND)
	assert_bool(router.carried().has(spec.host)).is_true()


func test_the_wheel_lifts_a_dragged_part_and_the_floor_stops_it() -> void:
	var router := _router()
	var dowel := data.joints[router.play.open_joints()[0]].hardware
	_grab(router, dowel, 0)
	var h := router.drag.height
	router.wheel(-40.0, Vector2.ZERO)
	assert_float(router.drag.height).is_equal_approx(h + 40.0 * Constants.GESTURE.desktopLiftRate, 1e-6)
	router.wheel(4000.0, Vector2.ZERO)
	assert_float(router.drag.height).is_equal_approx(router.drag.half_height - router.drag.centre.y, 1e-6)


func test_shift_holds_a_part_up_after_the_drag_and_lets_it_down_after() -> void:
	var router := _router()
	var dowel := data.joints[router.play.open_joints()[0]].hardware
	var floor_y := router.play.bonds.poses[dowel].origin.y
	var at := _grab(router, dowel, 0)
	# Clear of every hole, so letting go seats nothing.
	at = _carry_to(router, Vector3(1.5, 0, -1.5))
	router.set_shift(true)
	router.wheel(-80.0, at)
	var up := router.drag.height
	router.release(Router.LEFT, at, 2000)
	for i: int in HOLD_FRAMES:
		router.update(DT)
	assert_float(router.play.bonds.poses[dowel].origin.y).is_equal_approx(up, 1e-4)
	router.set_shift(false)
	assert_float(router.play.bonds.poses[dowel].origin.y).is_equal_approx(floor_y, 1e-6)


func test_a_panel_carries_the_dowel_seated_in_it() -> void:
	var router := _router()
	var play := router.play
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	_seat(play, i)
	var rel := play.bonds.relative_pose(spec.host, spec.hardware)
	_grab(router, spec.host, 0)
	assert_bool(router.carried().has(spec.hardware)).is_true()
	_carry_to(router, play.bonds.poses[spec.host].origin + Vector3(0.3, 0, -0.2))
	assert_bool(play.bonds.relative_pose(spec.host, spec.hardware).is_equal_approx(rel)).is_true()
	assert_object(play.bonds.joint_for_spec(i)).is_not_null()


func test_a_part_let_go_with_no_seat_comes_down_onto_the_floor() -> void:
	var router := _router()
	var dowel := data.joints[router.play.open_joints()[0]].hardware
	var floor_y := router.play.bonds.poses[dowel].origin.y
	var at := _grab(router, dowel, 0)
	router.wheel(-200.0, at)
	at = _carry_to(router, Vector3(1.5, 0, -1.5))
	router.release(Router.LEFT, at, 2000)
	assert_float(router.play.bonds.poses[dowel].origin.y).is_equal_approx(floor_y, 1e-6)
