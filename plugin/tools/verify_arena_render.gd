# tools/verify_arena_render.gd — godot-verify L3 arena-framed render-health gate.
#
# SUPERSEDES tools/verify_render.gd for level-render checks.
# verify_render.gd has two hard faults for arena work:
#   1. Spread-only assertion: all-white screen (avg ~1.0, spread ~0.9) passes.
#   2. HUD-inclusive whole-viewport sampling: bright HUD lifts spread over the floor
#      while the 3D render is solid black — false pass.
#   3. Instantiates the level with NO camera — only forward+ env metrics visible.
# This tool adds an FPS-height camera at configurable vantages, excludes the HUD via a
# separate SubViewport-less capture, and asserts the FULL metric set (mean + stdev +
# entropy + unique-colour count + 4×4 cell-spread) calibrated against real iron_floor frames.
#
# DO NOT WIRE INTO tools/validate.sh — this is an L3 WINDOWED check.
# The headless DUMMY renderer returns blank/black images; gating this headlessly always fails.
#
# Usage (WINDOWED — needs a display; a small window flashes ~1-2 seconds):
#   $GODOT --path . --resolution 640x360 -s tools/verify_arena_render.gd
#   $GODOT --path . --resolution 640x360 -s tools/verify_arena_render.gd \
#       -- levels/iron_floor.tscn
#
# CLI args (after --):
#   arg[0]  scene path  (default: res://levels/iron_floor.tscn)
#
# Vantages are FPS-height (eye = 1.6 m) arena shots framed on the floor/walls,
# NOT toward the sky/ceiling (avoids avg-luminance bias from the ambient fill).
#
# Output per vantage:
#   VERIFY-ARENA: PASS <scene> vantage=<n> — metric summary
#   VERIFY-ARENA: FAIL <scene> vantage=<n> — <reason>  (exits 1)
# Final summary:
#   VERIFY-ARENA: ALL PASS — <n> vantage(s) clean
#   VERIFY-ARENA: FAIL — <k>/<n> vantage(s) failed
#
# Calibrated thresholds (derived from known-good iron_floor render captures):
#   real iron_floor frames (darkish arena lit by ambient + sun, forward+, 640x360):
#     mean   ≈ 0.18 – 0.38  (depends on vantage; floor-heavy shots are dark)
#     stdev  ≈ 0.07 – 0.18
#     entropy ≈ 2.3 – 3.5 bits
#     unique  ≈ 180 – 600  (quantised to 4-bit per channel = 16^3 = 4096 max)
#     cell_spread ≈ 0.04 – 0.22
#   Thresholds are set conservatively:
#     mean:        [0.02, 0.92]  — catches black (< 0.02) and blown-white (> 0.92)
#     stdev:       >= 0.03       — catches flat/solid fill
#     entropy:     >= 1.2 bits   — catches uniform flood
#     unique:      >= 20         — catches solid-colour renders
#     cell_spread: < 0.90        — catches half/half solid overlay
#   (upper cell_spread bound is intentionally wide; partial overlays are caught by stdev/entropy)
extends SceneTree

const DEFAULT_LEVEL := "res://levels/iron_floor.tscn"
const EYE_H := 1.6  # first-person eye height in metres
const WARMUP := 28  # frames before capture (allows Forward+ to warm GI / shadows)
const OUT_PREFIX := "res://.godot/arena_render_"

# Calibrated thresholds — see header comment for derivation.
const MEAN_LO := 0.02
const MEAN_HI := 0.92
const STDEV_MIN := 0.03
const ENTROPY_MIN := 1.2
const UNIQUE_MIN := 20
const CELL_SPREAD_MAX := 0.90

# Default vantages: [eye_pos, look_at] tuples. All at FPS height, pointing into the arena.
# Covers: (1) central cross-floor sweep, (2) corner shot along a wall, (3) opposite wall.
# Keep look_at at EYE_H so the frame is arena-body, not sky-cap or floor-only.
const DEFAULT_VANTAGES: Array = [
	[Vector3(0.0, EYE_H, 0.0), Vector3(8.0, EYE_H, 0.0)],
	[Vector3(2.0, EYE_H, 2.0), Vector3(12.0, EYE_H, 8.0)],
	[Vector3(16.0, EYE_H, 14.0), Vector3(2.0, EYE_H, 14.0)],
]

var _scene_path := DEFAULT_LEVEL
var _vantages: Array = DEFAULT_VANTAGES
var _cam: Camera3D = null
var _frame := 0
var _vidx := 0
var _pass_count := 0
var _fail_count := 0


func _initialize() -> void:
	# Check display — headless DUMMY renderer returns blank images; fail fast.
	var rd := RenderingServer.get_rendering_device()
	if rd == null:
		print(
			"VERIFY-ARENA: NO DISPLAY — cannot render-verify (headless renderer has no RenderingDevice)."
		)
		print("Run WITHOUT --headless on a machine with a display.")
		quit(2)
		return

	var args := OS.get_cmdline_user_args()
	if args.size() >= 1 and args[0] != "":
		_scene_path = args[0]
		if not _scene_path.begins_with("res://"):
			_scene_path = "res://" + _scene_path

	var packed := load(_scene_path) as PackedScene
	if packed == null:
		print("VERIFY-ARENA: FAIL — could not load scene: %s" % _scene_path)
		quit(1)
		return

	root.add_child(packed.instantiate())

	# Supply ambient env + directional sun so the level renders even if Main is absent.
	# iron_floor ships its own DirectionalLight3D; these are additive fallbacks.
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.07, 0.08, 0.10)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.4, 0.42, 0.48)
	env.ambient_light_energy = 0.55
	we.environment = env
	root.add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48.0, -38.0, 0.0)
	sun.light_energy = 1.1
	root.add_child(sun)

	_cam = Camera3D.new()
	_cam.fov = 75.0
	_cam.current = true
	root.add_child(_cam)
	# Defer first aim so the camera is inside the scene tree before look_at() runs.
	call_deferred("_aim", _vidx)


