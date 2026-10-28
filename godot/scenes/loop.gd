class_name Loop
extends Node3D
## JOHNNY built by hand in the room, with a mouse. Every rule is logic/'s: the router
## (logic/router.gd) decides camera versus part and plays the build on Play; this node forwards
## the mouse and Shift to it, turns poses into bodies, and draws the ghost, the labels and the
## lift line. JOHNNY's parts, joints and pages come only from items/johnny.json; world.gd inserts
## this node at runtime.
##
## Mouse: left drag on empty space orbits, right drag pans, middle drag or the wheel zooms toward
## the cursor. Left drag on a part carries it; the wheel mid-drag lifts it; Shift + scroll lifts
## the dragged or selected part on the elevation line, and it stays up while Shift is held.
## Near its seat a ghost shows where it goes; letting go seats it. A click taps a part home; a drag
## on something pressed home pulls it back out. A tool let go on a bolt head or cam slot sits there
## with a dial round it: circle the dial (or the tool) to turn it, or hold the tool still to drive
## it home; a click takes it off. A click on a part with nothing to press brings up its rings: a
## sweep along one turns it (and its whole build) a quarter turn about that axis; a click on empty
## space puts them away.
##
## `autoplay` plays the manual itself with logic/hand.gd (the playthrough's hand), one move at a
## time, and with `shots` set saves PNGs of the wrench and a cam mid-turn, the build tipped upright,
## and done, then quits: the loop's windowed screenshot stage.

const CAMERA_POSITION := Vector3(0.0, 1.75, 2.75)
const CAMERA_TARGET := Vector3(0.0, 0.1, 0.95)
## A wheel notch as px (the browser's deltaY for one notch).
const WHEEL_NOTCH_PX := 20.0
## A trackpad's two-finger scroll arrives as InputEventPanGesture, its delta the OS's scroll in
## points times 0.03 (Godot's macOS view scales precise deltas so); this undoes it, so the router
## gets the browser's deltaY in px for the same swipe.
const PAN_GESTURE_PX := 1.0 / 0.03
const GHOST_COLOR := Color(0.35, 0.75, 1.0, Constants.SNAP.ghostOpacity)
const LABEL_FONT_SIZE := 18
const DONE_FONT_SIZE := 48
const UI_MARGIN := 16.0
const LINE_COLOR := Color(1, 1, 1, 0.8)
## Autoplay: frames of physics after "done" before the last shot.
const SETTLE_FRAMES := 40
## Autoplay's shots: a tool on its head this far round its turn (the wrench's page, a cam's page),
## and the page after the tip, the build framed whole.
const SHOT_TURNED := 0.4
const SHOT_AFTER_TIP_PAGE := 11

var data: ItemData
var play: Play
var router: Router
var bodies: Dictionary[String, RigidBody3D] = {}
var bridge: PhysicsBridge
var autoplay: bool
## Folder the autoplay saves its PNGs in ("" = none, and it never quits).
var shots: String
var done := false
## The build's body poses when the manual ended, to measure what Jolt does after.
var _at_done: Dictionary[String, Transform3D] = {}

var _camera: CameraRig
var _page_label: Label
var _auto_label: Label
var _done_label: Label
var _line: Control
var _ring: TurnRing
var _ghost: Node3D
var _gizmo: MeshInstance3D
# Autoplay
var _hand: Hand
var _shots_taken: Dictionary[String, bool] = {}
var _settled := 0


func _init(item_data: ItemData = null, play_itself: bool = false, shot_dir: String = "") -> void:
	data = item_data
	autoplay = play_itself
	shots = shot_dir


func _ready() -> void:
	if data == null:
		data = ItemData.load_file(ItemData.JOHNNY_PATH)
	play = Play.new(data)
	router = Router.new(play)
	bridge = PhysicsBridge.new(router)
	add_child(bridge)
	bodies = bridge.bodies
	_make_camera()
	_make_ui()
	_ghost = Node3D.new()
	_ghost.name = "Ghost"
	add_child(_ghost)
	_gizmo = MeshInstance3D.new()
	_gizmo.name = "Gizmo"
	_gizmo.mesh = ImmediateMesh.new()
	var ring_material := StandardMaterial3D.new()
	ring_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	ring_material.vertex_color_use_as_albedo = true
	ring_material.no_depth_test = true
	ring_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_gizmo.material_override = ring_material
	add_child(_gizmo)
	play.open_page()
	bridge.sync()
	_sync()
	print("loop: %d parts, %d joints, %d pages" % [data.instances.size(), data.joints.size(), data.steps.size()])


