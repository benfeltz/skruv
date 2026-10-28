extends GdUnitTestSuite
## logic/fit_rank.gd against test/panelFit.test.ts's "where it goes, and ranking" and "heldOffer"
## specs, on the real export: the bottom panel onto the side panel's dowels.

const EPS := 1e-6

var data: ItemData
var play: Play


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


func before_test() -> void:
	play = Play.new(data)


func _assembled(id: String) -> Transform3D:
	var inst := data.instance(id)
	return Transform3D(Basis(inst.rotation), inst.position)


## The side panel at its assembled pose with its two bottom-panel dowels in it, pushed home: their
## free ends are where the bottom panel's holes go.
func _ends() -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	for spec: ItemData.JointSpec in data.joints:
		if spec.host != "topBottomPanel-1" or spec.kind != "dowel":
			continue
		for other: ItemData.JointSpec in data.joints:
			if other.hardware == spec.hardware and other.host == "sidePanel-1":
				var c := data.type_of(data.instance(spec.hardware)).connectors[spec.hardware_connector]
				out.append(Snap.in_world(c.type, c.position, c.axis, _assembled(spec.hardware), spec.hardware, spec.hardware_connector))
	return out


func _holes(pose: Transform3D) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	var connectors := data.type_of(data.instance("topBottomPanel-1")).connectors
	for i: int in connectors.size():
		var c := connectors[i]
		out.append(Snap.in_world(c.type, c.position, c.axis, pose, "topBottomPanel-1", i))
	return out


func _preferred() -> Array[Transform3D]:
	return FitRank.preferred_poses(play.relatives, "sidePanel", _assembled("sidePanel-1"), "topBottomPanel")


func test_the_bottom_panel_goes_on_a_side_panel_as_the_finished_johnny_has_it() -> void:
	var bottom := _assembled("topBottomPanel-1")
	for side: String in ["sidePanel-1", "sidePanel-2"]:
		var found := false
		for pose: Transform3D in FitRank.preferred_poses(play.relatives, "sidePanel", _assembled(side), "topBottomPanel"):
			if pose.origin.distance_to(bottom.origin) < EPS and pose.basis.is_equal_approx(bottom.basis):
				found = true
		assert_bool(found).override_failure_message("not where it goes on %s" % side).is_true()
	assert_bool(play.relatives.by_host.has("dowel")).is_false()


func test_where_it_goes_ranks_first_and_a_fit_one_hole_off_still_follows() -> void:
	var seat := _assembled("topBottomPanel-1")
	var ends := _ends()
	assert_int(ends.size()).is_equal(2)
	var from := Transform3D(seat.basis, seat.origin + Vector3(0.0, 0.03, 0.09))
	var fits := PanelFit.find_fits(_holes(from), from, ends, PanelFit.FitWindow.panel(), data.compatible)
	var ranked := FitRank.rank_fits(fits, _preferred())
	assert_bool(ranked[0].preferred).is_true()
	assert_int(ranked[0].fit.pairs.size()).is_equal(2)
	assert_float(ranked[0].fit.pose.origin.distance_to(seat.origin)).is_less(0.016)
	var off := false
	for n: int in range(1, ranked.size()):
		if ranked[n].fit.pairs.size() == 1 and not ranked[n].preferred:
			off = true
	assert_bool(off).override_failure_message("no one-hole-off fit after where it goes").is_true()


func test_with_nothing_where_it_goes_most_pairs_then_nearest() -> void:
	var seat := _assembled("topBottomPanel-1")
	var from := Transform3D(seat.basis, seat.origin + Vector3(0.0, 0.03, 0.09))
	var none: Array[Transform3D] = []
	var ranked := FitRank.rank_fits(PanelFit.find_fits(_holes(from), from, _ends(), PanelFit.FitWindow.panel(), data.compatible), none)
	assert_int(ranked[0].fit.pairs.size()).is_equal(2)
	for n: int in range(1, ranked.size()):
		var a := ranked[n - 1].fit
		var b := ranked[n].fit
		assert_bool(a.pairs.size() > b.pairs.size() or (a.pairs.size() == b.pairs.size() and a.distance <= b.distance)).is_true()


