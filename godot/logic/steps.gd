class_name Steps
extends RefCounted
## The booklet's build pages as the loop plays them: which page is open, which parts and joints are
## on it, when it is complete, and turning it. The pages are the export's (bookletModel.ts
## createBuildSteps through godot/tools/export-item.ts); nothing here lists a page.
##
## The web's booklet is reference only: nothing there checks a build against it. Here a page turns
## by itself once the build has caught up with it, judged by type, never by instance: each joint is
## a key (host type, hole index, hardware type), and a page is complete when the build holds at
## least as many seats of each key as the manual asks for by that page (fastened, but for a cam a
## later page turns), every cam turned by then is locked, and the page's panels are out. So a
## horizontal turned end for end, a dowel from the other end of the box, or the other side panel
## still turns the page; a part in a hole the manual never uses for it does not.
##
## A page that lays a panel in on the build (the back panel, the shelves) is complete once it lies
## where it goes, as the play says (Play.is_placed).
##
## A page the loop does not play is `auto`: the loop fastens it on arrival and lists it.

## How the build lies on a page (src/scene/bookletPages.ts ORIENTATION): on its left side a quarter
## turn about z lays -x down; face down a quarter turn about x lays the front (+z) down, back up;
## upside down a half turn about x. The finished item's frame turned by these, any heading about
## the vertical.
const POSES: Dictionary[String, Quaternion] = {
	"lying": Quaternion(0.0, 0.0, sqrt(0.5), sqrt(0.5)),
	"faceDown": Quaternion(sqrt(0.5), 0.0, 0.0, sqrt(0.5)),
	"upright": Quaternion(0.0, 0.0, 0.0, 1.0),
	"upsideDown": Quaternion(1.0, 0.0, 0.0, 0.0),
}
## A build stands as a page has it within this turn of the page's pose (rad).
const STAND_TURN := (10.0 * PI) / 180.0

## The kinds a player fastens by hand here; a page with any other is fastened by the loop.
const PLAYED_KINDS: Array[String] = ["dowel", "pin", "fitting", "bolt", "cam"]
## The poses a page shows the build in; "parts" is the box laid out, no build yet.
const BOX := "parts"

var data: ItemData
var index := 0
## A page that turns the build (its pose differs from the page before) is played by hand: not yet.
var turns_played := true


func _init(item_data: ItemData) -> void:
	data = item_data


func page_count() -> int:
	return data.steps.size()


## The open page, or null once the manual has ended.
func current() -> ItemData.Step:
	return data.steps[index] if index < data.steps.size() else null


func is_done() -> bool:
	return index >= data.steps.size()


## True for a page the loop fastens itself: one that turns the build while turning is not played,
## or one with a joint of a kind not played by hand.
func is_auto(step: ItemData.Step) -> bool:
	if turns_build(step) and not turns_played:
		return true
	for i: int in step.joints:
		if not PLAYED_KINDS.has(data.joints[i].kind):
			return true
	return false


## True when a build whose frame (finished item to the build as it lies) is `frame` stands as `pose`
## has it: the frame is the pose's turn and a heading about the vertical.
static func stands_as(pose: String, frame: Basis) -> bool:
	if not POSES.has(pose):
		return true
	var up := (frame * Basis(POSES[pose]).inverse()) * Vector3.UP
	return up.angle_to(Vector3.UP) <= STAND_TURN


## True when the page shows the build in another pose than the page before (lying to face down,
## face down to upright): the build is turned over by hand.
func turns_build(step: ItemData.Step) -> bool:
	var at := data.steps.find(step)
	if at <= 0 or step.pose == BOX:
		return false
	var before := data.steps[at - 1].pose
	return before != BOX and before != step.pose


## The panels a page lays in on the build (not out of the box): each must end up where it goes.
func laid_in(step: ItemData.Step) -> Array[String]:
	var out: Array[String] = []
	if step.pose != BOX:
		out.assign(step.parts)
	return out


## Every part a page is about: the panels it brings in, and both sides of every joint it seats or
## turns, in page order, each once.
func parts_on(step: ItemData.Step) -> Array[String]:
	var out: Array[String] = []
	for id: String in step.parts:
		if not out.has(id):
			out.append(id)
	for i: int in step.joints + step.turns:
		for id: String in [data.joints[i].hardware, data.joints[i].host]:
			if not out.has(id):
				out.append(id)
	return out


## A joint's key: what kind of seat it is, whichever instances.
static func key(host_type: String, host_index: int, hardware_type: String) -> String:
	return "%s#%d<%s" % [host_type, host_index, hardware_type]


func key_of(i: int) -> String:
	var s := data.joints[i]
	return key(data.instance(s.host).type, s.host_connector, data.instance(s.hardware).type)


func joint_key(joint: Bonds.Joint) -> String:
	return key(data.instance(joint.host).type, joint.host_connector, data.instance(joint.hardware).type)


