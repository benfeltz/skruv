extends GdUnitTestSuite
## logic/camera.gd against the ideas of test/cameraLimits.test.ts and test/cameraPivot.test.ts,
## plus the orbit it drives: polar and distance limits, damping, the pivot, the seam, and the
## View's projection agreeing with a real Camera3D. And the router's camera fallthrough.

const EPS := 1e-6
const ROOM := Vector2(Constants.ROOM.width, Constants.ROOM.depth)


func test_a_target_over_the_floor_is_left_alone_and_held_inside_the_walls() -> void:
	assert_vector(OrbitCamera.clamp_target(Vector3(1.5, 0, -1.5))).is_equal(Vector3(1.5, 0, -1.5))
	var reach := ROOM / 2.0 - Vector2.ONE * Constants.CAMERA_LIMITS.targetMargin
	assert_vector(OrbitCamera.clamp_target(Vector3(9, 5, -9))).is_equal_approx(Vector3(reach.x, Constants.CAMERA_LIMITS.targetHeight.y, -reach.y), Vector3.ONE * EPS)
	assert_vector(OrbitCamera.clamp_target(Vector3(-9, -1, 9))).is_equal_approx(Vector3(-reach.x, 0, reach.y), Vector3.ONE * EPS)


func test_the_zoom_out_limit_grows_with_a_taller_view() -> void:
	var m := Constants.CAMERA_LIMITS.maxDistance
	assert_float(OrbitCamera.zoom_out_limit(844.0 / 390.0)).is_equal(m)
	assert_float(OrbitCamera.zoom_out_limit(1.0)).is_equal(m)
	assert_float(OrbitCamera.zoom_out_limit(390.0 / 844.0)).is_equal_approx(m * 844.0 / 390.0, EPS)
	assert_float(OrbitCamera.zoom_out_limit(0.0)).is_equal(m)
	assert_float(OrbitCamera.zoom_out_limit(NAN)).is_equal(m)


func test_the_camera_stays_above_the_floor_and_is_otherwise_free() -> void:
	assert_vector(OrbitCamera.clamp_camera(Vector3(7, 1, -7))).is_equal(Vector3(7, 1, -7))
	assert_vector(OrbitCamera.clamp_camera(Vector3(0, -0.3, 0))).is_equal(Vector3(0, Constants.CAMERA_LIMITS.floorClearance, 0))
	assert_vector(OrbitCamera.clamp_camera(Vector3(0, 12, 0))).is_equal(Vector3(0, 12, 0))


func test_panning_speeds_up_close_in_capped() -> void:
	assert_float(OrbitCamera.pan_speed_at(1.2)).is_equal(1.0)
	assert_float(OrbitCamera.pan_speed_at(4.0)).is_equal(1.0)
	assert_float(OrbitCamera.pan_speed_at(0.6)).is_equal_approx(2.0, EPS)
	assert_float(OrbitCamera.pan_speed_at(0.05)).is_equal(Constants.CAMERA_LIMITS.maxPanBoost)
	assert_float(OrbitCamera.pan_speed_at(0.0)).is_equal(Constants.CAMERA_LIMITS.maxPanBoost)


func test_the_start_is_within_the_limits() -> void:
	var eye := Constants.CAMERA.startPosition
	var target := Constants.CAMERA.startTarget
	assert_vector(OrbitCamera.clamp_target(target)).is_equal(target)
	var offset := eye - target
	var polar := acos(offset.y / offset.length())
	assert_float(polar).is_between(Constants.CAMERA_LIMITS.minPolarAngle, Constants.CAMERA_LIMITS.maxPolarAngle)
	assert_float(offset.length()).is_between(Constants.CAMERA_LIMITS.minDistance, Constants.CAMERA_LIMITS.maxDistance)
	assert_vector(OrbitCamera.start_position(Vector3(2, 1, 0), Vector3(0, 1, 0), 1.5)).is_equal(Vector3(3, 1, 0))


func test_a_target_below_the_floor_slides_back_along_the_view() -> void:
	var eye := Vector3(0, 2, 2)
	var t := OrbitCamera.clamp_target_along_view(Vector3(0, -1, -1), eye)
	assert_float(t.y).is_equal_approx(0.0, EPS)
	# Still on the line from the eye: the view does not tilt.
	assert_float((t - eye).normalized().dot((Vector3(0, -1, -1) - eye).normalized())).is_equal_approx(1.0, EPS)


func test_the_pivot_stops_at_the_first_part_else_the_floor() -> void:
	var eye := Vector3(0, 2, 2)
	var target := Vector3(0, 1, 1)
	var to_floor := OrbitCamera.pivot_along_view(eye, target, -1.0)
	assert_float(to_floor.y).is_equal_approx(0.0, EPS)
	var at_part := OrbitCamera.pivot_along_view(eye, target, 1.0)
	assert_float(at_part.distance_to(eye)).is_equal_approx(1.0, EPS)
	# Nearer than minDistance is ignored: the floor stands.
	assert_float(OrbitCamera.pivot_along_view(eye, target, 0.01).y).is_equal_approx(0.0, EPS)


