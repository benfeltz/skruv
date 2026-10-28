extends GdUnitTestSuite
## The acceptance test: the whole manual played headless through code against the real export.
## For each dowel page, for each open seat: the part is pressed and dragged (Gesture), carried to
## within a few centimetres and degrees of its seat and held there a second while Play.aim turns
## it (logic/hand.gd, the hand), offered a snap (Play.offer_for, the mouse loop's own call),
## released onto it (Play.seat) and tapped home (Gesture tap, Play.tap). Auto pages fasten themselves. At the end every joint is fastened and every part of
## JOHNNY is within MAX_OFFSET_M of its assembled pose.
##
## Prints a `playthrough:` line per page and a summary, so the run's log keeps its numbers.

## Plan 2.0.4.3: every part within 2 mm of assembled.
const MAX_OFFSET_M := 0.002
## And turned no more than this from it (the stillness test's bar).
const MAX_TURN_DEG := 0.5
## Pointer travel for a drag and the time a tap takes (px, ms), on either side of the thresholds.
const DRAG_PX := 40.0
const TAP_MS := 100

var data: ItemData


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


func _drag(g: Gesture, id: String, t: int) -> void:
	assert_object(g.down(1, 0.0, 0.0, t, {"kind": "part", "id": id})).is_null()
	assert_str(g.move(1, DRAG_PX, 0.0).type).is_equal(Gesture.DRAG_START)
	assert_str(g.up(1, DRAG_PX, 0.0, t + 1000).type).is_equal(Gesture.DRAG_END)


func _tap(g: Gesture, id: String, t: int) -> String:
	g.down(2, 0.0, 0.0, t, {"kind": "part", "id": id})
	var e := g.up(2, 0.0, 0.0, t + TAP_MS)
	assert_str(e.type).is_equal(Gesture.TAP)
	return String(e.hit["id"])


func test_the_whole_manual_plays_headless_and_johnny_stands() -> void:
	var play := Play.new(data)
	var g := Gesture.new()
	play.open_page()
	var t := 0
	var seats := 0
	var offers_snapped := 0
	var guard := 0
	while not play.steps.is_done():
		var step := play.steps.current()
		assert_bool(play.steps.is_auto(step)).override_failure_message("page %d open but auto" % step.number).is_false()
		var number := step.number
		var pages_before := play.steps.index
		for i: int in step.joints:
			if play.bonds.joint_for_spec(i) != null:
				continue
			var id := Hand.carried(play, i)
			assert_bool(play.can_drag(id)).override_failure_message("cannot drag %s" % id).is_true()
			var seat: Variant = play.goal(id, i)
			assert_object(seat).override_failure_message("no goal for %s on joint %d" % [id, i]).is_not_null()
			_drag(g, id, t)
			var held := Hand.hold(play, id, Hand.off_seat(seat))
			var offer := play.offer_for(id, held)
			assert_object(offer).override_failure_message("page %d: no snap for %s at joint %d" % [number, id, i]).is_not_null()
			if offer == null:
				return
			var seated_specs: Array[int] = []
			for p: Play.Pair in offer.pairs:
				seated_specs.append(p.spec)
			assert_bool(seated_specs.has(i)).override_failure_message("page %d: the snap for joint %d seats %s" % [number, i, seated_specs]).is_true()
			var dragged := play.seat(id, offer)
			seats += offer.pairs.size()
			offers_snapped += 1
			var pressed := play.tap(_tap(g, dragged, t + 2000))
			assert_int(pressed.size()).override_failure_message("page %d: tap on %s pressed nothing" % [number, dragged]).is_greater(0)
			t += 5000
			if play.steps.index != pages_before:
				break
		print("playthrough: page %d played: %d joints pressed by tap" % [number, step.joints.size()])
		guard += 1
		assert_int(guard).override_failure_message("the booklet stopped turning").is_less(data.steps.size())
		if guard >= data.steps.size():
			return
	for line: String in play.auto_log:
		print("playthrough: %s" % line)
	var fastened := 0
	for joint: Bonds.Joint in play.bonds.joints:
		if Fastener.is_fastened(joint.fastener):
			fastened += 1
	var worst := play.worst_error()
	print("playthrough: %d snaps seated %d dowel joints; %d of %d joints fastened; worst offset %.4f mm (%s), worst turn %.4f deg (%s)" % [
		offers_snapped, seats, fastened, data.joints.size(), float(worst["offset"]) * 1000.0, worst["offset_id"], rad_to_deg(float(worst["turn"])), worst["turn_id"]])
	assert_int(fastened).is_equal(data.joints.size())
	assert_int(play.bonds.joints.size()).is_equal(data.joints.size())
	for i: int in data.joints.size():
		assert_object(play.bonds.joint_for_spec(i)).override_failure_message("joint %d never seated" % i).is_not_null()
	assert_float(float(worst["offset"])).override_failure_message("%s is %.3f mm off" % [worst["offset_id"], float(worst["offset"]) * 1000.0]).is_less(MAX_OFFSET_M)
	assert_float(rad_to_deg(float(worst["turn"]))).override_failure_message("%s is turned %.3f deg" % [worst["turn_id"], rad_to_deg(float(worst["turn"]))]).is_less(MAX_TURN_DEG)


## A loose dowel stands in for any loose dowel: picking dowel-14 for dowel-1's hole seats it as
## dowel-1, and dowel-14 takes the picked one's spot on the floor.
func test_any_loose_dowel_fills_any_dowel_hole() -> void:
	var play := Play.new(data)
	play.open_page()
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	assert_str(spec.hardware).is_equal("dowel-1")
	var picked_spot := play.bonds.poses["dowel-14"]
	var named_spot := play.bonds.poses["dowel-1"]
	var seat: Variant = play.goal("dowel-14", i)
	assert_object(seat).is_not_null()
	var offer := play.offer_for("dowel-14", Hand.off_seat(seat))
	assert_object(offer).is_not_null()
	assert_str(offer.stand_in).is_equal("dowel-1")
	assert_str(play.seat("dowel-14", offer)).is_equal("dowel-1")
	assert_object(play.bonds.joint_for_spec(i)).is_not_null()
	assert_bool(play.bonds.poses["dowel-14"].is_equal_approx(named_spot)).is_true()
	assert_bool(play.bonds.poses["dowel-1"].is_equal_approx(picked_spot)).is_false()


func test_a_part_far_from_any_seat_is_offered_nothing() -> void:
	var play := Play.new(data)
	play.open_page()
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	var far := play.bonds.poses[spec.hardware].translated(Vector3(0.0, 0.5, 0.0))
	assert_object(play.offer_for(spec.hardware, far)).is_null()
