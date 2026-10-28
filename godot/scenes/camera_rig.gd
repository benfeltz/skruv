class_name CameraRig
extends Camera3D
## The room's camera, driven only through logic/camera.gd: each frame it takes the orbit's eye
## and target and the viewport's size, and that is all. Input never reaches it; the router feeds
## the orbit, and enables or disables it through its seam.

var orbit: OrbitCamera


func _init(o: OrbitCamera = null) -> void:
	orbit = o if o != null else OrbitCamera.new()
	name = "CameraRig"
	fov = Constants.CAMERA.fov
	near = Constants.CAMERA.near
	far = Constants.CAMERA.far
	keep_aspect = Camera3D.KEEP_HEIGHT


func _ready() -> void:
	current = true
	follow()


## The orbit's pose onto the Camera3D (call after the orbit moved).
func follow() -> void:
	orbit.viewport = get_viewport().get_visible_rect().size
	var v := orbit.view()
	look_at_from_position(v.eye, v.target, Vector3.UP)