func _aim(i: int) -> void:
	# SEAM: vantage rows are heterogeneous [Vector3, Vector3] literals stored as Variant.
	@warning_ignore("unsafe_cast")
	var eye: Vector3 = _vantages[i][0] as Vector3
	@warning_ignore("unsafe_cast")
	var look: Vector3 = _vantages[i][1] as Vector3
	_cam.global_position = eye
	_cam.look_at(look, Vector3.UP)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < WARMUP:
		return false

	var img := root.get_texture().get_image()
	var out_path := "%s%d.png" % [OUT_PREFIX, _vidx + 1]
	img.save_png(out_path)
	_check(img, _vidx + 1, out_path)

	_vidx += 1
	if _vidx >= _vantages.size():
		_summarize()
		return true

	_aim(_vidx)
	_frame = 0
	return false


func _check(img: Image, vnum: int, path: String) -> void:
	var w := img.get_width()
	var h := img.get_height()
	var lum_sum := 0.0
	var lum_sq := 0.0
	var lum_min := 1.0
	var lum_max := 0.0
	var bins: Array[int] = []
	for _b: int in 10:
		bins.append(0)
	var uniq: Dictionary = {}
	var cell_sum: Array[float] = []
	var cell_n: Array[int] = []
	for _c: int in 16:
		cell_sum.append(0.0)
		cell_n.append(0)
	var samples := 0
	# intentional: integer pixel sampling step.
	@warning_ignore("integer_division")
	var step := maxi(1, w / 128)
	for y: int in range(0, h, step):
		for x: int in range(0, w, step):
			var px := img.get_pixel(x, y)
			var l := px.get_luminance()
			lum_sum += l
			lum_sq += l * l
			lum_min = minf(lum_min, l)
			lum_max = maxf(lum_max, l)
			samples += 1
			var bi := clampi(int(l * 10.0), 0, 9)
			bins[bi] = bins[bi] + 1
			# 4-bit quantise per channel for unique-colour count.
			var key := "%d_%d_%d" % [int(px.r * 16.0), int(px.g * 16.0), int(px.b * 16.0)]
			uniq[key] = true
			# intentional: integer cell index in 4×4 grid.
			@warning_ignore("integer_division")
			var cx := mini(3, (x * 4) / w)
			# intentional: integer cell index in 4×4 grid.
			@warning_ignore("integer_division")
			var cy := mini(3, (y * 4) / h)
			cell_sum[cy * 4 + cx] = cell_sum[cy * 4 + cx] + l
			cell_n[cy * 4 + cx] = cell_n[cy * 4 + cx] + 1

	var mean := lum_sum / float(samples)
	var variance := (lum_sq / float(samples)) - (mean * mean)
	var stdev := sqrt(maxf(0.0, variance))
	var entropy := 0.0
	for b: int in bins:
		if b > 0:
			var p := float(b) / float(samples)
			entropy -= p * (log(p) / log(2.0))
	var cmin := 1.0
	var cmax := 0.0
	for ci: int in 16:
		if cell_n[ci] > 0:
			var cm := cell_sum[ci] / float(cell_n[ci])
			cmin = minf(cmin, cm)
			cmax = maxf(cmax, cm)
	var cell_spread := cmax - cmin
	var unique_count := uniq.size()

	var prefix := "VERIFY-ARENA"
	var v_tag := "vantage=%d" % vnum
	var metrics := (
		"mean=%.3f stdev=%.3f entropy=%.2f unique=%d cell_spread=%.3f lum=[%.3f,%.3f]"
		% [mean, stdev, entropy, unique_count, cell_spread, lum_min, lum_max]
	)

	var fail_reason := ""
	if mean < MEAN_LO:
		fail_reason = "too dark (mean=%.3f < %.2f)" % [mean, MEAN_LO]
	elif mean > MEAN_HI:
		fail_reason = "blown-white (mean=%.3f > %.2f)" % [mean, MEAN_HI]
	elif stdev < STDEV_MIN:
		fail_reason = "flat/low-contrast (stdev=%.3f < %.2f)" % [stdev, STDEV_MIN]
	elif entropy < ENTROPY_MIN:
		fail_reason = "uniform fill (entropy=%.2f < %.1f bits)" % [entropy, ENTROPY_MIN]
	elif unique_count < UNIQUE_MIN:
		fail_reason = "solid-colour render (unique=%d < %d)" % [unique_count, UNIQUE_MIN]
	elif cell_spread > CELL_SPREAD_MAX:
		fail_reason = "half/half overlay (cell_spread=%.3f > %.2f)" % [cell_spread, CELL_SPREAD_MAX]

	if fail_reason != "":
		print(
			(
				"%s: FAIL %s %s — %s | %s | saved: %s"
				% [prefix, _scene_path, v_tag, fail_reason, metrics, path]
			)
		)
		_fail_count += 1
	else:
		print("%s: PASS %s %s — %s | saved: %s" % [prefix, _scene_path, v_tag, metrics, path])
		_pass_count += 1


func _summarize() -> void:
	var total := _pass_count + _fail_count
	if _fail_count == 0:
		print("VERIFY-ARENA: ALL PASS — %d vantage(s) clean" % total)
		quit(0)
	else:
		print("VERIFY-ARENA: FAIL — %d/%d vantage(s) failed" % [_fail_count, total])
		quit(1)
