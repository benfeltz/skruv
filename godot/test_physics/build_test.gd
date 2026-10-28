extends GdUnitTestSuite
## Physics as you build (2.0.4.4 step 7): the scripted hand builds JOHNNY in the room through the
## router, with every part a Jolt body (scenes/physics_bridge.gd): carried and placed parts held,
## the rest the simulation's, fastened joints locked as they fasten. Then the stillness: from the
## moment the manual ends, JOHNNY must hold within MAX_OFFSET_M and MAX_TURN_DEG for HOLD_SECONDS.
## Prints a `build:` line per page turned and a `stillness:` line each second, so a red run keeps
## its numbers. Run apart from test/ with --fixed-fps 60 (loop.sh build): one frame, one tick.

const MAX_OFFSET_M := 0.002
const MAX_TURN_DEG := 0.5
const HOLD_SECONDS := 5
const DT := 1.0 / 60.0
const MAX_FRAMES := 30000
const TICKS := 60

var data: ItemData


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


func test_johnny_built_by_hand_in_jolt_stands() -> void:
	var room: Room = auto_free(Room.new())
	add_child(room)
	var play := Play.new(data, false)
	play.open_page()
	var router := Router.new(play)
	var bridge: PhysicsBridge = auto_free(PhysicsBridge.new(router))
	add_child(bridge)
	await get_tree().physics_frame
	await get_tree().physics_frame
	var hand := Hand.new(router)
	var page := 0
	while hand.step(DT) and hand.frames < MAX_FRAMES:
		await get_tree().physics_frame
		if play.steps.index != page:
			page = play.steps.index
			var shape_now := play.worst_error(true)
			print("build: page %d open at frame %d, %d physics joints, %d held; shape %.2f mm (%s) / %.3f deg (%s)" % [page + 1, hand.frames, bridge.joints.size(), router.kinematic().size(),
				float(shape_now["offset"]) * 1000.0, shape_now["offset_id"], rad_to_deg(float(shape_now["turn"])), shape_now["turn_id"]])
	for line: String in hand.lines:
		print("build: %s" % line)
	var fastened := 0
	for joint: Bonds.Joint in play.bonds.joints:
		if Fastener.is_fastened(joint.fastener):
			fastened += 1
	var shape := play.worst_error()
	print("build: %d frames, %d errors; %d of %d joints fastened, %d physics joints; at done the shape is within %.2f mm (%s) and %.3f deg (%s) of the finished item" % [
		hand.frames, hand.errors.size(), fastened, data.joints.size(), bridge.joints.size(),
		float(shape["offset"]) * 1000.0, shape["offset_id"], rad_to_deg(float(shape["turn"])), shape["turn_id"]])
	assert_array(hand.errors).override_failure_message("\n".join(hand.errors)).is_empty()
	assert_bool(play.steps.is_done()).is_true()
	assert_int(play.auto_log.size()).is_equal(0)
	assert_int(fastened).is_equal(data.joints.size())
	# The stillness: from "done", 5 s of Jolt.
	var start := bridge.snapshot()
	var moved: Dictionary = {}
	for second: int in range(1, HOLD_SECONDS + 1):
		for tick: int in TICKS:
			router.update(DT)
			await get_tree().physics_frame
		moved = bridge.moved_since(start)
		print("stillness: t=%ds offset=%.2fmm (%s) turn=%.3fdeg (%s) asleep=%d/%d" % [second, float(moved["offset"]) * 1000.0, moved["offset_id"], rad_to_deg(float(moved["turn"])), moved["turn_id"], bridge.asleep(), data.instances.size()])
	assert_float(float(moved["offset"])).override_failure_message("%s moved %.2f mm in %d s" % [moved["offset_id"], float(moved["offset"]) * 1000.0, HOLD_SECONDS]).is_less(MAX_OFFSET_M)
	assert_float(rad_to_deg(float(moved["turn"]))).override_failure_message("%s turned %.3f deg in %d s" % [moved["turn_id"], rad_to_deg(float(moved["turn"])), HOLD_SECONDS]).is_less(MAX_TURN_DEG)
