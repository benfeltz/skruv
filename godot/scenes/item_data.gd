class_name ItemData
extends RefCounted
## The resolved item, read from the json godot/tools/export-item.ts writes from the pack.
## Typed accessors only: no item numbers live here, and nothing here derives a joint.
## Plain data, no nodes, so the headless tests read it directly.

const FORMAT := 1
const JOHNNY_PATH := "res://items/johnny.json"


class PartType:
	var name: String
	var size: Vector3
	var color: Color
	var mass: float
	## Carries a fastener end (dowel, bolt, cam, pin, fitting, the tools).
	var hardware: bool


class Instance:
	var id: String
	var type: String
	var role: String
	var position: Vector3
	var rotation: Quaternion


class JointSpec:
	## The panel (or bolt) the hardware seats in.
	var host: String
	var hardware: String
	var kind: String
	## World position of the hardware's seated end, at the assembled pose.
	var position: Vector3
	## The hole's world axis.
	var axis: Vector3


var product: String
var source: String
var types: Dictionary[String, PartType] = {}
var instances: Array[Instance] = []
var joints: Array[JointSpec] = []


## Reads the exporter's json. Returns null (and pushes an error) on a missing or malformed file.
static func load_file(path: String) -> ItemData:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("ItemData: cannot read %s" % path)
		return null
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("ItemData: %s is not a json object" % path)
		return null
	var d: Dictionary = parsed
	if int(d.get("format", 0)) != FORMAT:
		push_error("ItemData: %s is format %s, want %d" % [path, d.get("format"), FORMAT])
		return null
	var item := ItemData.new()
	item.product = d["product"]
	item.source = d["source"]
	var raw_types: Dictionary = d["types"]
	for type_name: String in raw_types:
		var t: Dictionary = raw_types[type_name]
		var part := PartType.new()
		part.name = type_name
		part.size = _vec3(t["size"])
		part.color = Color.html(t["color"])
		part.mass = t["mass"]
		part.hardware = t["hardware"]
		item.types[type_name] = part
	for raw: Dictionary in d["instances"]:
		var inst := Instance.new()
		inst.id = raw["id"]
		inst.type = raw["type"]
		inst.role = raw["role"]
		inst.position = _vec3(raw["position"])
		var q: Array = raw["rotation"]
		inst.rotation = Quaternion(q[0], q[1], q[2], q[3]).normalized()
		item.instances.append(inst)
	for raw: Dictionary in d["joints"]:
		var joint := JointSpec.new()
		joint.host = raw["host"]
		joint.hardware = raw["hardware"]
		joint.kind = raw["kind"]
		joint.position = _vec3(raw["position"])
		joint.axis = _vec3(raw["axis"])
		item.joints.append(joint)
	return item


func instance(id: String) -> Instance:
	for inst: Instance in instances:
		if inst.id == id:
			return inst
	return null


func type_of(inst: Instance) -> PartType:
	return types[inst.type]


static func _vec3(a: Array) -> Vector3:
	return Vector3(a[0], a[1], a[2])
