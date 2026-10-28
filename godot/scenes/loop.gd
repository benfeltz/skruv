class_name Loop
extends Node3D
## The dowel loop in the room, with a mouse: the open page's loose parts on the floor; press one
## and drag to carry it (and whatever is joined to it) on a plane `hoverLift` above where it was
## picked, the wheel raising or lowering it; near its seat it turns to where it goes, a ghost
## shows the seat on offer, and letting go seats it. A click taps a part: its seated dowels go
## home, and a complete page turns the booklet. Pages the loop does not play are fastened on
## arrival and listed on screen. When the manual ends, "done", and JOHNNY is handed to Jolt on
## locked joints (the 2.0.4.2 shape) to stand.
##
## Every rule is logic/'s: Play (snap, seat, tap, pages, aim), Gesture (tap vs drag). This node
## turns poses into bodies and the mouse into pointer records. JOHNNY's parts, joints and pages
## come only from items/johnny.json; world.gd inserts this node at runtime.
##
## `autoplay` plays the manual itself with logic/hand.gd (the playthrough's hand), one move at a
## time, and with `shots` set saves a PNG mid-page-3 and one when done, then quits: the loop's
## windowed screenshot stage.

const CAMERA_POSITION := Vector3(0.0, 1.75, 2.75)
const CAMERA_TARGET := Vector3(0.0, 0.1, 0.95)
const CAMERA_FOV := 60.0
const RAY_LENGTH := 20.0
## A wheel notch as px of the web's desktop lift (GESTURE.desktopLiftRate is metres per px).
const WHEEL_NOTCH_PX := 20.0
const GHOST_COLOR := Color(0.35, 0.75, 1.0, Constants.SNAP.ghostOpacity)
const LABEL_FONT_SIZE := 18
const DONE_FONT_SIZE := 48
const UI_MARGIN := 16.0
## Autoplay: frames to glide a part to where the hand lets go, frames between moves, and frames
## of physics after "done" before the last shot.
const GLIDE_FRAMES := 6
const PAUSE_FRAMES := 2
const SETTLE_FRAMES := 40
## Autoplay's mid-build shot: on this page, once this many of its joints are pressed.
const SHOT_PAGE := 3
const SHOT_PAGE_PRESSED := 3

var data: ItemData
var play: Play
var gesture := Gesture.new()
var bodies: Dictionary[String, RigidBody3D] = {}
var autoplay: bool
## Folder the autoplay saves its PNGs in ("" = none, and it never quits).
var shots: String
var joints: Array[Generic6DOFJoint3D] = []
var done := false

var _camera: Camera3D
var _page_label: Label
var _auto_label: Label
var _done_label: Label
var _ghost: Node3D
var _proxies: Array[CollisionShape3D] = []
var _press_hit: Dictionary = {}
var _drag_id := ""
var _drag_pose: Transform3D
var _drag_plane_y := 0.0
var _drag_grab := Vector3.ZERO
var _drag_lift := 0.0
var _offer: Play.Offer = null
# Autoplay
var _auto_state := "choose"
var _auto_frame := 0
var _auto_from: Transform3D
var _auto_to: Transform3D
var _auto_tap := ""
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
	for inst: ItemData.Instance in data.instances:
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
	if autoplay or done:
		return
	var t := Time.get_ticks_msec()
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if mb.pressed:
				var dy := -WHEEL_NOTCH_PX if mb.button_index == MOUSE_BUTTON_WHEEL_UP else WHEEL_NOTCH_PX
				_handle(gesture.wheel(dy * maxf(mb.factor, 1.0)))
			return
		var button := 0 if mb.button_index == MOUSE_BUTTON_LEFT else 1 if mb.button_index == MOUSE_BUTTON_MIDDLE else 2
		if mb.pressed:
			_press_hit = _pick(mb.position)
			_handle(gesture.down(0, mb.position.x, mb.position.y, t, _press_hit, button))
		else:
			_handle(gesture.up(0, mb.position.x, mb.position.y, t))
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		_handle(gesture.move(0, mm.position.x, mm.position.y))


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_WINDOW_FOCUS_OUT and play != null:
		_handle(gesture.cancel_all())


func _process(delta: float) -> void:
	if autoplay:
		_autoplay_step()
	elif _drag_id != "":
		_drag_pose = play.aim(_drag_id, _drag_pose, delta)
		_offer = play.offer_for(_drag_id, _drag_pose)
	_sync()


