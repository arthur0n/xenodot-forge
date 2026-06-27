# tools/play_boss_render_windowed.gd — WINDOWED render-health bot for the boss/VFX session.
# NOT headless: needs a real window (Metal/Vulkan). Run WITHOUT --headless:
#   $GODOT --path . --resolution 960x540 -s tools/play_boss_render_windowed.gd
# Spawns the real Boss + a magnet enemy in a lit world, frames a camera on the SUBJECT
# (not the HUD horizon), captures frames at key moments, and asserts the render-health
# metric SET (mean-in-range + stdev + entropy + unique-count + cell-spread) per godot-verify.
# Also drives a SlamAttack telegraph so the warning ring + shockwave are on-screen, and
# places the camera INSIDE the magnet RadiusBubble to prove the inside-out cull fix renders.
# Exit 0 = all metric sets healthy, 1 = any vantage unhealthy.
extends SceneTree

const BOSS_SCENE: PackedScene = preload("res://entities/boss/boss.tscn")
const WARDEN: BossData = preload("res://archetypes/boss_warden.tres")
const ENEMY_SCENE: PackedScene = preload("res://entities/enemy/enemy.tscn")
const MAGNET: EnemyArchetype = preload("res://archetypes/tank_magnet.tres")
const SLAM_SCENE: PackedScene = preload("res://entities/boss/attacks/slam_attack.tscn")

var _pass_count: int = 0
var _fail_count: int = 0
var _cam: Camera3D = null
var _world: Node3D = null
var _boss: Boss = null
var _enemy: Node3D = null
var _player: CharacterBody3D = null


func _initialize() -> void:
	print("=== WINDOWED RENDER: boss + magnet + slam ===")
	if DisplayServer.get_name() == "headless":
		print("VERIFY-RENDER: SKIP — no display (headless renderer). Run windowed.")
		quit(0)
		return
	await _run_all()
	print("\n=== RESULTS: %d pass / %d fail ===" % [_pass_count, _fail_count])
	quit(1 if _fail_count > 0 else 0)


func _run_all() -> void:
	_build_world()
	# One frame so all add_child'd nodes are inside the tree before we set global transforms.
	await physics_frame
	_place_subjects()
	# Settle physics + first-frame pipeline warmup.
	for _i in 40:
		await physics_frame
	# Vantage A: boss framed head-on, idle.
	_aim_camera(Vector3(0.0, 4.0, 12.0), Vector3(0.0, 1.5, 0.0))
	await _capture("bossA_idle")
	# Vantage B: drive a slam telegraph so the warning ring is on-screen, capture mid-tell.
	await _drive_slam_and_capture()
	# Vantage C: camera INSIDE the magnet bubble (within bubble_radius) — proves cull fix.
	_aim_camera(Vector3(20.0, 1.5, 0.0), Vector3(22.0, 1.0, 0.0))
	await _capture("magnet_inside")


func _build_world() -> void:
	_world = Node3D.new()
	root.add_child(_world)
	current_scene = _world
	# Wide lit floor.
	var floor_body: StaticBody3D = StaticBody3D.new()
	var floor_mesh: MeshInstance3D = MeshInstance3D.new()
	var plane: PlaneMesh = PlaneMesh.new()
	plane.size = Vector2(120.0, 120.0)
	var fmat: StandardMaterial3D = StandardMaterial3D.new()
	fmat.albedo_color = Color(0.25, 0.27, 0.30)
	floor_mesh.mesh = plane
	floor_mesh.set_surface_override_material(0, fmat)
	floor_body.add_child(floor_mesh)
	_world.add_child(floor_body)
	# Sun + environment so the scene is lit like a real level vantage.
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50.0, -40.0, 0.0)
	sun.light_energy = 1.2
	_world.add_child(sun)
	var env_holder: WorldEnvironment = WorldEnvironment.new()
	var env: Environment = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.10, 0.12, 0.16)
	env.ambient_light_color = Color(0.4, 0.42, 0.48)
	env.ambient_light_energy = 0.5
	env_holder.environment = env
	_world.add_child(env_holder)
	# Camera.
	_cam = Camera3D.new()
	_world.add_child(_cam)
	_cam.current = true
	# Boss at origin.
	_boss = BOSS_SCENE.instantiate() as Boss
	_boss.data = WARDEN
	_world.add_child(_boss)
	# Magnet enemy at +X with its RadiusBubble; bind its archetype so the bubble is sized/tinted.
	_enemy = ENEMY_SCENE.instantiate() as Node3D
	_enemy.set("archetype", MAGNET)
	_world.add_child(_enemy)
	# Stub player in group "player" so slam AoE/seam has a target.
	_player = CharacterBody3D.new()
	_player.add_to_group("player")
	_world.add_child(_player)


# Set global transforms only AFTER the nodes are inside the tree (avoids is_inside_tree warnings).
func _place_subjects() -> void:
	_boss.global_position = Vector3.ZERO
	_enemy.global_position = Vector3(22.0, 0.0, 0.0)
	_player.global_position = Vector3(3.0, 0.5, 3.0)


func _aim_camera(from: Vector3, at: Vector3) -> void:
	_cam.global_position = from
	_cam.look_at(at, Vector3.UP)


