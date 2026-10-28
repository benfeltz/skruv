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
## it home; a click takes it off.
##
## `autoplay` plays the manual itself with logic/hand.gd (the playthrough's hand), one move at a
## time, and with `shots` set saves a PNG mid-page-3 and one when done, then quits: the loop's
## windowed screenshot stage.

const CAMERA_POSITION := Vector3(0.0, 1.75, 2.75)
const CAMERA_TARGET := Vector3(0.0, 0.1, 0.95)
## A wheel notch as px (the browser's deltaY for one notch).
const WHEEL_NOTCH_PX := 20.0
const GHOST_COLOR := Color(0.35, 0.75, 1.0, Constants.SNAP.ghostOpacity)
const LABEL_FONT_SIZE := 18
const DONE_FONT_SIZE := 48
const UI_MARGIN := 16.0
const LINE_COLOR := Color(1, 1, 1, 0.8)
## Autoplay: frames of physics after "done" before the last shot.
const SETTLE_FRAMES := 40
## Autoplay's mid-build shot: on this page, once this many of its joints are pressed.
const SHOT_PAGE := 3
const SHOT_PAGE_PRESSED := 3

var data: ItemData
var play: Play
var router: Router
var bodies: Dictionary[String, RigidBody3D] = {}
var autoplay: bool
## Folder the autoplay saves its PNGs in ("" = none, and it never quits).
var shots: String
var joints: Array[Generic6DOFJoint3D] = []
var done := false

var _camera: CameraRig
var _page_label: Label
var _auto_label: Label
var _done_label: Label
var _line: Control
var _ring: TurnRing
var _ghost: Node3D
# Autoplay
var _hand: Hand
var _shot_page_taken := false
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
	for inst: ItemData.Instance in data.box():
		var body := _make_body(inst)
		bodies[inst.id] = body
		add_child(body)
	_make_camera()
	_make_ui()
	_ghost = Node3D.new()
	_ghost.name = "Ghost"
	add_child(_ghost)
	play.open_page()
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
	if done and not (event is InputEventMouseMotion) and not _is_camera_button(event):
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


## Poses to bodies, the ghost, the labels; "done" once.
func _sync() -> void:
	if not done:
		for id: String in bodies:
			var body := bodies[id]
			var posed := play.bonds.poses.has(id)
			body.visible = posed
			body.collision_layer = 1 if posed else 0
			if posed:
				body.global_transform = _shown(id)
	_show_ghost()
	_update_labels()
	_line.queue_redraw()
	_ring.show_dials(router.dials())
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
		_page_label.text = "Page %d of %d: %d of %d joints done\nDrag a part to its seat (wheel lifts it, Shift + scroll holds it up), click to tap it home, drag it out to pull.\nTools: let go on a head, circle its dial or hold it still to turn; click to take it off.\nEmpty space: left drag orbits, right drag pans, wheel zooms." % [
			step.number, play.steps.page_count(), play.steps.done_count(step, play.bonds), step.joints.size()]
	var lines: PackedStringArray = ["Fastened by the loop (not played):"]
	for line: String in play.auto_log:
		lines.append("  " + line)
	_auto_label.text = "\n".join(lines) if not play.auto_log.is_empty() else ""


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


## The manual has ended: every body handed to Jolt, each fastened pair on a locked joint, as
## 2.0.4.2 stands JOHNNY. Seated hardware collides with nothing; shelf pins stay solid.
func _finish() -> void:
	done = true
	_done_label.visible = true
	router.camera.frame(Room.CAMERA_POSITION, Room.CAMERA_TARGET)
	_camera.follow()
	var embedded: Dictionary[String, bool] = {}
	for joint: Bonds.Joint in play.bonds.joints:
		if joint.kind != Item.SOLID_KIND:
			embedded[joint.hardware] = true
	for id: String in bodies:
		var body := bodies[id]
		body.global_transform = play.bonds.poses[id]
		body.freeze = false
		if embedded.has(id):
			body.collision_layer = 0
			body.collision_mask = 0
	for bond: Bonds.Bond in play.bonds.locks():
		_lock(bond.a, bond.b)
	var worst := play.worst_error()
	print("loop: done; %d joints fastened, %d locked joints; built within %.4f mm and %.4f deg of assembled" % [
		play.bonds.joints.size(), joints.size(), float(worst["offset"]) * 1000.0, rad_to_deg(float(worst["turn"]))])


## A joint with every axis locked, anchored midway between the two parts (Item's shape).
func _lock(a: String, b: String) -> void:
	var joint := Generic6DOFJoint3D.new()
	joint.name = "%s~%s" % [a, b]
	joint.position = (play.bonds.poses[a].origin + play.bonds.poses[b].origin) / 2.0
	for axis: String in ["x", "y", "z"]:
		joint.set("linear_limit_%s/enabled" % axis, true)
		joint.set("linear_limit_%s/upper_distance" % axis, 0.0)
		joint.set("linear_limit_%s/lower_distance" % axis, 0.0)
		joint.set("angular_limit_%s/enabled" % axis, true)
		joint.set("angular_limit_%s/upper_angle" % axis, 0.0)
		joint.set("angular_limit_%s/lower_angle" % axis, 0.0)
	add_child(joint)
	joint.node_a = joint.get_path_to(bodies[a])
	joint.node_b = joint.get_path_to(bodies[b])
	joints.append(joint)


## A part's body: frozen (kinematic) while the build is played, the poses moving it. Picking is the
## router's (the parts' boxes), so the body is only drawn and, at "done", simulated.
func _make_body(inst: ItemData.Instance) -> RigidBody3D:
	var part := data.type_of(inst)
	var body := RigidBody3D.new()
	body.name = inst.id
	body.set_meta("part", inst.id)
	body.mass = part.mass
	body.freeze = true
	body.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	body.visible = false
	body.collision_layer = 0
	body.add_child(Item.make_collider(part))
	body.add_child(Item.make_mesh(part))
	return body


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
			print("loop: settled %d frames after done; worst body %s" % [SETTLE_FRAMES, _worst_body()])
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


func _maybe_shoot_page() -> void:
	var step := play.steps.current()
	if shots == "" or _shot_page_taken or step == null or step.number != SHOT_PAGE:
		return
	if play.steps.done_count(step, play.bonds) >= SHOT_PAGE_PRESSED:
		_shot_page_taken = true
		_sync()
		_save_shot("loop-page%d.png" % SHOT_PAGE)


func _save_shot(file: String) -> void:
	await RenderingServer.frame_post_draw
	var path := shots.path_join(file)
	var err := get_viewport().get_texture().get_image().save_png(path)
	print("loop: shot %s (%s)" % [path, error_string(err)])


## The body farthest from its assembled pose after physics ran: what Jolt did to the build.
func _worst_body() -> String:
	var worst := 0.0
	var worst_id := ""
	for inst: ItemData.Instance in data.instances:
		var d := bodies[inst.id].global_position.distance_to(inst.position)
		if d > worst:
			worst = d
			worst_id = inst.id
	return "%s %.1f mm" % [worst_id, worst * 1000.0]
