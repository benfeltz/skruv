extends GdUnitTestSuite
## The exported item against the pack it came from. Type and instance counts are read from
## items/johnny/flatpack.json itself (counting, never deriving); the joint count is pinned to
## what tools/validate/lib derives, since GDScript must never derive joints.

const PACK_PATH := "res://../items/johnny/flatpack.json"
## deriveJoints(items/johnny) — the validator's and the web build's count.
const JOHNNY_JOINTS := 60
const JOHNNY_TYPES := 13


func _item() -> ItemData:
	return ItemData.load_file(ItemData.JOHNNY_PATH)


func _pack() -> Dictionary:
	var text := FileAccess.get_file_as_string(ProjectSettings.globalize_path(PACK_PATH))
	return JSON.parse_string(text)


func test_reads_the_export() -> void:
	var item := _item()
	assert_object(item).is_not_null()
	assert_str(item.product).is_equal(_pack()["identity"]["product"])


func test_type_count_matches_the_pack() -> void:
	var parts: Dictionary = _pack()["parts"]
	assert_int(parts.size()).is_equal(JOHNNY_TYPES)
	assert_int(_item().types.size()).is_equal(parts.size())


func test_instance_count_matches_the_pack() -> void:
	var assembled: Array = _pack()["assembled"]
	assert_int(_item().instances.size()).is_equal(assembled.size())


func test_joint_count_is_the_derived_one() -> void:
	assert_int(_item().joints.size()).is_equal(JOHNNY_JOINTS)


func test_every_joint_names_two_instances() -> void:
	var item := _item()
	for joint: ItemData.JointSpec in item.joints:
		assert_object(item.instance(joint.host)).override_failure_message("no host %s" % joint.host).is_not_null()
		assert_object(item.instance(joint.hardware)).override_failure_message("no hardware %s" % joint.hardware).is_not_null()
		assert_bool(joint.host != joint.hardware).is_true()


func test_every_instance_has_a_type() -> void:
	var item := _item()
	for inst: ItemData.Instance in item.instances:
		assert_bool(item.types.has(inst.type)).override_failure_message("no type %s" % inst.type).is_true()
