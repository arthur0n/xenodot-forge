extends SceneTree
## tools/bench_scene.gd — frames-drawn benchmark harness (skill: twin-optimize methodology,
## gate contract: twin-verify frame-budget step).
##
## fps ground truth = Engine.get_frames_drawn() delta / elapsed. Process-loop fps LIES when
## macOS suspends drawing on an occluded window, so the window is forced always-on-top +
## foreground and vsync is disabled for the run. Windowed only — headless SKIPs (exit 0).
##
## Usage (NO --headless):
##   $GODOT --path . -s tools/bench_scene.gd -- <scene.tscn> \
##       [--vantage X,Y,Z:LX,LY,LZ] [--warmup 2.0] [--measure 8.0] [--out path.json]
##
## Output: one `BENCH: {json row}` line (fps, frame_ms, draw_calls, primitives,
## objects_rendered, process_fps, gpu_ms, cpu_ms) and, with --out, the row
## appended-as-array to the file.
##
## gpu_ms/cpu_ms are the viewport's measured render times
## (RenderingServer.viewport_set_measure_render_time) — macOS clamps frame PRESENTATION
## to the display refresh (120 Hz ProMotion) even with vsync disabled, so fps saturates
## at the cap on fast configs; measured render time keeps differentiating below it.

var scene_path := ""
var vantage := ""
var warmup_s := 2.0
var measure_s := 8.0
var out_path := ""


func _init() -> void:
	if DisplayServer.get_name() == "headless":
		print("BENCH: SKIP — headless renderer (frames-drawn needs a display)")
		quit(0)
		return
	_parse_args()
	_run()


func _parse_args() -> void:
	var args := OS.get_cmdline_user_args()
	var i := 0
	while i < args.size():
		var a: String = args[i]
		match a:
			"--vantage":
				i += 1
				vantage = args[i]
			"--warmup":
				i += 1
				warmup_s = float(args[i])
			"--measure":
				i += 1
				measure_s = float(args[i])
			"--out":
				i += 1
				out_path = args[i]
			_:
				if scene_path == "":
					scene_path = a
		i += 1
	if scene_path == "":
		scene_path = ProjectSettings.get_setting("application/run/main_scene", "")


func _run() -> void:
	# Methodology guards (see twin-optimize): vsync OFF, window visible the whole run.
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP, true)
	DisplayServer.window_move_to_foreground()
	RenderingServer.viewport_set_measure_render_time(root.get_viewport_rid(), true)

	if scene_path == "":
		push_error("BENCH: FAIL — no scene given and no main scene set")
		quit(1)
		return
	var packed: PackedScene = load(scene_path)
	if packed == null:
		push_error("BENCH: FAIL — cannot load %s" % scene_path)
		quit(1)
		return
	var scene := packed.instantiate()
	root.add_child(scene)
	_apply_vantage()

	await _wait_s(warmup_s)
	var row := await _measure_window()
	row["scene"] = scene_path
	row["vantage"] = vantage if vantage != "" else "scene-default"
	print("BENCH: ", JSON.stringify(row))
	if out_path != "":
		_write_row(row)
	quit(0)


## "--vantage X,Y,Z:LX,LY,LZ" — inject a camera at position looking at target.
## Without it, the scene's own current camera is used untouched.
func _apply_vantage() -> void:
	if vantage == "":
		return
	var parts := vantage.split(":")
	if parts.size() != 2:
		push_error("BENCH: FAIL — --vantage wants X,Y,Z:LX,LY,LZ, got '%s'" % vantage)
		quit(1)
		return
	var cam := Camera3D.new()
	cam.far = 12000.0
	root.add_child(cam)
	cam.position = _vec3(parts[0])
	# Node3D.look_at() needs the node "inside tree" and silently no-ops with an error
	# during SceneTree init — Basis.looking_at is pure math and always works.
	cam.basis = Basis.looking_at(_vec3(parts[1]) - cam.position)
	cam.make_current()


func _vec3(csv: String) -> Vector3:
	var n := csv.split(",")
	return Vector3(float(n[0]), float(n[1]), float(n[2]))


func _wait_s(s: float) -> void:
	var t0 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t0 < s * 1000.0:
		await process_frame


func _measure_window() -> Dictionary:
	var frames := 0
	var dc := 0.0
	var prim := 0.0
	var obj := 0.0
	var gpu := 0.0
	var cpu := 0.0
	var vp_rid := root.get_viewport_rid()
	var drawn0 := Engine.get_frames_drawn()
	var t0 := Time.get_ticks_usec()
	while true:
		await process_frame
		frames += 1
		dc += Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
		prim += Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
		obj += Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)
		gpu += RenderingServer.viewport_get_measured_render_time_gpu(vp_rid)
		cpu += RenderingServer.viewport_get_measured_render_time_cpu(vp_rid)
		if Time.get_ticks_usec() - t0 >= measure_s * 1e6:
			break
	var el := (Time.get_ticks_usec() - t0) / 1e6
	var f := float(frames)
	var drawn := float(Engine.get_frames_drawn() - drawn0)  # frames actually rendered
	if drawn <= 0.0:
		push_error("BENCH: FAIL — 0 frames drawn (window occluded? drawing suspended)")
		quit(1)
	return {
		"fps": snappedf(drawn / el, 0.1),
		"process_fps": snappedf(f / el, 0.1),
		"frame_ms": snappedf(el * 1000.0 / maxf(drawn, 1.0), 0.01),
		"gpu_ms": snappedf(gpu / f, 0.01),
		"cpu_ms": snappedf(cpu / f, 0.01),
		"draw_calls": int(dc / f),
		"primitives": int(prim / f),
		"objects_rendered": int(obj / f),
		"warmup_s": warmup_s,
		"measure_s": measure_s,
	}


## Append the row to a JSON array file (created if absent) so before/after runs accumulate.
func _write_row(row: Dictionary) -> void:
	var rows: Array = []
	if FileAccess.file_exists(out_path):
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(out_path))
		if parsed is Array:
			rows = parsed
	rows.append(row)
	var abs_path := ProjectSettings.globalize_path(out_path)
	DirAccess.make_dir_recursive_absolute(abs_path.get_base_dir())
	var fa := FileAccess.open(out_path, FileAccess.WRITE)
	if fa == null:
		push_error("BENCH: cannot write %s" % out_path)
		return
	fa.store_string(JSON.stringify(rows, "  "))
	fa.close()
	print("BENCH: wrote ", out_path)
