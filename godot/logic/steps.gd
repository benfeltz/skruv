class_name Steps
extends RefCounted
## The booklet's build pages as the loop plays them: which page is open, which parts and joints
## are on it, when it is complete, and turning it. The pages are the export's (bookletModel.ts
## createBuildSteps through godot/tools/export-item.ts); nothing here lists a page.
##
## The web's booklet is reference only: nothing there checks a build against it. Here the page
## gates the build, since the loop has to know when JOHNNY is done. A page the loop does not play
## (any joint not a dowel, or no joint at all: a tip, a panel laid on, shelves set on pins) is
## `auto`: the loop fastens it on arrival and lists it, never hides it.

const DOWEL := "dowel"

var data: ItemData
var index := 0


func _init(item_data: ItemData) -> void:
	data = item_data


func page_count() -> int:
	return data.steps.size()


## The open page, or null once the manual has ended.
func current() -> ItemData.Step:
	return data.steps[index] if index < data.steps.size() else null


func is_done() -> bool:
	return index >= data.steps.size()


## True for a page the loop fastens itself: anything but a page of dowels alone.
func is_auto(step: ItemData.Step) -> bool:
	if step.joints.is_empty() or not step.turns.is_empty():
		return true
	for i: int in step.joints:
		if data.joints[i].kind != DOWEL:
			return true
	return false


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


## True when every joint the page seats is in (and fastened, but for a cam a later page turns),
## and every cam it turns is locked.
func complete(step: ItemData.Step, bonds: Bonds) -> bool:
	for i: int in step.joints:
		var joint := bonds.joint_for_spec(i)
		if joint == null:
			return false
		if data.joints[i].kind != "cam" and not Fastener.is_fastened(joint.fastener):
			return false
	for i: int in step.turns:
		var joint := bonds.joint_for_spec(i)
		if joint == null or not Fastener.is_fastened(joint.fastener):
			return false
	for id: String in step.parts:
		if not bonds.poses.has(id):
			return false
	return true


## How many of the page's joints are done, for the page label.
func done_count(step: ItemData.Step, bonds: Bonds) -> int:
	var n := 0
	for i: int in step.joints:
		var joint := bonds.joint_for_spec(i)
		if joint != null and Fastener.is_fastened(joint.fastener):
			n += 1
	return n


## Turns the page when the open one is complete. True if it turned.
func advance(bonds: Bonds) -> bool:
	var step := current()
	if step == null or not complete(step, bonds):
		return false
	index += 1
	return true


## One line saying what an auto page did, e.g. "page 2: 8 bolts fastened by the loop".
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