func _unhandled_input(event: InputEvent) -> void:
	if autoplay:
		return
	var t := Time.get_ticks_msec()
	if event is InputEventKey:
		var key := event as InputEventKey
		if key.keycode == KEY_SHIFT:
			router.set_shift(key.pressed)
		return
	if done and not (event is InputEventMouseMotion) and not _is_camera_button(event) and not (event is InputEventGesture):
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if mb.pressed:
				var dy := -WHEEL_NOTCH_PX if mb.button_index == MOUSE_BUTTON_WHEEL_UP else WHEEL_NOTCH_PX
				router.wheel(dy * maxf(mb.factor, 1.0), mb.position)
			return
		var button := Router.LEFT if mb.button_index == MOUSE_BUTTON_LEFT else Router.MIDDLE if mb.button_index == MOUSE_BUTTON_MIDDLE else Router.RIGHT
		if mb.pressed:
			router.press(button, mb.position, t)
		else:
			router.release(button, mb.position, t)
	elif event is InputEventMouseMotion:
		router.motion((event as InputEventMouseMotion).position)
	elif event is InputEventPanGesture:
		# Two fingers on a trackpad: the wheel, as a browser reads it (zoom, or lift mid-drag).
		var pan := event as InputEventPanGesture
		router.wheel(pan.delta.y * PAN_GESTURE_PX, pan.position, pan.delta.x * PAN_GESTURE_PX)
	elif event is InputEventMagnifyGesture:
		var pinch := event as InputEventMagnifyGesture
		router.wheel(pinch_px(pinch.factor), pinch.position)


## A pinch's factor as the wheel delta that dollies the camera by that factor (OrbitCamera's zoom
## scale is 0.95^(|dy| / 100)): fingers apart (factor > 1) zoom in.
static func pinch_px(factor: float) -> float:
	if factor <= 0.0:
		return 0.0
	return 100.0 * log(factor) / log(0.95) / OrbitCamera.ZOOM_SPEED


func _is_camera_button(event: InputEvent) -> bool:
	return event is InputEventMouseButton and (event as InputEventMouseButton).button_index != MOUSE_BUTTON_LEFT


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_WINDOW_FOCUS_OUT and router != null:
		router.interrupted()
		router.set_shift(false)


func _process(delta: float) -> void:
	router.camera.viewport = get_viewport().get_visible_rect().size
	if autoplay:
		_autoplay_step(delta)
	else:
		router.update(delta)
	_camera.follow()
	_sync()


## The drawn turn on each body's mesh (the bridge moves the bodies), the ghost, the labels; "done"
## once.
func _sync() -> void:
	for id: String in bodies:
		var body := bodies[id]
		if not play.bonds.poses.has(id):
			continue
		var mesh := body.get_child(1) as Node3D
		mesh.transform = body.global_transform.affine_inverse() * router.drawn(id)
	_show_ghost()
	_update_labels()
	_line.queue_redraw()
	_ring.show_dials(router.dials())
	_draw_gizmo()
	if play.steps.is_done() and not done:
		_finish()


## Where a part is drawn: its pose, turned by its crank's progress (the router's drawTurned).
func _shown(id: String) -> Transform3D:
	return router.drawn(id)


func _show_ghost() -> void:
	for child: Node in _ghost.get_children():
		child.queue_free()
	var offer: Play.Offer = null
	var id := ""
	var members: Dictionary[String, bool] = {}
	if router.drag != null and router.drag.snapped != null:
		offer = router.drag.snapped
		id = router.drag.part
		members = router.carried()
	if offer == null:
		return
	var to_seat := offer.pose * _shown(id).affine_inverse()
	for m: String in members:
		var mesh := Item.make_mesh(data.type_of(data.instance(m)))
		var material := StandardMaterial3D.new()
		material.albedo_color = GHOST_COLOR
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mesh.material_override = material
		mesh.transform = to_seat * _shown(m)
		_ghost.add_child(mesh)