func test_orbiting_holds_the_polar_angle_inside_its_limits() -> void:
	var cam := OrbitCamera.new()
	for i: int in 200:
		cam.press(0, Vector2(500, 300))
		cam.motion(Vector2(500, 300 + 200))
		cam.release(0)
		cam.update(1.0 / 60.0)
	var offset := cam.free - cam.target
	assert_float(acos(offset.y / offset.length())).is_equal_approx(Constants.CAMERA_LIMITS.minPolarAngle, 1e-4)
	for i: int in 200:
		cam.press(0, Vector2(500, 500))
		cam.motion(Vector2(500, 300))
		cam.release(0)
		cam.update(1.0 / 60.0)
	offset = cam.free - cam.target
	assert_float(acos(offset.y / offset.length())).is_equal_approx(Constants.CAMERA_LIMITS.maxPolarAngle, 1e-4)


func test_zoom_is_held_between_min_and_max_distance() -> void:
	var cam := OrbitCamera.new()
	for i: int in 300:
		cam.wheel(-OrbitCamera.WHEEL_NOTCH_PX, cam.viewport / 2.0)
		cam.update(1.0 / 60.0)
	assert_float(cam.free.distance_to(cam.target)).is_equal_approx(Constants.CAMERA_LIMITS.minDistance, 1e-4)
	for i: int in 300:
		cam.wheel(OrbitCamera.WHEEL_NOTCH_PX, cam.viewport / 2.0)
		cam.update(1.0 / 60.0)
	assert_float(cam.free.distance_to(cam.target)).is_equal_approx(cam.max_distance(), 1e-4)


func test_an_orbit_is_damped_it_carries_on_after_the_pointer_stops() -> void:
	var cam := OrbitCamera.new()
	cam.press(0, Vector2(500, 300))
	cam.motion(Vector2(600, 300))
	cam.release(0)
	cam.update(1.0 / 60.0)
	var after_one := cam.free
	cam.update(1.0 / 60.0)
	assert_bool(cam.free.is_equal_approx(after_one)).is_false()


func test_pan_moves_target_and_eye_together() -> void:
	var cam := OrbitCamera.new()
	cam.press(2, Vector2(500, 300))
	# The press picked its pivot (the floor along the view): from here on a pan only slides.
	var before := cam.free - cam.target
	var target := cam.target
	cam.motion(Vector2(450, 300))
	for i: int in 60:
		cam.update(1.0 / 60.0)
	assert_bool(cam.target.is_equal_approx(target)).is_false()
	assert_vector(cam.free - cam.target).is_equal_approx(before, Vector3.ONE * 1e-4)


func test_disabled_the_orbit_ignores_input() -> void:
	var cam := OrbitCamera.new()
	var eye := cam.free
	cam.disable()
	cam.press(0, Vector2(500, 300))
	cam.motion(Vector2(800, 100))
	cam.wheel(-500.0, Vector2(500, 300))
	cam.update(1.0 / 60.0)
	assert_vector(cam.free).is_equal_approx(eye, Vector3.ONE * EPS)


func test_the_router_hands_empty_space_to_the_camera_and_a_part_press_takes_it() -> void:
	var router := Router.new()
	router.hit_test = func(at: Vector2) -> Dictionary: return {"kind": "part", "id": "p"} if at.x < 100 else {}
	router.press(0, Vector2(500, 300), 0)
	assert_bool(router.camera.enabled).is_true()
	router.release(0, Vector2(500, 300), 50)
	router.press(0, Vector2(50, 300), 100)
	assert_bool(router.camera.enabled).is_false()
	var eye := router.camera.free
	router.motion(Vector2(300, 300))
	router.update(1.0 / 60.0)
	assert_vector(router.camera.free).is_equal_approx(eye, Vector3.ONE * EPS)
	router.release(0, Vector2(300, 300), 2000)
	assert_bool(router.camera.enabled).is_true()
	# A right press on a part is the camera's: the gesture machine never gives it to a part.
	router.press(2, Vector2(50, 300), 3000)
	assert_bool(router.camera.enabled).is_true()


func test_the_view_projects_as_a_camera3d_does() -> void:
	var cam: Camera3D = auto_free(Camera3D.new())
	cam.fov = Constants.CAMERA.fov
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	add_child(cam)
	var size := get_viewport().get_visible_rect().size
	var view := OrbitCamera.View.new(Vector3(2, 1.8, 2.4), Vector3(0, 0.6, 0), Constants.CAMERA.fov, size)
	cam.look_at_from_position(view.eye, view.target, Vector3.UP)
	for p: Vector3 in [Vector3.ZERO, Vector3(0.4, 1.2, -0.3), Vector3(-1, 0.02, 1)]:
		assert_vector(view.project(p)).is_equal_approx(cam.unproject_position(p), Vector2.ONE * 0.01)
	var screen := Vector2(300, 200)
	assert_vector(view.ray(screen)).is_equal_approx(cam.project_ray_normal(screen), Vector3.ONE * 1e-4)