## What the scene does with each gesture effect.
func _handle(effect: Gesture.Effect) -> void:
	if effect == null:
		return
	var id := String(effect.hit.get("id", ""))
	match effect.type:
		Gesture.DRAG_START:
			if id != "" and play.can_drag(id):
				_begin_drag(id, effect.hit["point"])
		Gesture.DRAG_MOVE:
			if _drag_id != "":
				var at: Variant = _on_plane(Vector2(effect.x, effect.y), _drag_plane_y)
				if at != null:
					_drag_pose.origin = (at as Vector3) + _drag_grab
		Gesture.LIFT:
			if _drag_id != "":
				var rise := effect.dy * Constants.GESTURE.desktopLiftRate
				_drag_lift += rise
				_drag_plane_y += rise
				_drag_pose.origin.y += rise
		Gesture.DRAG_END:
			if _drag_id != "":
				_end_drag()
		Gesture.DRAG_CANCEL:
			_drag_id = ""
			_offer = null
		Gesture.TAP:
			if id != "":
				var pressed := play.tap(id)
				if not pressed.is_empty():
					print("loop: tap %s pressed %d" % [id, pressed.size()])


func _begin_drag(id: String, point: Vector3) -> void:
	_drag_id = id
	_drag_lift = Constants.GESTURE.hoverLift
	_drag_plane_y = point.y + _drag_lift
	_drag_pose = play.bonds.poses[id]
	_drag_pose.origin.y += _drag_lift
	_drag_grab = _drag_pose.origin - Vector3(point.x, _drag_plane_y, point.z)
	_offer = null


## Lets go: onto the seat on offer, or back down by the lift where the mouse left it.
func _end_drag() -> void:
	var id := _drag_id
	_drag_id = ""
	if _offer != null:
		var seated := play.seat(id, _offer)
		print("loop: seated %s, %d pairs" % [seated, _offer.pairs.size()])
	else:
		var down := _drag_pose
		down.origin.y = maxf(down.origin.y - _drag_lift, play.bonds.poses[id].origin.y)
		play.bonds.move_compound(id, down)
	_offer = null
	play.turn_pages()


## Poses to bodies, the dragged compound carried, the ghost, the labels; "done" once.
func _sync() -> void:
	var carried: Dictionary[String, bool] = {}
	var carry := Transform3D.IDENTITY
	if _drag_id != "":
		carried = play.bonds.compound(_drag_id, false)
		carry = _drag_pose * play.bonds.poses[_drag_id].affine_inverse()
	if not done:
		for id: String in bodies:
			var body := bodies[id]
			var posed := play.bonds.poses.has(id)
			body.visible = posed
			body.collision_layer = 1 if posed else 0
			if posed:
				var pose := play.bonds.poses[id]
				body.global_transform = carry * pose if carried.has(id) else pose
	_show_ghost(carried)
	_update_labels()
	if play.steps.is_done() and not done:
		_finish()


func _show_ghost(carried: Dictionary[String, bool]) -> void:
	for child: Node in _ghost.get_children():
		child.queue_free()
	if _offer == null or _drag_id == "":
		return
	var to_seat := _offer.pose * play.bonds.poses[_drag_id].affine_inverse()
	for id: String in carried:
		var mesh := Item.make_mesh(data.type_of(data.instance(id)))
		var material := StandardMaterial3D.new()
		material.albedo_color = GHOST_COLOR
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mesh.material_override = material
		mesh.transform = to_seat * play.bonds.poses[id]
		_ghost.add_child(mesh)


func _update_labels() -> void:
	var step := play.steps.current()
	if step == null:
		_page_label.text = "Manual done: %d of %d pages" % [play.steps.page_count(), play.steps.page_count()]
	else:
		_page_label.text = "Page %d of %d: %d of %d dowels pressed\nDrag a part to its seat (wheel lifts it), click to tap it home." % [
			step.number, play.steps.page_count(), play.steps.done_count(step, play.bonds), step.joints.size()]
	var lines: PackedStringArray = ["Fastened by the loop (not played):"]
	for line: String in play.auto_log:
		lines.append("  " + line)
	_auto_label.text = "\n".join(lines) if not play.auto_log.is_empty() else ""


## The manual has ended: every body handed to Jolt, each fastened pair on a locked joint, as
## 2.0.4.2 stands JOHNNY. Seated hardware collides with nothing; shelf pins stay solid.
func _finish() -> void:
	done = true
	_done_label.visible = true
	# JOHNNY stands 2 m tall at the origin: the room's own framing shows it whole.
	_camera.look_at_from_position(Room.CAMERA_POSITION, Room.CAMERA_TARGET)
	for proxy: CollisionShape3D in _proxies:
		proxy.queue_free()
	_proxies.clear()
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
	for bond: Bonds.Bond in play.bonds.bonds():
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