func _update_labels() -> void:
	var step := play.steps.current()
	if step == null:
		_page_label.text = "Manual done: %d of %d pages" % [play.steps.page_count(), play.steps.page_count()]
	else:
		var done_n := play.steps.done_count(step, play.bonds)
		var of_n := step.joints.size()
		var what := "joints done"
		if step.joints.is_empty() and not step.turns.is_empty():
			done_n = 0
			for i: int in step.turns:
				var joint := play.bonds.joint_for_spec(i)
				if joint != null and joint.fastener.state == Fastener.LOCKED:
					done_n += 1
			of_n = step.turns.size()
			what = "cams locked"
		_page_label.text = "Page %d of %d: %d of %d %s\nDrag a part to its seat (wheel lifts it, Shift + scroll holds it up), click to tap it home, drag it out to pull.\nTools: let go on a head, circle its dial or hold it still to turn; click to take it off. Click a part for rings: sweep one to turn the build.\nEmpty space: left drag orbits, right drag pans, wheel zooms." % [
			step.number, play.steps.page_count(), done_n, of_n, what]
	var lines: PackedStringArray = ["Fastened by the loop (not played):"]
	for line: String in play.auto_log:
		lines.append("  " + line)
	_auto_label.text = "\n".join(lines) if not play.auto_log.is_empty() else ""


## The rotate gizmo's three world-axis rings round the selected part (the web's x red, y green,
## z blue), the one being swept brighter.
func _draw_gizmo() -> void:
	var mesh := _gizmo.mesh as ImmediateMesh
	mesh.clear_surfaces()
	var f := router.ring_frame()
	if f.w == 0.0:
		return
	var centre := Vector3(f.x, f.y, f.z)
	var colors: Dictionary[String, Color] = {"x": Color(0.9, 0.3, 0.3), "y": Color(0.3, 0.85, 0.35), "z": Color(0.3, 0.5, 0.95)}
	for name: String in Router.RING_AXES:
		var axis := Router.RING_AXES[name]
		var u := axis.cross(Vector3.UP if absf(axis.y) < 0.9 else Vector3.RIGHT).normalized()
		var w := axis.cross(u)
		var color := colors[name]
		color.a = 1.0 if router.ring != null and router.ring.axis == axis else Constants.GIZMO.opacity
		mesh.surface_begin(Mesh.PRIMITIVE_LINE_STRIP)
		for n: int in Router.RING_SAMPLES + 1:
			var a := TAU * n / Router.RING_SAMPLES
			mesh.surface_set_color(color)
			mesh.surface_add_vertex(centre + (u * cos(a) + w * sin(a)) * f.w)
		mesh.surface_end()


## The elevation line, while it holds a part: a track at LIFT_LINE.x, the knob at the part's height.
func _draw_line() -> void:
	if not router.lift.is_holding():
		return
	var size := get_viewport().get_visible_rect().size
	var x := size.x * Constants.LIFT_LINE.x
	var top := size.y * Constants.LIFT_LINE.top
	var bottom := size.y * Constants.LIFT_LINE.bottom
	_line.draw_line(Vector2(x, top), Vector2(x, bottom), LINE_COLOR, Constants.LIFT_LINE.lineWidth)
	var f := Lift.fraction_of(router.lift.height, router.lift.span)
	_line.draw_circle(Vector2(x, bottom - f * (bottom - top)), Constants.LIFT_LINE.knobRadius, LINE_COLOR, false, Constants.LIFT_LINE.lineWidth)


## The manual has ended: JOHNNY has stood in Jolt as it was built; the camera frames it, and the
## build's poses are kept to measure what Jolt does from here.
func _finish() -> void:
	done = true
	_done_label.visible = true
	var centre := play.box_of_set(play.bonds.compound(play._anchor(), false)).get_center()
	router.camera.frame(centre + (Room.CAMERA_POSITION - Room.CAMERA_TARGET), centre)
	_camera.follow()
	_at_done = bridge.snapshot()
	var worst := play.worst_error()
	print("loop: done; %d joints fastened, %d physics joints; built within %.4f mm and %.4f deg of the finished item" % [
		play.bonds.joints.size(), bridge.joints.size(), float(worst["offset"]) * 1000.0, rad_to_deg(float(worst["turn"]))])


