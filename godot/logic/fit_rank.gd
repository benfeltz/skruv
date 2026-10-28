class_name FitRank
extends RefCounted
## "Where it goes": a panel's place in the finished item, how fits rank by it, and how long a fit
## on offer holds. The port of src/game/panelFit.ts's second half (preferredRelatives,
## preferredPoses, preferredThrough, isPreferred, rankFits, preferredTargets, heldOffer). Never a
## gate: any fit seats; where it goes is offered first. Pure: Transform3D poses, Snap connectors.

const SAME := 1e-6


## host type → panel type → each pose the panel sits at in the host's frame, in the finished item.
class Relatives:
	var by_host: Dictionary[String, Dictionary] = {}

	func poses(host_type: String, panel_type: String) -> Array[Transform3D]:
		var out: Array[Transform3D] = []
		var by_panel: Dictionary = by_host.get(host_type, {})
		out.assign(by_panel.get(panel_type, []))
		return out


## A fit as ranked: the fit, and whether it is where the panel goes.
class Ranked:
	var fit: PanelFit.Fit
	var preferred: bool


## Each panel's pose relative to every panel it shares a piece of hardware with in the assembled
## item, keyed by part type, both ways round (preferredRelatives). Computed once.
static func preferred_relatives(data: ItemData, is_panel: Callable) -> Relatives:
	var hosts_of: Dictionary[String, Array] = {}
	for spec: ItemData.JointSpec in data.joints:
		if not hosts_of.has(spec.hardware):
			hosts_of[spec.hardware] = []
		if not hosts_of[spec.hardware].has(spec.host):
			hosts_of[spec.hardware].append(spec.host)
	var out := Relatives.new()
	for hardware: String in hosts_of:
		var panels: Array[String] = []
		for id: String in hosts_of[hardware]:
			if bool(is_panel.call(id)):
				panels.append(id)
		for host: String in panels:
			for panel: String in panels:
				if panel == host:
					continue
				var h := data.instance(host)
				var p := data.instance(panel)
				var relative := Transform3D(Basis(h.rotation), h.position).affine_inverse() * Transform3D(Basis(p.rotation), p.position)
				relative = Bonds.orthonormal(relative)
				if not out.by_host.has(h.type):
					out.by_host[h.type] = {}
				var by_panel: Dictionary = out.by_host[h.type]
				if not by_panel.has(p.type):
					by_panel[p.type] = []
				var known := false
				for pose: Transform3D in by_panel[p.type]:
					if pose.origin.distance_to(relative.origin) < SAME and _turn(pose.basis, relative.basis) < SAME:
						known = true
				if not known:
					by_panel[p.type].append(relative)
	return out


## Where a `panel_type` goes on a `host_type` posed at `host_pose` (preferredPoses).
static func preferred_poses(relatives: Relatives, host_type: String, host_pose: Transform3D, panel_type: String) -> Array[Transform3D]:
	var out: Array[Transform3D] = []
	for relative: Transform3D in relatives.poses(host_type, panel_type):
		out.append(Bonds.orthonormal(host_pose * relative))
	return out


## Where a carried panel goes when a panel it carries goes at `preferred`: at the offset it had from
## that member when picked up (preferredThrough).
static func preferred_through(preferred: Transform3D, member: Transform3D, grabbed: Transform3D) -> Transform3D:
	return Bonds.orthonormal(preferred * (member.affine_inverse() * grabbed))


static func _turn(a: Basis, b: Basis) -> float:
	return a.get_rotation_quaternion().angle_to(b.get_rotation_quaternion())


## `offset` within `across` of unit `axis`'s line and `along` along it.
static func _along_axis(offset: Vector3, axis: Vector3, across: float, along: float) -> bool:
	var slide := offset.dot(axis)
	return absf(slide) <= along and (offset - axis * slide).length() <= across


## True when `fit` puts the panel where one of `preferred` has it (isPreferred).
static func is_preferred(fit: PanelFit.Fit, preferred: Array[Transform3D]) -> bool:
	var axis := fit.pairs[0].end.axis
	for pose: Transform3D in preferred:
		if _turn(fit.pose.basis, pose.basis) <= Constants.PANEL.matchAngle and _along_axis(fit.pose.origin - pose.origin, axis, Constants.PANEL.matchTolerance, Constants.PANEL.preferSlide):
			return true
	return false


## `fits` best first: where it goes first, then the most pairs, then the nearest (rankFits).
static func rank_fits(fits: Array[PanelFit.Fit], preferred: Array[Transform3D]) -> Array[Ranked]:
	var out: Array[Ranked] = []
	for fit: PanelFit.Fit in fits:
		var r := Ranked.new()
		r.fit = fit
		r.preferred = is_preferred(fit, preferred)
		out.append(r)
	out.sort_custom(func(a: Ranked, b: Ranked) -> bool:
		if a.preferred != b.preferred:
			return a.preferred
		if a.fit.pairs.size() != b.fit.pairs.size():
			return a.fit.pairs.size() > b.fit.pairs.size()
		return a.fit.distance < b.fit.distance)
	return out


## The ends a panel where it goes would sit on: of `ends`, the nearest compatible one to each hole,
## axis against axis within matchAngle, within matchTolerance across and preferSlide along
## (preferredTargets).
static func preferred_targets(holes: Array[Snap.WorldConnector], ends: Array[Snap.WorldConnector], compatible: Dictionary[String, String]) -> Array[Snap.WorldConnector]:
	var out: Array[Snap.WorldConnector] = []
	for hole: Snap.WorldConnector in holes:
		var best: Snap.WorldConnector = null
		var best_d := INF
		for end: Snap.WorldConnector in ends:
			if out.has(end) or not Snap.are_compatible(hole.type, end.type, compatible) or Snap.misalignment(hole.axis, end.axis) > Constants.PANEL.matchAngle:
				continue
			var offset := end.position - hole.position
			if not _along_axis(offset, end.axis, Constants.PANEL.matchTolerance, Constants.PANEL.preferSlide):
				continue
			if offset.length() < best_d:
				best_d = offset.length()
				best = end
		if best != null:
			out.append(best)
	return out


## The offer on now given `current` and the best the search found from here (`next`), with the
## panel at `finger` (heldOffer): the current one holds until the finger has moved it holdReach or
## turned it holdTurn since it was taken, or `next` is better (where it goes, else more pairs), or
## as good and offerMargin nearer the finger.
static func held_offer(current: Play.Offer, next: Play.Offer, finger: Transform3D) -> Play.Offer:
	if current == null or not current.has_taken:
		return _fresh(next, finger)
	var taken := current.taken
	if finger.origin.distance_to(taken.origin) > Constants.PANEL.holdReach or _turn(finger.basis, taken.basis) > Constants.PANEL.holdTurn:
		return _fresh(next, finger)
	if next == null:
		return current
	if next.key == current.key:
		if next.preferred and not current.preferred:
			next.taken = taken
			next.has_taken = true
			return next
		return current
	if next.preferred != current.preferred:
		return _fresh(next, finger) if next.preferred else current
	if next.pairs.size() != current.pairs.size():
		return _fresh(next, finger) if next.pairs.size() > current.pairs.size() else current
	var off_next := next.pose.origin.distance_to(finger.origin)
	var off_current := current.pose.origin.distance_to(finger.origin)
	return _fresh(next, finger) if off_next + Constants.PANEL.offerMargin < off_current else current


static func _fresh(offer: Play.Offer, finger: Transform3D) -> Play.Offer:
	if offer != null:
		offer.taken = finger
		offer.has_taken = true
	return offer
