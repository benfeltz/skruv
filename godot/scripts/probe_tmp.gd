extends SceneTree
func _initialize() -> void:
	var data := ItemData.load_file(ItemData.JOHNNY_PATH)
	var play := Play.new(data, false)
	play.open_page()
	var router := Router.new(play)
	var hand := Hand.new(router)
	while hand.step(1.0 / 60.0) and play.steps.current().number == 1:
		pass
	# Now page 3, first seat. Run the hand until it holds the plinth.
	var n := 0
	while hand.step(1.0 / 60.0) and n < 40:
		n += 1
		if router.drag != null:
			var g := router._panel_goal()
			print("probe: f%d held %s rot %s goal %s snapped %s" % [n, router.drag.held.origin, router.drag.rotation.get_euler(), "none" if g == null else "%s d=%.3f turn=%.3f ends=%d" % [g.pose.origin, g.distance, g.turn, g.ends.size()], router.drag.snapped != null])
	print("probe: errors %s" % [hand.errors])
	quit()
