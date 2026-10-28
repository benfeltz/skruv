extends GdUnitTestSuite
## The acceptance test: the whole manual played headless against the real export by the scripted
## hand (logic/hand.gd), through the router with screen points as a mouse plays it: press on the
## part, drag it, lift it with the wheel, carry it near its seat, hold still while self-aim,
## magnetism and seat assist bring it in, let go, click it home. Auto pages fasten themselves. At
## the end every joint is fastened and every part of JOHNNY is within MAX_OFFSET_M and MAX_TURN_DEG
## of its assembled pose. Played twice: the web's open snap (Constants.knobs.pageGating off, the
## default) and 2.0.4.3's page gating.
##
## Prints `playthrough:` lines (the hand's moves, the auto pages, a summary), so a run keeps its
## numbers.

## Plan 2.0.4.3: every part within 2 mm of assembled.
const MAX_OFFSET_M := 0.002
## And turned no more than this from it (the stillness test's bar).
const MAX_TURN_DEG := 0.5
const DT := 1.0 / 60.0
## Frames the whole manual may take before the test calls it stuck.
const MAX_FRAMES := 60000
## The pages the loop still fastens itself: none (2.0.4.4 step 6). The plan's count was 9 → 6 → 1 →
## 0; page 8's face-down turn is the tip's gesture, so it went 9 → 6 → 2 → 0.
const AUTO_PAGES: Array[int] = []

var data: ItemData


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


## Plays the manual with gating `gate`; returns the hand when done.
func _play(gate: bool) -> Hand:
	var play := Play.new(data, gate)
	play.open_page()
	var router := Router.new(play)
	var hand := Hand.new(router)
	while hand.step(DT) and hand.frames < MAX_FRAMES:
		pass
	return hand


func _assert_built(hand: Hand, label: String) -> void:
	var play := hand.play
	for line: String in hand.lines:
		print("playthrough: %s %s" % [label, line])
	for line: String in play.auto_log:
		print("playthrough: %s %s" % [label, line])
	var fastened := 0
	for joint: Bonds.Joint in play.bonds.joints:
		if Fastener.is_fastened(joint.fastener):
			fastened += 1
	var worst := play.worst_error()
	print("playthrough: %s %d frames; %d pairs seated, %d joints pressed by a click, %d cranked, %d driven, %d quarter turns; %d auto pages; %d of %d joints fastened; worst offset %.4f mm (%s), worst turn %.4f deg (%s)" % [
		label, hand.frames, hand.seats, hand.presses, hand.cranks, hand.drives, hand.turnings, play.auto_log.size(), fastened, data.joints.size(),
		float(worst["offset"]) * 1000.0, worst["offset_id"], rad_to_deg(float(worst["turn"])), worst["turn_id"]])
	assert_array(hand.errors).override_failure_message("%s: %s" % [label, "\n".join(hand.errors)]).is_empty()
	var auto_pages: Array[int] = []
	for step: ItemData.Step in data.steps:
		if play.steps.is_auto(step):
			auto_pages.append(step.number)
	assert_array(auto_pages).override_failure_message("%s: auto pages %s" % [label, auto_pages]).is_equal(AUTO_PAGES)
	assert_int(play.auto_log.size()).is_equal(AUTO_PAGES.size())
	assert_bool(play.steps.is_done()).override_failure_message("%s: the manual did not end (page %s)" % [label, play.steps.current().number if play.steps.current() != null else -1]).is_true()
	assert_int(fastened).is_equal(data.joints.size())
	assert_int(play.bonds.joints.size()).is_equal(data.joints.size())
	for i: int in data.joints.size():
		assert_object(play.bonds.joint_for_spec(i)).override_failure_message("%s: joint %d never seated" % [label, i]).is_not_null()
	assert_float(float(worst["offset"])).override_failure_message("%s: %s is %.3f mm off" % [label, worst["offset_id"], float(worst["offset"]) * 1000.0]).is_less(MAX_OFFSET_M)
	assert_float(rad_to_deg(float(worst["turn"]))).override_failure_message("%s: %s is turned %.3f deg" % [label, worst["turn_id"], rad_to_deg(float(worst["turn"]))]).is_less(MAX_TURN_DEG)


func test_the_whole_manual_plays_with_the_open_snap() -> void:
	_assert_built(_play(false), "open")


func test_the_whole_manual_plays_with_page_gating() -> void:
	_assert_built(_play(true), "gated")


## Gated, a dowel from the other end of the box seats where the page wants one: the booklet goes by
## type.
func test_gated_any_loose_dowel_fills_a_dowel_hole_the_page_wants() -> void:
	var play := Play.new(data, true)
	play.open_page()
	var i := play.open_joints()[0]
	var spec := data.joints[i]
	var hole := play.bonds.world_connector(spec.host, spec.host_connector)
	var end := Snap.WorldConnector.new("dowelEnd", hole.position, -hole.axis, "dowel-14", 0)
	assert_bool(play.allows(end, hole)).is_true()
	# A hole of a page not open yet is no seat.
	var side := data.joints[1]
	var other := Snap.WorldConnector.new("dowelHole", Vector3.ZERO, Vector3.UP, side.host, side.host_connector)
	assert_bool(play.allows(end, other)).is_false()


func test_a_part_far_from_any_seat_is_offered_nothing() -> void:
	var play := Play.new(data)
	play.open_page()
	var spec := data.joints[play.open_joints()[0]]
	var carry := Play.Carry.new()
	carry.part = spec.hardware
	carry.start = play.bonds.poses[spec.hardware]
	assert_object(play.snap_candidate(carry, carry.start.translated(Vector3(0.0, 0.5, 0.0)), null)).is_null()