func test_the_ends_where_it_goes_are_found_and_none_far_off() -> void:
	var at := _assembled("topBottomPanel-1")
	assert_int(FitRank.preferred_targets(_holes(at), _ends(), data.compatible).size()).is_equal(2)
	assert_int(FitRank.preferred_targets(_holes(at.translated(Vector3(0.5, 0, 0))), _ends(), data.compatible).size()).is_equal(0)


func _offer(key: String, x: float, preferred: bool = false, pairs: int = 2) -> Play.Offer:
	var o := Play.Offer.new()
	o.key = key
	o.pose = Transform3D(Basis(), Vector3(x, 0.3, 0))
	o.preferred = preferred
	for n: int in pairs:
		o.pairs.append(Play.Pair.new())
	return o


func _taken(o: Play.Offer, finger: Transform3D) -> Play.Offer:
	o.taken = finger
	o.has_taken = true
	return o


func _finger(x: float, turn: float = 0.0) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, turn), Vector3(x, 0, 0))


func test_held_offer_takes_the_first_and_notes_the_finger() -> void:
	var next := _offer("a", 0.05)
	var got := FitRank.held_offer(null, next, _finger(0))
	assert_object(got).is_same(next)
	assert_bool(got.has_taken).is_true()
	assert_object(FitRank.held_offer(null, null, _finger(0))).is_null()


func test_held_offer_holds_through_a_gap_and_lets_go_outside_the_window() -> void:
	var current := _taken(_offer("a", 0.6), _finger(0))
	assert_object(FitRank.held_offer(current, null, _finger(Constants.PANEL.holdReach - 0.01))).is_same(current)
	assert_object(FitRank.held_offer(_taken(_offer("a", 0), _finger(0)), null, _finger(Constants.PANEL.holdReach + 0.01))).is_null()
	var next := _offer("b", 0.01)
	assert_object(FitRank.held_offer(_taken(_offer("a", 0), _finger(0)), next, _finger(0, Constants.PANEL.holdTurn + 0.05))).is_same(next)


func test_held_offer_keeps_the_same_fit_and_takes_it_once_where_it_goes() -> void:
	var current := _taken(_offer("a", 0.03), _finger(0))
	assert_object(FitRank.held_offer(current, _offer("a", 0.05), _finger(0.01))).is_same(current)
	var now := _offer("a", 0.04, true)
	assert_object(FitRank.held_offer(current, now, _finger(0.01))).is_same(now)
	assert_bool(now.taken.is_equal_approx(_finger(0))).is_true()


func test_held_offer_holds_against_one_as_good_unless_clearly_nearer() -> void:
	var current := _taken(_offer("a", 0.03), _finger(0))
	assert_object(FitRank.held_offer(current, _offer("b", 0.03), _finger(0.02))).is_same(current)
	assert_object(FitRank.held_offer(current, _offer("b", 0.03 - Constants.PANEL.offerMargin / 2.0), _finger(0))).is_same(current)
	var slid := _offer("b", 0.1)
	assert_object(FitRank.held_offer(_taken(_offer("a", 0.5), _finger(0)), slid, _finger(0.05))).is_same(slid)


func test_held_offer_gives_way_to_where_it_goes_and_more_pairs_never_back() -> void:
	var right := _offer("b", 0.1, true)
	assert_object(FitRank.held_offer(_taken(_offer("a", 0.01), _finger(0)), right, _finger(0))).is_same(right)
	assert_object(FitRank.held_offer(right, _offer("a", 0.01), _finger(0))).is_same(right)
	var more := _offer("c", 0.1, false, 3)
	assert_object(FitRank.held_offer(_taken(_offer("a", 0.01), _finger(0)), more, _finger(0))).is_same(more)
	assert_object(FitRank.held_offer(more, _offer("a", 0.01), _finger(0))).is_same(more)
