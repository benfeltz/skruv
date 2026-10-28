extends GdUnitTestSuite
## logic/steps.gd against the export's pages: a page completes only when all its joints are
## pressed; non-dowel pages are auto and flagged; the booklet turns only on a complete page.

## The manual's dowel pages (1-based page numbers): the horizontals' dowels, then each side panel
## pressed onto them. Pinned so a pack change that moves them is noticed.
const DOWEL_PAGES: Array[int] = [1, 3, 6]

var data: ItemData


func before() -> void:
	data = ItemData.load_file(ItemData.JOHNNY_PATH)


func test_every_page_is_dowels_alone_or_auto() -> void:
	var steps := Steps.new(data)
	var dowel_pages: Array[int] = []
	for step: ItemData.Step in data.steps:
		if not steps.is_auto(step):
			dowel_pages.append(step.number)
	assert_array(dowel_pages).is_equal(DOWEL_PAGES)


func test_the_dowel_pages_cover_every_dowel_joint_once() -> void:
	var steps := Steps.new(data)
	var covered: Dictionary[int, int] = {}
	for step: ItemData.Step in data.steps:
		if steps.is_auto(step):
			continue
		for i: int in step.joints:
			covered[i] = covered.get(i, 0) + 1
	var dowels := 0
	for i: int in data.joints.size():
		if data.joints[i].kind == "dowel":
			dowels += 1
			assert_int(covered.get(i, 0)).override_failure_message("dowel joint %d on %d pages" % [i, covered.get(i, 0)]).is_equal(1)
	assert_int(covered.size()).is_equal(dowels)


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
