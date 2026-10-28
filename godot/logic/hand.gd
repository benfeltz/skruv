class_name Hand
extends RefCounted
## A scripted player for Play: which part to carry for the next open seat, and where a hand leaves
## it before the snap takes it. The headless playthrough (test/playthrough_test.gd) and the
## windowed autoplay (scenes/loop.gd, for the screenshots) both play through this, so the film
## shows the moves the test proves.

## How far off its seat the hand lets go of a part: a few centimetres along each axis and a few
## degrees about a tilted axis, inside SNAP and PANEL's windows.
const OFFSET := Vector3(0.02, -0.015, 0.012)
const TURN_DEG := 8.0
const TURN_AXIS := Vector3(0.3, 1.0, 0.2)
## The hand holds the part there this long while self-aim and panel magnetism (Play.aim) turn it
## toward where it goes, in this many steps.
const AIM_SECONDS := 1.0
const AIM_FRAMES := 60


## The open page's next seat to make (an export joint index), or -1.
static func next_joint(play: Play) -> int:
	var open := play.open_joints()
	return open[0] if not open.is_empty() else -1


## Which side of export joint `i` the hand carries: the smaller compound (a loose dowel to its
## panel; a horizontal, dowels and all, onto the side panel), the lib's mover on a tie.
static func carried(play: Play, i: int) -> String:
	var spec := play.data.joints[i]
	var hw := play.bonds.compound(spec.hardware, false).size()
	var host := play.bonds.compound(spec.host, false).size()
	if hw != host:
		return spec.hardware if hw < host else spec.host
	return spec.mover


## What the hand taps once a seat is made: the seat's mover (a lone dowel itself; a panel carried
## in on its dowels, whose tap pushes all of them home).
static func tap_target(play: Play, spec: int) -> String:
	var joint := play.bonds.joint_for_spec(spec)
	return joint.mover if joint != null else ""


## Off its seat as a hand would leave it: shifted, and turned about the part's own centre.
static func off_seat(seat: Transform3D) -> Transform3D:
	var turn := Basis(TURN_AXIS.normalized(), deg_to_rad(TURN_DEG))
	return Transform3D(turn * seat.basis, seat.origin + OFFSET)


## Holds `pose` while Play.aim turns it for AIM_SECONDS. Returns where it ends up.
static func hold(play: Play, id: String, pose: Transform3D) -> Transform3D:
	var held := pose
	for frame: int in AIM_FRAMES:
		held = play.aim(id, held, AIM_SECONDS / AIM_FRAMES)
	return held
