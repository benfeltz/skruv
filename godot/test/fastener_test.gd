extends GdUnitTestSuite
## logic/fastener.gd and logic/bonds.gd against the ideas of test/fasteners.test.ts and the
## assembly graph: tap seats→pressed, pull pressed→seated, an ignored event is identity; a
## seated pair is joined and keeps its relative pose. Real joints from items/johnny.json.

const EPS := 1e-5
## items/johnny.json joints 0 and 1: dowel-1 into plinth-1, then sidePanel-1 onto its far end.
const INTO_PLINTH := 0
const SIDE_ONTO := 1

var data: ItemData


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


func _assembled(id: String) -> Transform3D:
	var inst := data.instance(id)
	return Transform3D(Basis(inst.rotation), inst.position)


func test_tap_presses_and_pull_brings_it_back() -> void:
	var pressed := Fastener.transition(Fastener.create("dowel"), Fastener.TAP)
	assert_str(pressed.state).is_equal(Fastener.PRESSED)
	assert_float(pressed.progress).is_equal(1.0)
	assert_bool(Fastener.is_fastened(pressed)).is_true()
	var pulled := Fastener.transition(pressed, Fastener.PULL)
	assert_str(pulled.state).is_equal(Fastener.SEATED)
	assert_float(pulled.progress).is_equal(0.0)
	assert_bool(Fastener.is_fastened(pulled)).is_false()


func test_an_ignored_event_returns_the_same_record() -> void:
	var seated := Fastener.create("dowel")
	assert_object(Fastener.transition(seated, Fastener.PULL)).is_same(seated)
	assert_object(Fastener.transition(seated, Fastener.CRANK)).is_same(seated)
	var pressed := Fastener.transition(seated, Fastener.TAP)
	assert_object(Fastener.transition(pressed, Fastener.TAP)).is_same(pressed)


func test_turned_kinds_ignore_a_tap_and_a_pull() -> void:
	for kind: String in ["cam", "bolt"]:
		var seated := Fastener.create(kind)
		for event: String in [Fastener.TAP, Fastener.PULL]:
			assert_object(Fastener.transition(seated, event)).is_same(seated)


## The dowel at its hole's mouth: its assembled pose backed out by the sink depth.
func _dowel_at_mouth(bonds: Bonds) -> void:
	var spec := data.joints[INTO_PLINTH]
	bonds.poses["plinth-1"] = _assembled("plinth-1")
	bonds.poses["dowel-1"] = _assembled("dowel-1").translated(spec.axis * data.sink_depth["dowel"])


func test_a_tapped_dowel_sinks_home_and_a_pull_backs_it_out() -> void:
	var bonds := Bonds.new(data)
	_dowel_at_mouth(bonds)
	var spec := data.joints[INTO_PLINTH]
	var joint := bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.hardware, INTO_PLINTH)
	assert_float(bonds.depth(joint)).is_equal_approx(0.0, EPS)
	assert_int(bonds.tap("dowel-1").size()).is_equal(1)
	assert_str(joint.fastener.state).is_equal(Fastener.PRESSED)
	assert_vector(bonds.poses["dowel-1"].origin).is_equal_approx(_assembled("dowel-1").origin, Vector3.ONE * EPS)
	assert_bool(bonds.apply(joint, Fastener.PULL)).is_true()
	assert_float(bonds.depth(joint)).is_equal_approx(0.0, EPS)
	assert_vector(bonds.poses["plinth-1"].origin).is_equal_approx(_assembled("plinth-1").origin, Vector3.ONE * EPS)


func test_a_seated_pair_is_bonded_only_once_fastened_and_keeps_its_relative_pose() -> void:
	var bonds := Bonds.new(data)
	_dowel_at_mouth(bonds)
	var spec := data.joints[INTO_PLINTH]
	var joint := bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.hardware, INTO_PLINTH)
	assert_int(bonds.locks().size()).is_equal(0)
	bonds.apply(joint, Fastener.TAP)
	var list := bonds.locks()
	assert_int(list.size()).is_equal(1)
	var want := _assembled("plinth-1").affine_inverse() * _assembled("dowel-1")
	assert_vector(list[0].frame.origin).is_equal_approx(want.origin, Vector3.ONE * EPS)
	assert_bool(list[0].frame.basis.is_equal_approx(want.basis)).is_true()
	# The fastened compound moves as one: the plinth carried off, the dowel goes with it.
	bonds.move_compound("plinth-1", Transform3D(Basis(Vector3.UP, 1.0), Vector3(2, 0.5, -1)), true)
	var rel := bonds.relative_pose("plinth-1", "dowel-1")
	assert_vector(rel.origin).is_equal_approx(want.origin, Vector3.ONE * EPS)
	assert_bool(rel.basis.is_equal_approx(want.basis)).is_true()


