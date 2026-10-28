class_name Constants
extends RefCounted
## The web build's feel constants, copied verbatim from src/constants.ts under the same names
## (each block notes its source). Read as Constants.SNAP.maxDistance, as the web reads
## SNAP.maxDistance. Only the rows the dowel loop reads are needed, but each block is copied
## whole so a later slice finds it here. Two FASTENER rows are the Flatpack contract's
## (CONTRACT in tools/validate/lib/vocabulary.ts): sinkDepth comes through the export
## (ItemData.sink_depth), captureRadius is copied with that note.


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