## The part under the mouse, as a gesture hit {kind, id, point}, or {} for empty space.
func _pick(screen: Vector2) -> Dictionary:
	var from := _camera.project_ray_origin(screen)
	var to := from + _camera.project_ray_normal(screen) * RAY_LENGTH
	var query := PhysicsRayQueryParameters3D.create(from, to, 1)
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return {}
	var collider: Object = hit["collider"]
	if not (collider is RigidBody3D) or not (collider as Node).has_meta("part"):
		return {}
	return {"kind": "part", "id": String((collider as Node).get_meta("part")), "point": hit["position"]}


## Where the mouse ray crosses the level plane at height `y`, or null.
func _on_plane(screen: Vector2, y: float) -> Variant:
	var plane := Plane(Vector3.UP, y)
	return plane.intersects_ray(_camera.project_ray_origin(screen), _camera.project_ray_normal(screen))


## A part's body: frozen (kinematic) while the build is played, the poses moving it; hardware gets
## an invisible pick box never thinner than PICK.proxyMinSize.
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
	if part.size[part.size.max_axis_index()] < Constants.PICK.smallPartMax:
		var shape := BoxShape3D.new()
		shape.size = part.size.max(Vector3.ONE * Constants.PICK.proxyMinSize)
		var proxy := CollisionShape3D.new()
		proxy.name = "PickProxy"
		proxy.shape = shape
		body.add_child(proxy)
		_proxies.append(proxy)
	return body


func _make_camera() -> void:
	_camera = Camera3D.new()
	_camera.name = "LoopCamera"
	_camera.fov = CAMERA_FOV
	add_child(_camera)
	_camera.look_at_from_position(CAMERA_POSITION, CAMERA_TARGET)
	_camera.current = true


func _make_ui() -> void:
	var layer := CanvasLayer.new()
	layer.name = "UI"
	add_child(layer)
	_page_label = _label(LABEL_FONT_SIZE)
	_page_label.position = Vector2(UI_MARGIN, UI_MARGIN)
	layer.add_child(_page_label)
	_auto_label = _label(LABEL_FONT_SIZE - 4)
	_auto_label.position = Vector2(UI_MARGIN, UI_MARGIN + 3.0 * LABEL_FONT_SIZE)
	layer.add_child(_auto_label)
	_done_label = _label(DONE_FONT_SIZE)
	_done_label.text = "Done: JOHNNY stands"
	_done_label.position = Vector2(UI_MARGIN, get_viewport().get_visible_rect().size.y - UI_MARGIN - 1.5 * DONE_FONT_SIZE)
	_done_label.visible = false
	layer.add_child(_done_label)


func _label(size: int) -> Label:
	var label := Label.new()
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", Color.WHITE)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 4)
	return label


## One autoplay move per call: choose the next seat, glide the part to where the hand lets go,
## seat it on the offer, tap it home; the shots; quit when done and settled.
func _autoplay_step() -> void:
	if done:
		_settled += 1
		if shots != "" and _settled == SETTLE_FRAMES:
			print("loop: settled %d frames after done; worst body %s" % [SETTLE_FRAMES, _worst_body()])
			await _save_shot("loop-done.png")
			get_tree().quit()
		return
	_auto_frame += 1
	match _auto_state:
		"choose":
			var i := Hand.next_joint(play)
			if i < 0:
				return
			var id := Hand.carried(play, i)
			var seat: Transform3D = play.goal(id, i)
			_drag_id = id
			_auto_from = play.bonds.poses[id]
			_auto_to = Hand.hold(play, id, Hand.off_seat(seat))
			_drag_pose = _auto_from
			_auto_frame = 0
			_auto_state = "glide"
		"glide":
			var k := minf(1.0, float(_auto_frame) / GLIDE_FRAMES)
			_drag_pose = _auto_from.interpolate_with(_auto_to, k)
			if k >= 1.0:
				_offer = play.offer_for(_drag_id, _drag_pose)
				_auto_frame = 0
				_auto_state = "offer"
		"offer":
			if _auto_frame >= PAUSE_FRAMES:
				var id := _drag_id
				_drag_id = ""
				_auto_tap = play.seat(id, _offer) if _offer != null else ""
				_offer = null
				_auto_frame = 0
				_auto_state = "tap"
		"tap":
			if _auto_frame >= PAUSE_FRAMES:
				if _auto_tap != "":
					play.tap(_auto_tap)
				_auto_frame = 0
				_auto_state = "choose"
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
