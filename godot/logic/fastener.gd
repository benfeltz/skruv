class_name Fastener
extends RefCounted
## One seated pair's machine: the port of src/game/fasteners.ts, whole.
##
##   dowel, pin, back fitting   seated ⇄ pressed   tap / pull
##   bolt                       seated ⇄ screwed   signed crank progress (wrench)
##   stud                       seated ⇄ screwed   signed crank progress (hand or key)
##   screw                      seated ⇄ screwed   signed crank progress (screwdriver)
##   cam                        seated ⇄ locked    signed quarter turn (screwdriver); locking
##                                                 needs a captured bolt head
##   slide                      held on seat ⇄ seated   pull (off its rails)
##   tool                       always seated      a tool on a head or slot fastens nothing
##
## Bidirectional: disassembly is the same interaction reversed (pull the dowel, back the bolt
## out, turn the cam open), never an undo. Pure: a record in, a new record out; an event the
## machine ignores returns the very same record, so callers detect change by identity.
## Correctness never enters here: any type-compatible seated pair fastens.

const SEATED := "seated"
const PRESSED := "pressed"
const SCREWED := "screwed"
const LOCKED := "locked"

const TAP := "tap"
const PULL := "pull"
const CRANK := "crank"

const DOWEL := "dowel"
const PIN := "pin"
const FITTING := "fitting"
const BOLT := "bolt"
const CAM := "cam"
const STUD := "stud"
const SCREW := "screw"
const SLIDE := "slide"
const TOOL := "tool"

var kind: String
var state: String
## How far home, 0..1.
var progress: float


func _init(k: String = "", s: String = SEATED, p: float = 0.0) -> void:
	kind = k
	state = s
	progress = p


## A fresh record: seated, or a slide held on its rails at once (createFastener).
static func create(k: String) -> Fastener:
	return Fastener.new(k, PRESSED, 1.0) if k == SLIDE else Fastener.new(k, SEATED, 0.0)


## Kinds pushed home by a tap and pulled back out along their axis (isTapKind).
static func is_tap_kind(k: String) -> bool:
	return k == DOWEL or k == PIN or k == FITTING


## Kinds turned by a tool, a stud also by hand (isCrankKind).
static func is_crank_kind(k: String) -> bool:
	return k == BOLT or k == CAM or k == STUD or k == SCREW


## Turned kinds that travel into their hole as they go; a cam turns in place (sinksAsTurned).
static func sinks_as_turned(k: String) -> bool:
	return k == BOLT or k == STUD or k == SCREW


## Kinds whose tip lands in whatever lies behind the hole (vocabulary.ts passesThrough).
static func passes_through(k: String) -> bool:
	return k == FITTING or k == SCREW


## The turn that takes a crank kind from seated to home, radians (spanOf).
static func span_of(k: String) -> float:
	match k:
		BOLT:
			return Constants.FASTENER.boltRadians
		STUD:
			return Constants.FASTENER.studRadians
		SCREW:
			return Constants.FASTENER.screwRadians
	return Constants.FASTENER.quarterTurn


## True when a crank of `radians` takes an unfastened turned fastener home (fastensOn).
static func fastens_on(f: Fastener, radians: float) -> bool:
	return not is_fastened(f) and radians > 0.0 and f.progress + radians / span_of(f.kind) >= 1.0


## A locked cam onto its bolt or a screw into what lies behind: ties two hosts solid (bindsRigidly).
static func binds_rigidly(f: Fastener) -> bool:
	return is_fastened(f) and (f.kind == CAM or f.kind == SCREW)


## Past seated: the joint holds and physics should bond it (isFastened).
static func is_fastened(f: Fastener) -> bool:
	return f.state != SEATED


## Fastened, or partway in: the part is stuck (isEngaged).
static func is_engaged(f: Fastener) -> bool:
	return is_fastened(f) or f.progress > 0.0


## All the way home (isHome).
static func is_home(f: Fastener) -> bool:
	return is_fastened(f) and f.progress >= 1.0


## A part pulls free only when every fastener on it is back to plain seated (canRelease).
static func can_release(fasteners: Array[Fastener]) -> bool:
	for f: Fastener in fasteners:
		if is_engaged(f):
			return false
	return true


static func _tap_pull(f: Fastener, event: String) -> Fastener:
	if event == TAP and f.state == SEATED:
		return Fastener.new(f.kind, PRESSED, 1.0)
	if event == PULL and f.state == PRESSED:
		return Fastener.new(f.kind, SEATED, 0.0)
	return f


## Turned fasteners hysterese: one fastens on reaching 1 and lets go only back at 0.
static func _turned(f: Fastener, radians: float, span: float, can_fasten: bool, can_loosen: bool, fastened_state: String) -> Fastener:
	if radians < 0.0 and not can_loosen:
		return f
	var progress := clampf(f.progress + radians / span, 0.0, 1.0)
	var state := f.state
	if state == SEATED and progress == 1.0 and radians > 0.0 and can_fasten:
		state = fastened_state
	elif state == fastened_state and progress == 0.0:
		state = SEATED
	if progress == f.progress and state == f.state:
		return f
	return Fastener.new(f.kind, state, progress)


## Next record for `event` (TAP, PULL, or CRANK by `radians`, positive tightens). `captured`: a
## cam's recess has a screwed bolt head within reach (locking needs it); `held`: a bolt's head is
## caught by a locked cam (it cannot back out). The same record back when nothing changes.
static func transition(f: Fastener, event: String, radians: float = 0.0, captured: bool = false, held: bool = false) -> Fastener:
	match f.kind:
		DOWEL, PIN, FITTING:
			return _tap_pull(f, event)
		BOLT, STUD, SCREW:
			if event != CRANK:
				return f
			return _turned(f, radians, span_of(f.kind), true, not held, SCREWED)
		CAM:
			if event != CRANK:
				return f
			return _turned(f, radians, span_of(f.kind), captured, true, LOCKED)
		SLIDE:
			return _tap_pull(f, PULL) if event == PULL else f
	return f
