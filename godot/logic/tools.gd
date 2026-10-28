class_name Tools
extends RefCounted
## Where carried hardware can go, and what a tool turns: the port of src/game/toolTargets.ts.
## Pure: connector types and records in, booleans out.

## A tool's working end.
const TOOL_TIPS: Array[String] = ["wrenchTip", "screwdriverTip"]
## What a tool's tip seats on.
const TOOL_TARGETS: Array[String] = ["hexSocket", "driveSlot"]


static func is_tool_tip(type: String) -> bool:
	return TOOL_TIPS.has(type)


static func is_tool_target(type: String) -> bool:
	return TOOL_TARGETS.has(type)