func test_seated_pose_is_the_assembled_one_at_full_sink() -> void:
	var bonds := Bonds.new(data)
	_dowel_at_mouth(bonds)
	var spec := data.joints[INTO_PLINTH]
	var joint := bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.hardware, INTO_PLINTH)
	var home := bonds.seated_pose(joint, data.sink_depth["dowel"])
	var want := _assembled("plinth-1").affine_inverse() * _assembled("dowel-1")
	assert_vector(home.origin).is_equal_approx(want.origin, Vector3.ONE * EPS)


func test_a_panel_tapped_onto_its_dowel_comes_down_on_it() -> void:
	var bonds := Bonds.new(data)
	_dowel_at_mouth(bonds)
	var into := data.joints[INTO_PLINTH]
	bonds.drive(bonds.seat(into.hardware, into.hardware_connector, into.host, into.host_connector, into.hardware, INTO_PLINTH))
	var onto := data.joints[SIDE_ONTO]
	assert_str(onto.mover).is_equal("sidePanel-1")
	# The side panel at the mouth of its hole over the dowel's far end.
	bonds.poses["sidePanel-1"] = _assembled("sidePanel-1").translated(-onto.axis * data.sink_depth["dowel"])
	var joint := bonds.seat(onto.hardware, onto.hardware_connector, onto.host, onto.host_connector, onto.mover, SIDE_ONTO)
	assert_float(bonds.depth(joint)).is_equal_approx(0.0, EPS)
	# The panel is the mover: a tap on it pushes it down onto the dowel.
	assert_int(bonds.tap("sidePanel-1").size()).is_equal(1)
	assert_vector(bonds.poses["sidePanel-1"].origin).is_equal_approx(_assembled("sidePanel-1").origin, Vector3.ONE * EPS)
	# The dowel and plinth stayed where they were.
	assert_vector(bonds.poses["dowel-1"].origin).is_equal_approx(_assembled("dowel-1").origin, Vector3.ONE * EPS)


func test_every_press_kind_goes_home_on_a_tap_and_back_on_a_pull() -> void:
	for kind: String in ["dowel", "pin", "fitting"]:
		var pressed := Fastener.transition(Fastener.create(kind), Fastener.TAP)
		assert_str(pressed.state).is_equal(Fastener.PRESSED)
		assert_str(Fastener.transition(pressed, Fastener.PULL).state).is_equal(Fastener.SEATED)


## A back fitting pressed home through the back panel lands in the side panel behind it, and lets
## go of it when pulled back; its depth follows the machine.
func test_a_back_fitting_pressed_home_lands_in_the_panel_behind_and_a_pull_lets_go() -> void:
	var play := Play.new(data)
	var i := -1
	for n: int in data.joints.size():
		if data.joints[n].kind == "fitting":
			i = n
			break
	var spec := data.joints[i]
	for id: String in [spec.host, spec.through]:
		play.bonds.poses[id] = _assembled(id)
	play.bonds.poses[spec.hardware] = _assembled(spec.hardware).translated(spec.axis * data.sink_depth["fitting"])
	var joint := play.bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.hardware, i)
	assert_str(play.behind(joint)).is_equal(spec.through)
	assert_int(play.tap(spec.hardware).size()).is_equal(1)
	assert_str(joint.through).is_equal(spec.through)
	assert_vector(play.bonds.poses[spec.hardware].origin).is_equal_approx(_assembled(spec.hardware).origin, Vector3.ONE * EPS)
	assert_bool(play.bonds.apply(joint, Fastener.PULL)).is_true()
	assert_str(joint.through).is_equal("")
	assert_float(play.bonds.depth(joint)).is_equal_approx(0.0, EPS)


