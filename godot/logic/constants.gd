class_name Constants
extends RefCounted
## The web build's feel constants, copied verbatim from src/constants.ts under the same names
## (each block notes its source). Read as Constants.SNAP.maxDistance, as the web reads
## SNAP.maxDistance. Only the rows the dowel loop reads are needed, but each block is copied
## whole so a later slice finds it here. Two FASTENER rows are the Flatpack contract's
## (CONTRACT in tools/validate/lib/vocabulary.ts): sinkDepth comes through the export
## (ItemData.sink_depth), captureRadius is copied with that note.
##
## `knobs` is not the web's: it holds the switches this port adds so two rules can be compared by
## feel (2.0.4.4). Each defaults to the web's behaviour.


## src/constants.ts `SNAP` (connector snapping, src/game/snapMath.ts).
class SNAP:
	const maxDistance := 0.08
	const maxAngle := (40.0 * PI) / 180.0
	const roomTolerance := 0.002
	const ghostOpacity := 0.45
	const assistStrength := 9.0
	const flashMs := 450


## src/constants.ts `GESTURE` (src/game/gestureState.ts, src/game/dragMath.ts). CSS px where
## the web says so; here they are viewport px.
class GESTURE:
	const tapMaxDistance := 10.0
	const tapMaxMs := 350
	const hoverLift := 0.03
	const wallMargin := 0.05
	const detentStep := PI / 2.0
	const liftRate := 0.004
	const desktopLiftRate := 0.0025
	const ceilingMargin := 0.1


## src/constants.ts `FASTENER` (src/game/fasteners.ts, src/game/assembly.ts).
class FASTENER:
	const pullDistance := 40.0
	const boltRadians := 4.0 * PI
	const studRadians := 4.0 * PI
	const screwRadians := 4.0 * PI
	const quarterTurn := PI / 2.0
	## CONTRACT.captureRadius. (CONTRACT.sinkDepth, the web's FASTENER.sinkDepth, is
	## ItemData.sink_depth: it comes through the export, never a second copy.)
	const captureRadius := 0.015
	## CONTRACT.mateTolerance (tools/validate/lib/vocabulary.ts): two connectors this close are
	## at one spot (a stud's hex at its end). Copied with captureRadius.
	const mateTolerance := 0.001
	const crankDeadzone := 12.0
	const driveSeconds := 1.5
	const ratchetRadians := PI / 4.0
	const angularPlayDegrees := 0.0
	const playDamping := 1000.0


## src/constants.ts `PANEL` (panel fit, src/game/panelFit.ts): a carried panel seats by all its
## holes at once. Not in the plan's list; the panel half of the snap needs it.
class PANEL:
	const maxDistance := 0.15
	const maxAngle := (60.0 * PI) / 180.0
	const matchTolerance := 0.01
	const seatSlack := 0.02
	const matchAngle := (5.0 * PI) / 180.0
	const preferSlide := 0.035
	const zone := 0.4
	const rate := 6.0
	const holdReach := 0.08
	const holdTurn := (20.0 * PI) / 180.0
	const offerMargin := 0.02


## src/constants.ts `AIM` (self-aim, src/game/toolAim.ts): dragged hardware turns its end into a
## seat within `zone`. The mouse loop's "where it goes" assist reads zone and rate.
class AIM:
	const zone := 0.3
	const rate := 8.0
	const toolZone := 0.3
	const toolRate := 8.0
	const settled := 0.001


## src/constants.ts `PICK` (fat-finger picking, src/game/pickMath.ts): hardware is millimetres
## across, so the mouse loop gives each small part an invisible pick box never thinner than
## proxyMinSize.
class PICK:
	const smallPartMax := 0.25
	const proxyMinSize := 0.04
	const fingerRadius := 0.025


## src/constants.ts `CAMERA` (src/scene/cameraControls.ts). mobileStartScale is the phone's and
## unused on the desktop loop; copied whole.
class CAMERA:
	const fov := 50.0
	const near := 0.02
	const far := 100.0
	const startPosition := Vector3(2.0, 1.8, 2.4)
	const startTarget := Vector3(0.0, 0.6, 0.0)
	const mobileStartScale := 1.4
	const pivotOnParts := 1


## src/constants.ts `CAMERA_LIMITS` (src/scene/cameraLimits.ts). targetHeight is [low, high].
class CAMERA_LIMITS:
	const targetMargin := 0.6
	const targetHeight := Vector2(0.0, 2.2)
	const floorClearance := 0.05
	const minDistance := 0.15
	const maxDistance := 8.0
	const panReference := 1.2
	const maxPanBoost := 5.0
	const minPolarAngle := (40.0 * PI) / 180.0
	const maxPolarAngle := (80.0 * PI) / 180.0
	const dampingFactor := 0.1


## src/constants.ts `ROOM`: the stage's floor (centred on the origin) and the lift ceiling. The
## room scene (scenes/room.gd) draws this floor; its walls are shorter than the ceiling, as the
## web's are.
class ROOM:
	const width := 6.0
	const depth := 5.0
	const height := 3.0


## src/constants.ts `LIFT_LINE` (src/ui/liftLine.ts, src/scene/liftHold.ts): the elevation line.
## Screen fractions and CSS px; the desktop loop draws it as a readout.
class LIFT_LINE:
	const x := 0.08
	const top := 0.22
	const bottom := 0.78
	const knobRadius := 22.0
	const lineWidth := 4.0
	const hitWidth := 48.0
	const easeRate := 8.0


## src/constants.ts `TURN_RING` (src/ui/turnRing.ts, src/game/turnRing.ts). CSS px.
class TURN_RING:
	const radius := 64.0
	const band := 24.0
	const flashMs := 400
	const width := 4.0
	const arcWidth := 6.0
	const arrowSize := 14.0


## src/constants.ts `RING` (target rings, src/game/toolTargets.ts ringStrengths). CSS px and m.
class RING:
	const screenRadius := 120.0
	const hitRadius := 36.0
	const maxDistance := 0.5
	const radius := 0.012
	const width := 0.004
	const opacity := 0.9
	const pool := 12


## The switches this port adds (2.0.4.4), not the web's. Each defaults to the web's rule.
class knobs:
	## Off (the web's rule): any type-compatible pair seats and the booklet only advises. On:
	## PR #96's dowel loop, where the snap offers only the open page's pairs and a page's loose
	## parts come out only when it opens.
	static var pageGating := false
	## The rotate gizmo turns by GESTURE.detentStep (the web's snap-rotate toggle). Off: free.
	static var ringDetents := true
