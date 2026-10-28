extends SceneTree
func _initialize() -> void:
	var data := ItemData.load_file(ItemData.JOHNNY_PATH)
	var play := Play.new(data, true)
	play.open_page()
	var router := Router.new(play)
	var hand := Hand.new(router)
	while hand.step(1.0 / 60.0) and hand.frames < 40000:
		if router.drag != null and router.drag.part == "shelfPin-5":
			print("probe: f%d ptr %s held %s plane %.3f h %.3f eye %s" % [hand.frames, router.drag.pointer, router.drag.held.origin, router.drag.plane_y, router.drag.height, router.camera.eye()])
	print("probe: errors %s" % [hand.errors])
	quit()
