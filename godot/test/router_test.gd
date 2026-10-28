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


func test_a_pressed_dowel_pulled_along_its_axis_comes_out_and_carries_on_free() -> void:
	var router := _router()
	var play := router.play
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	var joint := _seat(play, i)
	play.tap(spec.hardware)
	assert_str(joint.fastener.state).is_equal(Fastener.PRESSED)
	var at := _grab(router, spec.hardware, 0)
	assert_str(router.drag.mode).is_equal(Router.PULL)
	# Across the axis: nothing. Along it, past the pull distance: out to seated, then free.
	var axis: Vector2 = router.drag.pull_axes[0].normalized()
	var across := Vector2(-axis.y, axis.x)
	router.motion(at + across * (Constants.FASTENER.pullDistance + 10.0))
	assert_str(joint.fastener.state).is_equal(Fastener.PRESSED)
	router.motion(at + axis * (Constants.FASTENER.pullDistance + 5.0))
	assert_str(joint.fastener.state).is_equal(Fastener.SEATED)
	assert_str(router.drag.mode).is_equal(Router.MOVE)
	assert_object(play.bonds.joint_for_spec(i)).override_failure_message("still seated once pulled free").is_null()


func test_a_pressed_dowel_held_by_a_locked_cam_is_no_pull_it_moves_its_compound() -> void:
	var router := _router()
	var play := router.play
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	_seat(play, i)
	play.tap(spec.hardware)
	# Its own pull is the only way out; a bolt partway in is not pullable, so this is the web's
	# compound drag: grab the plinth (no pull: its dowels are the movers) and it all comes along.
	_grab(router, spec.host, 0)
	assert_str(router.drag.mode).is_equal(Router.MOVE)
	assert_bool(router.carried().has(spec.hardware)).is_true()


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


## A side panel pressed onto a dowel is pulled back off it along the dowel, and carried on free.
func test_a_panel_pressed_onto_its_dowel_pulls_off_along_it() -> void:
	var router := _router()
	var play := router.play
	var into := _seat(play, 0)
	play.tap(into.hardware)
	var spec := data.joints[1]
	assert_str(spec.mover).is_equal("sidePanel-1")
	var home: Transform3D = play.goal("sidePanel-1", 1)
	var hole_axis := Transform3D(home.basis, home.origin) * data.type_of(data.instance("sidePanel-1")).connectors[spec.host_connector].axis - home.origin
	play.bonds.poses["sidePanel-1"] = Transform3D(home.basis, home.origin + hole_axis.normalized() * data.sink_depth["dowel"])
	var joint := play.bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.mover, 1)
	play.tap("sidePanel-1")
	assert_str(joint.fastener.state).is_equal(Fastener.PRESSED)
	var at := _grab(router, "sidePanel-1", 0)
	assert_str(router.drag.mode).is_equal(Router.PULL)
	router.motion(at + router.drag.pull_axes[0].normalized() * (Constants.FASTENER.pullDistance + 5.0))
	assert_str(joint.fastener.state).is_equal(Fastener.SEATED)
	assert_str(router.drag.mode).is_equal(Router.MOVE)
	assert_bool(play.bonds.joints.has(joint)).override_failure_message("still seated on the dowel once pulled off").is_false()


## A bolt seated, the wrench let go on its head: a sweep round the dial the tightening way screws
## it home and the wrench comes off by itself; a tap on a seated tool takes it off.
func test_a_wrench_on_a_seated_bolt_cranks_it_home_and_comes_off() -> void:
	var play := Play.new(data)
	play.open_page()
	var router := Router.new(play)
	var spec := data.joints[28]
	play.bonds.poses[spec.host] = _assembled_at(spec.host)
	var home := _assembled_at(spec.hardware)
	var axis := play.bonds.world_connector(spec.host, spec.host_connector).axis
	play.bonds.poses[spec.hardware] = Transform3D(home.basis, home.origin + axis * data.sink_depth["bolt"])
	var bolt := play.bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.hardware, 28)
	# The wrench straight on the head, as a release on an offer leaves it.
	var head := play.bonds.world_connector(spec.hardware, 1)
	var tip := data.types["allenWrench"].connectors[0]
	var r := Assist.aimed_rotation(Basis(), tip.axis, head.axis)
	play.bonds.poses["allenWrench-1"] = Transform3D(r, head.position - r * tip.position)
	var tool := play.bonds.seat("allenWrench-1", 0, spec.hardware, 1, "allenWrench-1")
	router.tool_grips["allenWrench-1"] = play.bonds.relative_pose(spec.hardware, "allenWrench-1")
	var turn := play.bonds.turn_of("allenWrench-1")
	assert_object(turn).is_not_null()
	assert_object(turn.joints[0]).is_same(bolt)
	router.camera.frame(head.position + Vector3(0.3, 0.6, 0.5), head.position)
	var centre := router.screen_of(router.turn_centre(turn))
	var sign := Crank.tighten_sign(router.turn_axis(turn), router.turn_centre(turn) - router.view().eye)
	var rr := Constants.TURN_RING.radius
	router.press(Router.LEFT, centre + Vector2(rr, 0), 0)
	assert_str(String(router.gesture.owner)).is_equal(Gesture.DRAG_PART)
	var angle := 0.0
	for n: int in 60:
		angle += sign * PI / 9.0
		router.motion(centre + Vector2(cos(angle), sin(angle)) * rr)
	router.release(Router.LEFT, centre, 2000)
	assert_str(bolt.fastener.state).is_equal(Fastener.SCREWED)
	assert_bool(play.bonds.joints.has(tool)).override_failure_message("the wrench stayed on at home").is_false()
	# Put back on, a tap takes it off; a sweep the other way backs the bolt out (it is no cam's).
	play.bonds.poses["allenWrench-1"] = Transform3D(r, play.bonds.world_connector(spec.hardware, 1).position - r * tip.position)
	tool = play.bonds.seat("allenWrench-1", 0, spec.hardware, 1, "allenWrench-1")
	router.press(Router.LEFT, centre + Vector2(rr, 0), 3000)
	angle = 0.0
	for n: int in 10:
		angle -= sign * PI / 9.0
		router.motion(centre + Vector2(cos(angle), sin(angle)) * rr)
	router.release(Router.LEFT, centre, 5000)
	assert_float(bolt.fastener.progress).is_less(1.0)
	assert_str(bolt.fastener.state).is_equal(Fastener.SCREWED)
	var on := router.point_on("allenWrench-1")
	router.press(Router.LEFT, on, 6000)
	router.release(Router.LEFT, on, 6050)
	assert_bool(play.bonds.joints.has(tool)).is_false()