## The room camera, under the router's seam, framed first on the laid-out parts.
func _make_camera() -> void:
	router.camera.viewport = get_viewport().get_visible_rect().size
	router.camera.frame(CAMERA_POSITION, CAMERA_TARGET)
	_camera = CameraRig.new(router.camera)
	add_child(_camera)


func _make_ui() -> void:
	var layer := CanvasLayer.new()
	layer.name = "UI"
	add_child(layer)
	_page_label = _label(LABEL_FONT_SIZE)
	_page_label.position = Vector2(UI_MARGIN, UI_MARGIN)
	layer.add_child(_page_label)
	_auto_label = _label(LABEL_FONT_SIZE - 4)
	_auto_label.position = Vector2(UI_MARGIN, UI_MARGIN + 6.0 * LABEL_FONT_SIZE)
	layer.add_child(_auto_label)
	_done_label = _label(DONE_FONT_SIZE)
	_done_label.text = "Done: JOHNNY stands"
	_done_label.position = Vector2(UI_MARGIN, get_viewport().get_visible_rect().size.y - UI_MARGIN - 1.5 * DONE_FONT_SIZE)
	_done_label.visible = false
	layer.add_child(_done_label)
	_line = Control.new()
	_line.name = "LiftLine"
	_line.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_line.set_anchors_preset(Control.PRESET_FULL_RECT)
	_line.draw.connect(_draw_line)
	layer.add_child(_line)
	_ring = TurnRing.new()
	layer.add_child(_ring)


func _label(size: int) -> Label:
	var label := Label.new()
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", Color.WHITE)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 4)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


## One autoplay frame: the hand's next move (it runs the router's frame); the shots; quit when
## done and settled.
func _autoplay_step(delta: float) -> void:
	if done:
		router.update(delta)
		_settled += 1
		if shots != "" and _settled == SETTLE_FRAMES:
			var moved := bridge.moved_since(_at_done)
			print("loop: settled %d frames after done; worst body %s moved %.2f mm, %s turned %.3f deg" % [SETTLE_FRAMES, moved["offset_id"], float(moved["offset"]) * 1000.0, moved["turn_id"], rad_to_deg(float(moved["turn"]))])
			await _save_shot("loop-done.png")
			get_tree().quit()
		return
	if _hand == null:
		_hand = Hand.new(router)
	_hand.step(delta)
	if not _hand.errors.is_empty():
		push_error("loop: the hand is stuck: %s" % "; ".join(_hand.errors))
		if shots != "":
			get_tree().quit(1)
		return
	_maybe_shoot_page()


## The film's shots as the hand gets to them: the wrench mid-turn on a bolt, the screwdriver
## mid-turn on a cam (each with its dial), and the build stood upright after the tip.
func _maybe_shoot_page() -> void:
	if shots == "":
		return
	for turn: Bonds.Turn in play.bonds.turns():
		if turn.joints.is_empty() or Crank.turn_progress(turn) < SHOT_TURNED:
			continue
		var file := "loop-wrench.png" if turn.joints[0].kind == Fastener.BOLT else "loop-cam.png"
		if not _shots_taken.has(file):
			_shots_taken[file] = true
			_sync()
			_save_shot(file)
	var step := play.steps.current()
	if step != null and step.number == SHOT_AFTER_TIP_PAGE and not _shots_taken.has("loop-tip.png"):
		_shots_taken["loop-tip.png"] = true
		var centre := play.box_of_set(play.bonds.compound(play._anchor(), false)).get_center()
		router.camera.frame(centre + (Room.CAMERA_POSITION - Room.CAMERA_TARGET), centre)
		_camera.follow()
		_sync()
		_save_shot("loop-tip.png")


func _save_shot(file: String) -> void:
	await RenderingServer.frame_post_draw
	var path := shots.path_join(file)
	var err := get_viewport().get_texture().get_image().save_png(path)
	print("loop: shot %s (%s)" % [path, error_string(err)])
