extends GdUnitTestSuite
## Drops the assembled item 2 cm onto the floor, steps physics headless for SETTLE_S, and asserts
## it landed, stands, stays still and sleeps. Prints a Stillness line per second, so the run's
## log keeps the measured numbers whether it passes or not.

const SETTLE_S := 5.0
## Thresholds (plan 2.0.4.2): offset from the assembled pose, turn away from it, floor contact.
const MAX_OFFSET_M := 0.002
const MAX_TURN_DEG := 0.5
const FLOOR_TOLERANCE_M := 0.002


func test_dropped_item_lands_stands_and_sleeps() -> void:
	await _drop_and_assert(false)


## Tuning attempt 3 (step 5): the same parts fused into one body, no joints. It separates what
## the joints do from what Jolt, the floor and the drop do.
func test_compound_control_lands_stands_and_sleeps() -> void:
	await _drop_and_assert(true)


func _drop_and_assert(compound: bool) -> void:
	print("stillness: %s" % ("compound control" if compound else "jointed"))
	var room: Room = auto_free(Room.new())
	add_child(room)
	var item: Item = auto_free(Item.new(null, compound))
	add_child(item)
	var hz := Engine.physics_ticks_per_second
	var steps := int(SETTLE_S * hz)
	var last: Stillness
	for step: int in range(1, steps + 1):
		await get_tree().physics_frame
		if step % hz == 0:
			last = Stillness.measure(item, float(step) / hz)
			print(last.line())
	for line: String in Stillness.movers(item, MAX_OFFSET_M, MAX_TURN_DEG):
		print(line)
	assert_int(last.asleep).override_failure_message("asleep %d of %d" % [last.asleep, last.bodies]).is_equal(last.bodies)
	assert_float(last.max_offset).override_failure_message("offset %.2f mm" % (last.max_offset * 1000.0)).is_less(MAX_OFFSET_M)
	assert_float(last.max_turn_deg).override_failure_message("turn %.3f deg" % last.max_turn_deg).is_less(MAX_TURN_DEG)
	assert_float(absf(last.lowest_y)).override_failure_message("lowest %.2f mm" % (last.lowest_y * 1000.0)).is_less(FLOOR_TOLERANCE_M)