func test_a_bolt_screws_home_on_its_span_and_backs_out_the_same_way() -> void:
	var span := Fastener.span_of("bolt")
	var f := Fastener.create("bolt")
	f = Fastener.transition(f, Fastener.CRANK, span / 2.0)
	assert_str(f.state).is_equal(Fastener.SEATED)
	assert_float(f.progress).is_equal_approx(0.5, EPS)
	assert_bool(Fastener.is_engaged(f)).is_true()
	f = Fastener.transition(f, Fastener.CRANK, span)
	assert_str(f.state).is_equal(Fastener.SCREWED)
	assert_float(f.progress).is_equal(1.0)
	# Backed off partway it still holds (hysteresis); all the way out it lets go.
	f = Fastener.transition(f, Fastener.CRANK, -span / 2.0)
	assert_str(f.state).is_equal(Fastener.SCREWED)
	f = Fastener.transition(f, Fastener.CRANK, -span)
	assert_str(f.state).is_equal(Fastener.SEATED)
	assert_float(f.progress).is_equal(0.0)
	assert_bool(Fastener.fastens_on(Fastener.create("bolt"), span)).is_true()
	assert_bool(Fastener.fastens_on(Fastener.create("bolt"), span / 2.0)).is_false()


func test_a_cam_locks_only_on_a_captured_bolt_and_opens_again() -> void:
	var quarter := Fastener.span_of("cam")
	var open := Fastener.transition(Fastener.create("cam"), Fastener.CRANK, quarter)
	assert_str(open.state).is_equal(Fastener.SEATED)
	assert_bool(Crank.is_turn_stalled(_turn_of(open))).is_true()
	var locked := Fastener.transition(Fastener.create("cam"), Fastener.CRANK, quarter, true)
	assert_str(locked.state).is_equal(Fastener.LOCKED)
	# Turned onto a bolt that only now came in reach: pressed on at the end stop, it catches.
	assert_str(Fastener.transition(open, Fastener.CRANK, 0.1, true).state).is_equal(Fastener.LOCKED)
	assert_str(Fastener.transition(locked, Fastener.CRANK, -quarter).state).is_equal(Fastener.SEATED)
	assert_bool(Fastener.binds_rigidly(locked)).is_true()


func test_a_bolt_a_locked_cam_holds_cannot_back_out() -> void:
	var screwed := Fastener.transition(Fastener.create("bolt"), Fastener.CRANK, Fastener.span_of("bolt"))
	assert_object(Fastener.transition(screwed, Fastener.CRANK, -1.0, false, true)).is_same(screwed)


func _turn_of(f: Fastener) -> Bonds.Turn:
	var joint := Bonds.Joint.new()
	joint.fastener = f
	var turn := Bonds.Turn.new()
	turn.joints.append(joint)
	return turn


## Only seated hardware takes a tool, and only a head a tool could turn lights.
func test_a_tool_seats_only_on_seated_hardware_and_a_cam_lights_with_a_bolt_in_reach() -> void:
	var bonds := Bonds.new(data)
	var hex := Snap.WorldConnector.new("hexSocket", Vector3.ZERO, Vector3.UP, "camLockBolt-1", 1)
	var hole := Snap.WorldConnector.new("dowelHole", Vector3.ZERO, Vector3.UP, "plinth-1", 0)
	assert_bool(Tools.is_seat_target(hex, Tools.seated_hardware(bonds))).is_false()
	assert_bool(Tools.is_seat_target(hole, Tools.seated_hardware(bonds))).is_true()
	var spec := data.joints[28]
	assert_str(spec.kind).is_equal("bolt")
	bonds.poses[spec.host] = _assembled(spec.host)
	bonds.poses[spec.hardware] = _assembled(spec.hardware)
	bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.hardware, 28)
	assert_bool(Tools.is_seat_target(hex, Tools.seated_hardware(bonds))).is_true()
	assert_bool(Tools.is_workable(hex, bonds, func(_cam: String) -> String: return "")).is_true()
	var heads: Dictionary[String, Vector3] = {"camLockBolt-1": Vector3(0.01, 0, 0)}
	assert_str(Tools.capture(Vector3.ZERO, heads)).is_equal("camLockBolt-1")
	assert_str(Tools.capture(Vector3(1, 0, 0), heads)).is_equal("")