func _assembled_at(id: String) -> Transform3D:
	var inst := data.instance(id)
	return Transform3D(Basis(inst.rotation), inst.position)


## A tap selects a part and brings up its rings; a sweep along one turns the part (and what is
## joined to it) a quarter turn about that world axis, lifted clear, and it comes down on release;
## a tap on empty space puts the rings away.
func test_a_ring_sweep_turns_the_part_a_quarter_turn_and_it_comes_down() -> void:
	var router := _router()
	var play := router.play
	var id := "plinth-1"
	var start := play.bonds.poses[id]
	var on := router.point_on(id) if router.point_on(id).x >= 0.0 else Vector2(-1, -1)
	var centre_world := start.origin
	router.camera.frame(centre_world + Vector3(1, 1, 1).normalized() * 2.5, centre_world)
	on = router.point_on(id)
	router.press(Router.LEFT, on, 0)
	router.release(Router.LEFT, on, 50)
	assert_str(router.selected).is_equal(id)
	var f := router.ring_frame()
	assert_float(f.w).is_greater(0.0)
	# A point on the y ring that presses it.
	var at := Vector2(-1, -1)
	for n: int in Router.RING_SAMPLES:
		var a := TAU * n / Router.RING_SAMPLES
		var p := centre_world + Vector3(cos(a), 0, sin(a)) * f.w
		var s := router.screen_of(p)
		var hit := router.hit_at(s)
		if hit.get("kind", "") == "ring" and hit.get("axis", "") == "y":
			at = s
			break
	assert_bool(at.x >= 0.0).override_failure_message("no point presses the y ring").is_true()
	router.press(Router.LEFT, at, 100)
	assert_str(String(router.gesture.owner)).is_equal(Gesture.GIZMO_RING)
	var c := router.screen_of(centre_world)
	var r := at.distance_to(c)
	var phi0 := atan2(c.y - at.y, at.x - c.x)
	for n: int in range(1, 13):
		var phi := phi0 + (PI / 2.0) * n / 12.0
		router.motion(c + Vector2(cos(phi), -sin(phi)) * r)
	var lifted := play.bonds.poses[id].origin.y
	assert_float(lifted).is_greater(start.origin.y)
	router.release(Router.LEFT, c + Vector2(cos(phi0 + PI / 2.0), -sin(phi0 + PI / 2.0)) * r, 900)
	var turned := start.basis.get_rotation_quaternion().angle_to(play.bonds.poses[id].basis.get_rotation_quaternion())
	assert_float(turned).is_equal_approx(PI / 2.0, 1e-5)
	# About the vertical: still up the same way, and back down on the floor.
	assert_vector((play.bonds.poses[id].basis * start.basis.inverse()) * Vector3.UP).is_equal_approx(Vector3.UP, Vector3.ONE * 1e-5)
	# Down onto what is under it (the floor, or the panel lying next to it).
	assert_float(play.bonds.poses[id].origin.y).is_less(lifted)
	assert_float(play.box_of(id).position.y).is_greater_equal(-1e-6)
	# A tap on empty space: the rings go.
	router.camera.frame(Vector3(0, 2.0, 2.4), Vector3(0, 2.6, -1))
	var sky := Vector2(10, 10)
	assert_bool(router.hit_at(sky).is_empty()).is_true()
	router.press(Router.LEFT, sky, 2000)
	router.release(Router.LEFT, sky, 2050)
	assert_str(router.selected).is_equal("")


func test_quarter_turns_find_how_to_stand_a_build_as_a_page_has_it() -> void:
	var lying := Basis(Steps.POSES["lying"])
	assert_bool(Steps.stands_as("lying", lying)).is_true()
	assert_bool(Steps.stands_as("upright", lying)).is_false()
	# Any heading about the vertical counts.
	assert_bool(Steps.stands_as("lying", Basis(Vector3.UP, 0.7) * lying)).is_true()
	var turns := Hand.quarter_turns(lying, "faceDown")
	assert_int(turns.size()).is_between(1, 2)
	var b := lying
	for m: Vector4 in turns:
		b = Basis(Vector3(m.x, m.y, m.z), m.w * PI / 2.0) * b
	assert_bool(Steps.stands_as("faceDown", b)).is_true()
