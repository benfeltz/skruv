class_name Pick
extends RefCounted
## Fat-finger picking: which part a press means when small hardware sits near a panel. The port
## of src/game/pickMath.ts (isSmallPart, rayBoxReach, preferHit) plus the router's two casts
## (its real-mesh raycast and its proxy hits), done against the parts' boxes instead of meshes:
## every part here is a box, so the box is the mesh. Pure: rays and poses in, a hit out.
##
## A press hits the nearest box it enters (the real hit). A small part also has an invisible box
## no thinner than PICK.proxyMinSize; the ray entering it is a proxy hit, measured by how far the
## ray passes from the real box (`miss`) and how far along the ray that is (`depth`). preferHit
## then says which the finger meant.

const SEARCH_STEPS := 60


## A press on a part: which, where in the world, how far along the ray; for a proxy hit, how far
## the ray passes from the real part and how far along the ray the real part is.
class Hit:
	var part: String
	var point: Vector3
	var distance: float
	var miss: float
	var depth: float

	func _init(p: String = "", at: Vector3 = Vector3.ZERO, d: float = 0.0, m: float = 0.0, dp: float = 0.0) -> void:
		part = p
		point = at
		distance = d
		miss = m
		depth = dp


## A box a ray can hit: the part's id, its pose and its full size.
class Box:
	var part: String
	var pose: Transform3D
	var size: Vector3

	func _init(p: String, t: Transform3D, s: Vector3) -> void:
		part = p
		pose = t
		size = s


## A part this size is small: hardware or a tool, never a panel (isSmallPart).
static func is_small_part(size: Vector3) -> bool:
	return maxf(size.x, maxf(size.y, size.z)) < Constants.PICK.smallPartMax


## Distance from point `p` to an origin-centred box of half-extents `half`.
static func _point_box_gap(p: Vector3, half: Vector3) -> float:
	return Vector3(maxf(0.0, absf(p.x) - half.x), maxf(0.0, absf(p.y) - half.y), maxf(0.0, absf(p.z) - half.z)).length()


## Distance along the ray to where it enters an origin-centred box (slab test), or -1.
static func ray_box_entry(origin: Vector3, direction: Vector3, half: Vector3) -> float:
	var near := 0.0
	var far := INF
	for i: int in 3:
		if absf(direction[i]) < 1e-12:
			if absf(origin[i]) > half[i]:
				return -1.0
			continue
		var a := (-half[i] - origin[i]) / direction[i]
		var b := (half[i] - origin[i]) / direction[i]
		near = maxf(near, minf(a, b))
		far = minf(far, maxf(a, b))
	return near if near <= far else -1.0


## How the ray `origin + t·direction` (t ≥ 0, unit direction) meets an origin-centred box, both in
## the box's frame: Vector2(miss, depth): the closest it passes (0 through it), and where along
## the ray (rayBoxReach).
static func ray_box_reach(origin: Vector3, direction: Vector3, half: Vector3) -> Vector2:
	var entry := ray_box_entry(origin, direction, half)
	if entry >= 0.0:
		return Vector2(0.0, entry)
	var lo := 0.0
	var hi := origin.length() + 2.0 * half.length()
	for i: int in SEARCH_STEPS:
		var a := lo + (hi - lo) / 3.0
		var b := hi - (hi - lo) / 3.0
		if _point_box_gap(origin + direction * a, half) <= _point_box_gap(origin + direction * b, half):
			hi = b
		else:
			lo = a
	var t := (lo + hi) / 2.0
	return Vector2(_point_box_gap(origin + direction * t, half), t)


## What a press picks from the nearest real hit `part_hit` (or null) and the proxy hits (preferHit):
## a small part wins only when the finger is on it (miss within fingerRadius at its distance) and
## it is not behind the real hit; among several, the smallest miss, then the nearer. With no real
## hit, the best proxy.
static func prefer_hit(part_hit: Hit, proxy_hits: Array[Hit], finger_radius: float = Constants.PICK.fingerRadius) -> Hit:
	var visible: Array[Hit] = []
	for hit: Hit in proxy_hits:
		if part_hit == null or hit.part == part_hit.part or hit.depth <= part_hit.distance:
			visible.append(hit)
	var under: Array[Hit] = []
	for hit: Hit in visible:
		if hit.miss <= finger_radius * hit.distance:
			under.append(hit)
	var best_under := _best(under)
	if best_under != null:
		return part_hit if part_hit != null and best_under.part == part_hit.part else best_under
	return part_hit if part_hit != null else _best(visible)


static func _best(hits: Array[Hit]) -> Hit:
	var top: Hit = null
	for hit: Hit in hits:
		if top == null or hit.miss < top.miss or (hit.miss == top.miss and hit.depth < top.depth):
			top = hit
	return top


## The press along the ray from `origin` (unit `direction`) among `boxes`: the real hit and the
## small parts' proxy hits, preferred. Null for empty space.
static func pick(origin: Vector3, direction: Vector3, boxes: Array[Box]) -> Hit:
	var real: Hit = null
	var proxies: Array[Hit] = []
	for box: Box in boxes:
		var inverse := box.pose.affine_inverse()
		var local_origin := inverse * origin
		var local_direction := (inverse.basis * direction).normalized()
		var half := box.size / 2.0
		var entry := ray_box_entry(local_origin, local_direction, half)
		if entry >= 0.0 and (real == null or entry < real.distance):
			real = Hit.new(box.part, origin + direction * entry, entry)
		if not is_small_part(box.size):
			continue
		var proxy_half := box.size.max(Vector3.ONE * Constants.PICK.proxyMinSize) / 2.0
		var proxy_entry := ray_box_entry(local_origin, local_direction, proxy_half)
		if proxy_entry < 0.0:
			continue
		var reach := ray_box_reach(local_origin, local_direction, half)
		proxies.append(Hit.new(box.part, origin + direction * proxy_entry, proxy_entry, reach.x, reach.y))
	return prefer_hit(real, proxies)


## How far along the ray the first box is (the camera pivot's part pick), or -1.
static func first_distance(origin: Vector3, direction: Vector3, boxes: Array[Box]) -> float:
	var best := -1.0
	for box: Box in boxes:
		var inverse := box.pose.affine_inverse()
		var entry := ray_box_entry(inverse * origin, (inverse.basis * direction).normalized(), box.size / 2.0)
		if entry >= 0.0 and (best < 0.0 or entry < best):
			best = entry
	return best
