class_name Fastener
extends RefCounted
## One seated pair's machine: the port of src/game/fasteners.ts, the press/pull rows only.
##
##   dowel, pin, back fitting   seated ⇄ pressed   tap / pull
##
## Bidirectional: disassembly is the same interaction reversed (pull the dowel), never an undo.
## Pure: a record in, a new record out; an event the machine ignores returns the very same
## record, so callers detect change by identity. The turned kinds (bolt, cam, stud, screw) and
## the slide are not ported: every event leaves them as they are. The loop fastens their pages
## with `auto_home`, a record marked `auto`, never through `transition`.

const SEATED := "seated"
const PRESSED := "pressed"
const SCREWED := "screwed"
const LOCKED := "locked"

const TAP := "tap"
const PULL := "pull"
const CRANK := "crank"

var kind: String
var state: String
## How far home, 0..1.
var progress: float
## Fastened by the loop on arrival (a kind whose machine is not ported), not by an event.
var auto: bool


func _init(k: String = "", s: String = SEATED, p: float = 0.0, a: bool = false) -> void:
	kind = k
	state = s
	progress = p
	auto = a


## A fresh seated record (createFastener; the slide's held start is not ported).
static func create(k: String) -> Fastener:
	return Fastener.new(k, SEATED, 0.0)


## Kinds pushed home by a tap and pulled back out along their axis (isTapKind).
static func is_tap_kind(k: String) -> bool:
	return k == "dowel" or k == "pin" or k == "fitting"


## Past seated: the joint holds and physics should bond it (isFastened).
static func is_fastened(f: Fastener) -> bool:
	return f.state != SEATED


## Next record for `event` (TAP, PULL or CRANK). The same record back when nothing changes.
static func transition(f: Fastener, event: String) -> Fastener:
	if not is_tap_kind(f.kind):
		return f
	if event == TAP and f.state == SEATED:
		return Fastener.new(f.kind, PRESSED, 1.0)
	if event == PULL and f.state == PRESSED:
		return Fastener.new(f.kind, SEATED, 0.0)
	return f


## A kind the loop does not play, fastened all the way home as its page asks: a cam `locked`,
## a bolt `screwed`, a tap kind `pressed`. Marked `auto` so the page can say so.
static func auto_home(k: String) -> Fastener:
	var s := PRESSED
	if k == "cam":
		s = LOCKED
	elif k == "bolt" or k == "stud" or k == "screw":
		s = SCREWED
	return Fastener.new(k, s, 1.0, true)


## A seated record the loop put in on arrival without fastening it (a cam a page seats and a
## later page turns).
static func auto_seated(k: String) -> Fastener:
	return Fastener.new(k, SEATED, 0.0, true)