## What the manual asks for by page `upto` (an index), by key: [seated, fastened, locked] counts.
func _needed(upto: int) -> Dictionary[String, Vector3i]:
	var turned: Dictionary[int, bool] = {}
	for p: int in range(0, upto + 1):
		for i: int in data.steps[p].turns:
			turned[i] = true
	var out: Dictionary[String, Vector3i] = {}
	for p: int in range(0, upto + 1):
		for i: int in data.steps[p].joints:
			var k := key_of(i)
			var n: Vector3i = out.get(k, Vector3i.ZERO)
			n.x += 1
			if data.joints[i].kind != Fastener.CAM or turned.has(i):
				n.y += 1
			out[k] = n
		for i: int in data.steps[p].turns:
			var k := key_of(i)
			var n: Vector3i = out.get(k, Vector3i.ZERO)
			n.z += 1
			out[k] = n
	return out


## What the build holds, by key: [seated, fastened, locked] counts.
func _held(bonds: Bonds) -> Dictionary[String, Vector3i]:
	var out: Dictionary[String, Vector3i] = {}
	for joint: Bonds.Joint in bonds.joints:
		if joint.kind == Fastener.TOOL:
			continue
		var k := joint_key(joint)
		var n: Vector3i = out.get(k, Vector3i.ZERO)
		n.x += 1
		if Fastener.is_fastened(joint.fastener):
			n.y += 1
		if joint.kind == Fastener.CAM and joint.fastener.state == Fastener.LOCKED:
			n.z += 1
		out[k] = n
	return out


## True when the build has caught up with page `step` (see the header); `placed(id)` says whether a
## panel the page lays in is where it goes, and `frame()` how the build lies (a page that turns it
## is complete once it stands as the page has it).
func complete(step: ItemData.Step, bonds: Bonds, placed: Callable = Callable(), frame: Callable = Callable()) -> bool:
	var at := data.steps.find(step)
	var held := _held(bonds)
	var needed := _needed(at)
	for k: String in needed:
		var h: Vector3i = held.get(k, Vector3i.ZERO)
		var n: Vector3i = needed[k]
		if h.x < n.x or h.y < n.y or h.z < n.z:
			return false
	for id: String in step.parts:
		if not bonds.poses.has(id):
			return false
	if placed.is_valid():
		for id: String in laid_in(step):
			if not bool(placed.call(id)):
				return false
	if frame.is_valid() and turns_build(step) and not stands_as(step.pose, frame.call() as Basis):
		return false
	return true


## True while the open page still wants a seat of key `k` (gated snaps).
func wants(k: String, bonds: Bonds) -> bool:
	var step := current()
	if step == null:
		return false
	var on_page := false
	for i: int in step.joints:
		if key_of(i) == k:
			on_page = true
	if not on_page:
		return false
	var h: Vector3i = _held(bonds).get(k, Vector3i.ZERO)
	return h.x < _needed(index)[k].x


## The part types the open page still wants a seat for, either side (gated picking).
func wanted_types(bonds: Bonds) -> Dictionary[String, bool]:
	var out: Dictionary[String, bool] = {}
	var step := current()
	if step == null:
		return out
	for i: int in step.joints:
		var k := key_of(i)
		if wants(k, bonds):
			out[data.instance(data.joints[i].host).type] = true
			out[data.instance(data.joints[i].hardware).type] = true
	for id: String in step.parts:
		out[data.instance(id).type] = true
	if step.tool != "":
		out[step.tool] = true
		for i: int in step.joints + step.turns:
			out[data.instance(data.joints[i].hardware).type] = true
	return out


## How many of the open page's joints the build has done, for the page label: of the page's own
## keys, those fastened beyond what earlier pages asked for.
func done_count(step: ItemData.Step, bonds: Bonds) -> int:
	var at := data.steps.find(step)
	var held := _held(bonds)
	var before: Dictionary[String, Vector3i] = {}
	if at > 0:
		before = _needed(at - 1)
	var counted: Dictionary[String, int] = {}
	var n := 0
	for i: int in step.joints:
		var k := key_of(i)
		var have: Vector3i = held.get(k, Vector3i.ZERO)
		var prior: Vector3i = before.get(k, Vector3i.ZERO)
		var used: int = counted.get(k, 0)
		var fastened := data.joints[i].kind != Fastener.CAM
		if (have.y if fastened else have.x) - (prior.y if fastened else prior.x) > used:
			n += 1
		counted[k] = used + 1
	return n


## Turns the page when the open one is complete. True if it turned.
func advance(bonds: Bonds, placed: Callable = Callable(), frame: Callable = Callable()) -> bool:
	var step := current()
	if step == null or not complete(step, bonds, placed, frame):
		return false
	index += 1
	return true


## One line saying what an auto page did, e.g. "page 2: 8 bolt fastened by the loop".
func auto_line(step: ItemData.Step) -> String:
	var counts: Dictionary[String, int] = {}
	for i: int in step.joints:
		var k := data.joints[i].kind
		counts[k] = counts.get(k, 0) + 1
	var bits: PackedStringArray = []
	for k: String in counts:
		bits.append("%d %s seated" % [counts[k], k] if k == "cam" else "%d %s fastened" % [counts[k], k])
	if not step.turns.is_empty():
		bits.append("%d cam turned" % step.turns.size())
	if not step.parts.is_empty():
		bits.append("%s laid in" % ", ".join(step.parts))
	if step.tip:
		bits.append("tipped upright")
	return "page %d: %s by the loop" % [step.number, "; ".join(bits)]