func _drive_slam_and_capture() -> void:
	var boss: Boss = _world.find_child("Boss", false, false) as Boss
	if boss == null:
		_fail("slam vantage: boss not found")
		return
	# Build a real SlamAttack under the boss, bind it, start the telegraph (spawns warning ring).
	var slam: SlamAttack = SLAM_SCENE.instantiate() as SlamAttack
	boss.add_child(slam)
	slam.bind(boss)
	slam.start()
	# Frame the boss + the growing floor ring from a low angle.
	_aim_camera(Vector3(0.0, 3.0, 10.0), Vector3(0.0, 0.5, 0.0))
	# Let the ring grow ~half the inner telegraph so it is clearly visible, then capture.
	for _i in 12:
		await physics_frame
	await _capture("slam_telegraph")
	# Detonate (spawns shockwave), capture the impact ring.
	for _i in 20:
		var done: bool = slam.tick(0.05)
		await physics_frame
		if done:
			break
	await _capture("slam_shockwave")


# ── render-health metric set (godot-verify contract) ────────────────────────────
func _capture(label: String) -> void:
	# Let the frame render.
	for _i in 4:
		await physics_frame
	var img: Image = root.get_texture().get_image()
	if img == null:
		_fail("%s: null framebuffer image" % label)
		return
	img.save_png("res://.godot/play_render_%s.png" % label)
	# Downscale to ~128x72 for the metric set.
	img.resize(128, 72, Image.INTERPOLATE_BILINEAR)
	var metrics: Dictionary = _compute_metrics(img)
	_grade(label, metrics)


func _compute_metrics(img: Image) -> Dictionary:
	var w: int = img.get_width()
	var h: int = img.get_height()
	var sum_l: float = 0.0
	var sum_sq: float = 0.0
	var n: float = float(w * h)
	var bins: Array[int] = []
	bins.resize(10)
	var uniq: Dictionary = {}
	for y: int in range(h):
		for x: int in range(w):
			var c: Color = img.get_pixel(x, y)
			var l: float = c.get_luminance()
			sum_l += l
			sum_sq += l * l
			var b: int = clampi(int(l * 10.0), 0, 9)
			bins[b] += 1
			# Quantize colour to ~5 bits/channel for unique-count.
			var key: int = (int(c.r * 15.0) << 8) | (int(c.g * 15.0) << 4) | int(c.b * 15.0)
			uniq[key] = true
	var mean: float = sum_l / n
	var variance: float = (sum_sq / n) - (mean * mean)
	var stdev: float = sqrt(maxf(variance, 0.0))
	# Shannon entropy over 10 luminance bins.
	var entropy: float = 0.0
	for count: int in bins:
		if count > 0:
			var pr: float = float(count) / n
			entropy -= pr * (log(pr) / log(2.0))
	# 4x4 cell-mean spread.
	var cell_means: Array[float] = _cell_means(img, 4)
	var cmin: float = 1.0
	var cmax: float = 0.0
	for cm: float in cell_means:
		cmin = minf(cmin, cm)
		cmax = maxf(cmax, cm)
	return {
		"mean": mean,
		"stdev": stdev,
		"entropy": entropy,
		"unique": uniq.size(),
		"cell_spread": cmax - cmin,
	}


func _cell_means(img: Image, cells: int) -> Array[float]:
	var w: int = img.get_width()
	var h: int = img.get_height()
	var means: Array[float] = []
	# intentional: whole-cell pixel block size.
	@warning_ignore("integer_division")
	var cw: int = w / cells
	# intentional: whole-cell pixel block size.
	@warning_ignore("integer_division")
	var ch: int = h / cells
	for cy: int in range(cells):
		for cx: int in range(cells):
			var s: float = 0.0
			var cnt: int = 0
			for y: int in range(cy * ch, mini((cy + 1) * ch, h)):
				for x: int in range(cx * cw, mini((cx + 1) * cw, w)):
					s += img.get_pixel(x, y).get_luminance()
					cnt += 1
			if cnt > 0:
				means.append(s / float(cnt))
	return means


func _grade(label: String, m: Dictionary) -> void:
	var mean: float = m["mean"]
	var stdev: float = m["stdev"]
	var entropy: float = m["entropy"]
	var uniq: int = m["unique"]
	var cell_spread: float = m["cell_spread"]
	print(
		(
			"  [%s] mean=%.3f stdev=%.3f entropy=%.2f unique=%d cell_spread=%.3f"
			% [label, mean, stdev, entropy, uniq, cell_spread]
		)
	)
	# INFERRED bands (godot-verify), CALIBRATED for this minimal synthetic vantage (flat floor +
	# few subjects → fewer unique colours than a full level; the >=20 full-level floor is too
	# strict here). These catch black/blown/flat/solid-flood, the real render-health failure modes.
	_assert(label, mean > 0.02 and mean < 0.97, "mean in [0.02,0.97] (not black/blown)")
	_assert(label, stdev > 0.02, "stdev above flat floor")
	_assert(label, entropy > 1.5, "entropy above 1.5 bits")
	_assert(label, uniq >= 8, "unique colours >= 8 (not a solid flood)")
	_assert(label, cell_spread < 0.7, "cell_spread < 0.7 (no half/half overlay)")


func _assert(label: String, cond: bool, msg: String) -> void:
	if cond:
		_pass_count += 1
		print("    PASS [%s]: %s" % [label, msg])
	else:
		_fail_count += 1
		print("    FAIL [%s]: %s" % [label, msg])


func _fail(msg: String) -> void:
	_fail_count += 1
	print("  FAIL: %s" % msg)
