class_name Tools
extends RefCounted
## Where carried hardware can go, and which seats light up: the port of src/game/toolTargets.ts,
## whole. A seat target is any connector, but a bolt head or cam slot only once its bolt or cam is
## seated in its hole: a tool on loose hardware is a dead end. Workable: what a tool could turn
## either way. Pure: connector types and graph records in, booleans out.

## A tool's working end.
const TOOL_TIPS: Array[String] = ["wrenchTip", "screwdriverTip"]
## What a tool's tip seats on.
const TOOL_TARGETS: Array[String] = ["hexSocket", "driveSlot"]


static func is_tool_tip(type: String) -> bool:
	return TOOL_TIPS.has(type)


static func is_tool_target(type: String) -> bool:
	return TOOL_TARGETS.has(type)


## Hardware seated in its hole: every part with a crank-kind joint as its hardware (seatedHardware).
static func seated_hardware(bonds: Bonds) -> Dictionary[String, bool]:
	var out: Dictionary[String, bool] = {}
	for joint: Bonds.Joint in bonds.joints:
		if Fastener.is_crank_kind(joint.kind):
			out[joint.hardware] = true
	return out


## Any connector but a tool target; a bolt head or cam slot only on seated hardware (isSeatTarget).
static func is_seat_target(c: Snap.WorldConnector, seated: Dictionary[String, bool]) -> bool:
	return not is_tool_target(c.type) or seated.has(c.part)


## A seat target worth lighting: any hole; a head or slot only when its tool could turn it either
## way (isWorkable). `captured(cam) -> String` is the bolt a cam would catch ("" none).
static func is_workable(c: Snap.WorldConnector, bonds: Bonds, captured: Callable) -> bool:
	if not is_tool_target(c.type):
		return true
	var seat := bonds.turned_from(c.part, c.index)
	if seat == null:
		return false
	if seat.kind == Fastener.CAM:
		return seat.fastener.state == Fastener.LOCKED or String(captured.call(seat.hardware)) != ""
	return not (seat.kind == Fastener.BOLT and bonds.is_held(seat.hardware))


## The bolt head nearest a cam's recess within `radius`, any screwed bolt, or "" (assembly.ts
## capture). `heads` maps bolt id to its head's world position.
static func capture(recess: Vector3, heads: Dictionary[String, Vector3], radius: float = Constants.FASTENER.captureRadius) -> String:
	var best := ""
	var best_d := radius
	for id: String in heads:
		var d := heads[id].distance_to(recess)
		if d <= best_d:
			best = id
			best_d = d
	return best
