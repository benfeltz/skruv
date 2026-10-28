@tool
class_name ItemData
extends RefCounted
## The resolved item, read from the json godot/tools/export-item.ts writes from the pack.
## Typed accessors only: no item numbers live here, and nothing here derives a joint.
## Plain data, no nodes, so the headless tests read it directly.

const FORMAT := 2
const JOHNNY_PATH := "res://items/johnny.json"


class Connector:
	var id: String
	var type: String
	## In the part's own frame.
	var position: Vector3
	var axis: Vector3


class PartType:
	var name: String
	## In file order: joints name them by index.
	var connectors: Array[Connector] = []
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
	var host_connector: int
	var hardware_connector: int
	## The side the lib says moves to seat it: the hardware, or the panel pressed onto it.
	var mover: String
	## A fitting's or screw's far panel, or "" (the lib's `through`).
	var through: String
	## A cam's bolt, or "" (the lib's `captured`).
	var captured: String
	## World position of the hardware's seated end, at the assembled pose.
	var position: Vector3
	## The hole's world axis.
	var axis: Vector3


## One build page of the manual (bookletModel.ts createBuildSteps, through the exporter).
class Step:
	var number: int
	## 'parts', 'lying', 'faceDown', 'upright', 'upsideDown'.
	var pose: String
	## Panels the page brings in.
	var parts: Array[String] = []
	## Indices into `joints` the page seats (and fastens).
	var joints: Array[int] = []
	## Indices of the cam joints the page locks.
	var turns: Array[int] = []
	## The page tips the carcass upright.
	var tip: bool


var product: String
## The lib's vocabulary: fastener-end type → hole type, end type → kind, kind → sink depth (m).
var compatible: Dictionary[String, String] = {}
var kinds: Dictionary[String, String] = {}
var sink_depth: Dictionary[String, float] = {}
var steps: Array[Step] = []
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
	var vocabulary: Dictionary = d["vocabulary"]
	var raw_compatible: Dictionary = vocabulary["compatible"]
	for end: String in raw_compatible:
		item.compatible[end] = String(raw_compatible[end])
	var raw_kinds: Dictionary = vocabulary["kinds"]
	for end: String in raw_kinds:
		item.kinds[end] = String(raw_kinds[end])
	var raw_sinks: Dictionary = vocabulary["sinkDepth"]
	for kind: String in raw_sinks:
		item.sink_depth[kind] = float(raw_sinks[kind])
	var raw_types: Dictionary = d["types"]
	for type_name: String in raw_types:
		var t: Dictionary = raw_types[type_name]
		var part := PartType.new()
		part.name = type_name
		part.size = _vec3(t["size"])
		part.color = Color.html(t["color"])
		part.mass = t["mass"]
		part.hardware = t["hardware"]
		for raw_c: Dictionary in t["connectors"]:
			var c := Connector.new()
			c.id = raw_c["id"]
			c.type = raw_c["type"]
			c.position = _vec3(raw_c["position"])
			c.axis = _vec3(raw_c["axis"])
			part.connectors.append(c)
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
		joint.host_connector = int(raw["hostConnector"])
		joint.hardware_connector = int(raw["hardwareConnector"])
		joint.mover = raw["mover"]
		joint.through = _id_or_empty(raw["through"])
		joint.captured = _id_or_empty(raw["captured"])
		joint.position = _vec3(raw["position"])
		joint.axis = _vec3(raw["axis"])
		item.joints.append(joint)
	for raw: Dictionary in d["steps"]:
		var step := Step.new()
		step.number = int(raw["number"])
		step.pose = raw["pose"]
		for id: String in raw["parts"]:
			step.parts.append(id)
		for i: float in raw["joints"]:
			step.joints.append(int(i))
		for i: float in raw["turns"]:
			step.turns.append(int(i))
		step.tip = raw["tip"]
		item.steps.append(step)
	return item


func instance(id: String) -> Instance:
	for inst: Instance in instances:
		if inst.id == id:
			return inst
	return null


func type_of(inst: Instance) -> PartType:
	return types[inst.type]


static func _id_or_empty(v: Variant) -> String:
	return "" if v == null else String(v)


static func _vec3(a: Array) -> Vector3:
	return Vector3(a[0], a[1], a[2])
