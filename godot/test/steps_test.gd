extends GdUnitTestSuite
## logic/steps.gd against the export's pages: a page completes only when all its joints are
## pressed; non-dowel pages are auto and flagged; the booklet turns only on a complete page.

## The pages played by hand (1-based): the dowel pages, the back fittings, the shelf pins and the
## shelves laid on them. Pinned so a pack change that moves them is noticed.
const PLAYED_PAGES: Array[int] = [1, 3, 6, 9, 11, 12]

var data: ItemData


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


func test_the_played_pages_are_the_press_kinds_and_the_shelves() -> void:
	var steps := Steps.new(data)
	var played: Array[int] = []
	for step: ItemData.Step in data.steps:
		if not steps.is_auto(step):
			played.append(step.number)
	assert_array(played).is_equal(PLAYED_PAGES)
	# Page 8 lays the back panel on the build turned face down, page 10 tips it upright: turns.
	assert_bool(steps.turns_build(data.steps[7])).is_true()
	assert_bool(steps.turns_build(data.steps[9])).is_true()
	assert_bool(steps.turns_build(data.steps[11])).is_false()
	assert_array(steps.laid_in(data.steps[11])).is_equal(["adjustableShelf-1", "adjustableShelf-2"])


func test_the_played_pages_cover_every_press_kind_joint_once() -> void:
	var steps := Steps.new(data)
	var covered: Dictionary[int, int] = {}
	for step: ItemData.Step in data.steps:
		if steps.is_auto(step):
			continue
		for i: int in step.joints:
			covered[i] = covered.get(i, 0) + 1
	var pressed := 0
	for i: int in data.joints.size():
		if Steps.PLAYED_KINDS.has(data.joints[i].kind):
			pressed += 1
			assert_int(covered.get(i, 0)).override_failure_message("joint %d on %d pages" % [i, covered.get(i, 0)]).is_equal(1)
	assert_int(covered.size()).is_equal(pressed)


func test_an_auto_page_says_what_it_did() -> void:
	var steps := Steps.new(data)
	assert_str(steps.auto_line(data.steps[1])).contains("8 bolt fastened")
	assert_str(steps.auto_line(data.steps[9])).contains("tipped upright")


func test_a_page_completes_only_when_every_joint_is_pressed() -> void:
	var steps := Steps.new(data)
	var bonds := Bonds.new(data)
	var page := steps.current()
	for id: String in steps.parts_on(page):
		var inst := data.instance(id)
		bonds.poses[id] = Transform3D(Basis(inst.rotation), inst.position)
	var last := page.joints.size() - 1
	for n: int in page.joints.size():
		var i := page.joints[n]
		var spec := data.joints[i]
		var joint := bonds.seat(spec.hardware, spec.hardware_connector, spec.host, spec.host_connector, spec.mover, i)
		assert_bool(steps.complete(page, bonds)).is_false()
		if n < last:
			bonds.apply(joint, Fastener.TAP)
	assert_bool(steps.advance(bonds)).is_false()
	assert_int(steps.index).is_equal(0)
	bonds.apply(bonds.joint_for_spec(page.joints[last]), Fastener.TAP)
	assert_int(steps.done_count(page, bonds)).is_equal(page.joints.size())
	assert_bool(steps.complete(page, bonds)).is_true()
	assert_bool(steps.advance(bonds)).is_true()
	assert_int(steps.index).is_equal(1)


func test_the_manual_ends_after_the_last_page() -> void:
	var steps := Steps.new(data)
	steps.index = steps.page_count()
	assert_bool(steps.is_done()).is_true()
	assert_object(steps.current()).is_null()
	assert_bool(steps.advance(Bonds.new(data))).is_false()


## The booklet goes by type: the first page's dowels in each other's holes still turn it.
func test_a_page_is_done_by_type_whichever_dowel_is_in_which_hole() -> void:
	var steps := Steps.new(data)
	var bonds := Bonds.new(data)
	var page := steps.current()
	for id: String in steps.parts_on(page):
		var inst := data.instance(id)
		bonds.poses[id] = Transform3D(Basis(inst.rotation), inst.position)
	var n := page.joints.size()
	for k: int in n:
		var spec := data.joints[page.joints[k]]
		# Each hole takes the next dowel along.
		var other := data.joints[page.joints[(k + 1) % n]].hardware
		bonds.apply(bonds.seat(other, 0, spec.host, spec.host_connector, other), Fastener.TAP)
	assert_bool(steps.complete(page, bonds)).is_true()


## A horizontal turned end for end is the same horizontal: its turn maps its holes onto each other.
func test_a_horizontal_has_its_end_for_end_symmetry_and_keeps_its_holes_where_they_were() -> void:
	var bonds := Bonds.new(data)
	var syms := bonds.symmetries("topBottomPanel")
	assert_bool(syms.is_empty()).is_false()
	# A bolt turns about its own axis but never end for end; a dowel does both.
	assert_bool(_reverses(bonds, "camLockBolt")).is_false()
	assert_bool(_reverses(bonds, "dowel")).is_true()
	bonds.poses["topBottomPanel-1"] = Transform3D(Basis(Vector3(1, 2, 3).normalized(), 0.4), Vector3(0.3, 0.2, -0.1))
	var before: Array[Vector3] = []
	for c: Snap.WorldConnector in bonds.free_connectors("topBottomPanel-1"):
		before.append(c.position)
	bonds.apply_symmetry("topBottomPanel-1", syms[0])
	for c: Snap.WorldConnector in bonds.free_connectors("topBottomPanel-1"):
		var found := false
		for p: Vector3 in before:
			if p.distance_to(c.position) < 1e-6:
				found = true
		assert_bool(found).is_true()


func _reverses(bonds: Bonds, type: String) -> bool:
	var axis := data.types[type].connectors[0].axis
	for sym: Bonds.Symmetry in bonds.symmetries(type):
		if (sym.turn * axis).dot(axis) < -0.5:
			return true
	return false
