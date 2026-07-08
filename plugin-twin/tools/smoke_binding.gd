extends SceneTree
## tools/smoke_binding.gd — the data-binding smoke gate (skill: twin-verify, step 3).
##
## Proves the LIVE path end-to-end, headless: seeded sim → DataBus → binding_map → visible
## state. It drives the REAL viewer shell (main.tscn) — DataBus autoload + main.gd's BindingMap
## wiring — rather than reimplementing it; when pointed at a bare geometry scene (an optimized
## .tscn) with no shell, it builds a BindingMap from --map and drives that instead.
##
## Usage (bounded, deterministic, ~8 s max):
##   $GODOT --headless --path . --script tools/smoke_binding.gd -- \
##       [--map=binding_map.json] [--url=ws://localhost:8899] \
##       [--scene=main|<optimized.tscn>] [--frames=N | --seconds=S]
##   $GODOT --headless --path . --script tools/smoke_binding.gd -- \
##       --mode=hints --scene=<optimized.tscn> --hints=<hints.json>
##
## Asserts (each printed, then a final verdict line, exit 0/1):
##   a. DataBus connected (connection_changed up in time), frames_received > 0, drops == 0.
##   b. Binding map resolved: resolved_count == total_count and total_count >= 1.
##   c. >= 1 NODE-target binding visibly driven: material_override.albedo_color is non-white
##      AND changes between two samples ~1 s apart (proves LIVE driving, not a one-shot).
##   d. MMI targets: the headless dummy renderer returns BLACK for instance colour — both
##      get_instance_color and the mm.buffer colour floats never reflect set_instance_color — so
##      colour equality is NOT assertable headlessly. Instead assert the write path is WIRED
##      (use_colors true, index in range) and print `MMI-SMOKE: WINDOWED-ONLY` — a documented
##      partial, never a failure.
##
## Verdict:  BIND-SMOKE: OK  (exit 0)  /  BIND-SMOKE: FAIL — <reason>  (exit 1)
## Hints mode verdict:  HINTS-SMOKE: OK|FAIL  (exit 0/1).

const BindingMapScript := preload("res://core/binding_map.gd")
const DataBusScript := preload("res://core/data_bus.gd")

## How long to wait for the bus to come up before giving up (ms). Generous: the seeded sim starts
## in well under a second, but a cold headless engine + connect handshake can take a few.
const CONNECT_TIMEOUT_MS := 6000

## Frames that must arrive before the connection counts as "up" — proves the stream flows, not just
## that the socket opened. A handful is enough at STREAM_HZ without stretching the bounded run.
const CONNECT_MIN_FRAMES := 3

## Default sampling gap for the node-drive assertion (ms). ~1.5 s spans several STREAM_HZ frames, so
## two albedo samples reliably differ if the viewer is live. Overridden by --seconds / --frames.
const DEFAULT_GAP_MS := 1500

## Sim publish rate in Hz. MUST equal sim/server.js DEFAULT_HZ (10): the gate launches that sim, and
## --frames=N is converted to seconds as N/STREAM_HZ — any drift makes the frame->time math wrong.
## (Cross-ref: plugin-twin/tools/sim/server.js DEFAULT_HZ, verify_twin.sh's --hz.)
const STREAM_HZ := 10

## RGBA white — the un-driven instance/albedo colour the optimizer initializes to; a driven node
## target must move OFF this to prove it is painting.
const WHITE := Color(1, 1, 1, 1)

## Milliseconds per second — --seconds / --frames convert to the ms gap the assertions wait.
const MSEC_PER_SEC := 1000.0

var map_path := "binding_map.json"
var url := ""
var scene_arg := ""
var mode := "bind"
var hints_path := ""
var gap_ms := DEFAULT_GAP_MS


func _init() -> void:
	_run()


func _run() -> void:
	_parse_args()
	await process_frame
	if mode == "hints":
		await _run_hints()
	else:
		await _run_bind()


func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--map="):
			map_path = a.substr("--map=".length())
		elif a.begins_with("--url="):
			url = a.substr("--url=".length())
		elif a.begins_with("--scene="):
			scene_arg = a.substr("--scene=".length())
		elif a.begins_with("--mode="):
			mode = a.substr("--mode=".length())
		elif a.begins_with("--hints="):
			hints_path = a.substr("--hints=".length())
		elif a.begins_with("--seconds="):
			gap_ms = int(a.substr("--seconds=".length()).to_float() * MSEC_PER_SEC)
		elif a.begins_with("--frames="):
			gap_ms = int(
				a.substr("--frames=".length()).to_float() / float(STREAM_HZ) * MSEC_PER_SEC
			)


# --- bind mode ---------------------------------------------------------------------------------


func _run_bind() -> void:
	var scene := _instantiate_scene()
	if scene == null:
		return
	await process_frame
	await process_frame
	var bus := root.get_node_or_null("DataBus") as DataBusScript
	var binder := _resolve_binder(scene) if bus != null else null
	if bus == null or binder == null:
		_fail_setup(bus)
		return
	if url != "":
		bus.reconnect(url)  # public seam: redirect to the smoke's sim on a fresh peer immediately
	await _await_connected(bus)

	if not _assert_stream(bus):  # a. connection + clean stream
		return
	if not _assert_resolution(binder):  # b. every binding resolved
		return
	var counts := binder.target_counts()
	var node_count: int = counts["node"]
	var mmi_count: int = counts["mmi"]
	if node_count == 0 and mmi_count == 0:
		_fail("no node or mmi targets resolved — nothing live to drive")
		return

	# c. node targets visibly driven; d. mmi targets wired (colour readback is windowed-only).
	var ok := true
	if ok and node_count > 0:
		ok = await _assert_node_drive(binder, node_count)
	if ok and mmi_count > 0:
		ok = _assert_mmi_wired(counts)
	if ok:
		print(
			(
				"BIND-SMOKE: OK — %d node target(s), %d mmi target(s), %d frames, %d drops"
				% [node_count, mmi_count, bus.frames_received, bus.drops]
			)
		)
		quit(0)


func _fail_setup(bus: DataBusScript) -> void:
	if bus == null:
		_fail("no DataBus autoload at /root/DataBus — not a twin viewer shell (see starter-viewer)")
	else:
		_fail("no BindingMap — shell built none and --map=%s yielded 0 bindings" % map_path)


func _assert_stream(bus: DataBusScript) -> bool:
	print(
		(
			"BIND-SMOKE connection: up=%s frames_received=%d drops=%d"
			% [bus.is_up(), bus.frames_received, bus.drops]
		)
	)
	if not bus.is_up() or bus.frames_received <= 0:
		_fail(
			(
				"DataBus down or silent (up=%s frames=%d) — is the sim running at %s?"
				% [bus.is_up(), bus.frames_received, url if url != "" else bus.url]
			)
		)
		return false
	if bus.drops != 0:
		_fail("drops=%d — the seeded stream is deterministic; a drop is a bus bug" % bus.drops)
		return false
	return true


func _assert_resolution(binder: BindingMapScript) -> bool:
	print("BIND-SMOKE resolution: %d/%d resolved" % [binder.resolved_count, binder.total_count])
	if binder.total_count < 1 or binder.resolved_count != binder.total_count:
		_fail(
			(
				"bindings resolved %d/%d (need total>=1, all resolved — a miss is a stale map)"
				% [binder.resolved_count, binder.total_count]
			)
		)
		return false
	return true


func _assert_node_drive(binder: BindingMapScript, node_count: int) -> bool:
	var t0 := binder.driven_node_albedos()
	await _await_msec(gap_ms)
	var t1 := binder.driven_node_albedos()
	var non_white := 0
	var moved := 0
	for i in mini(t0.size(), t1.size()):
		if not t1[i].is_equal_approx(WHITE):
			non_white += 1
		if not t0[i].is_equal_approx(t1[i]):
			moved += 1
	print(
		(
			"BIND-SMOKE node-drive: targets=%d driven=%d non_white=%d moved=%d"
			% [node_count, t1.size(), non_white, moved]
		)
	)
	if non_white < 1 or moved < 1:
		_fail(
			(
				"no node target both non-white and changing (non_white=%d moved=%d) — viewer paints nothing"
				% [non_white, moved]
			)
		)
		return false
	return true


func _assert_mmi_wired(counts: Dictionary) -> bool:
	var mmi_count: int = counts["mmi"]
	var wired: int = counts["wired_mmi"]  # binding_map counts these via its public read surface
	print(
		(
			(
				"MMI-SMOKE: WINDOWED-ONLY — %d/%d mmi target(s) wired (use_colors + index in range);"
				% [wired, mmi_count]
			)
			+ " instance-colour readback needs a window (headless dummy renderer returns black)"
		)
	)
	if wired != mmi_count:
		_fail(
			(
				"mmi target not drivable (use_colors=false or index out of range): %d/%d wired"
				% [wired, mmi_count]
			)
		)
		return false
	return true


# Instantiate the scene to drive (main.tscn by default, else the given .tscn). Adds it to root.
func _instantiate_scene() -> Node:
	var scene_res := _res_path(
		scene_arg if scene_arg != "" and scene_arg != "main" else "main.tscn"
	)
	var packed := load(scene_res) as PackedScene
	if packed == null:
		_fail("cannot load scene '%s' — expected res://main.tscn or an optimized .tscn" % scene_res)
		return null
	var scene := packed.instantiate()
	root.add_child(scene)
	return scene


# Prefer the shell's binder (main.gd names it "BindingMap"); else build one from --map.
func _resolve_binder(scene: Node) -> BindingMapScript:
	var found := scene.find_child("BindingMap", true, false)
	var shell_binder := found as BindingMapScript
	if shell_binder != null:
		return shell_binder
	var binder := BindingMapScript.new()
	binder.name = "SmokeBindingMap"
	root.add_child(binder)  # _ready connects it to the DataBus before frames arrive
	if binder.load_map(_res_path(map_path)) == 0:
		return null
	binder.build_index(scene)
	return binder


func _await_connected(bus: DataBusScript) -> void:
	var start := Time.get_ticks_msec()
	while Time.get_ticks_msec() - start < CONNECT_TIMEOUT_MS:
		if bus.is_up() and bus.frames_received >= CONNECT_MIN_FRAMES:
			return
		await process_frame


func _await_msec(msec: int) -> void:
	var start := Time.get_ticks_msec()
	while Time.get_ticks_msec() - start < msec:
		await process_frame


# --- hints mode --------------------------------------------------------------------------------


func _run_hints() -> void:
	if scene_arg == "" or hints_path == "":
		print("HINTS-SMOKE: FAIL — --scene=<optimized.tscn> and --hints=<hints.json> required")
		quit(1)
		return
	var packed := load(_res_path(scene_arg)) as PackedScene
	if packed == null:
		print("HINTS-SMOKE: FAIL — cannot load scene ", scene_arg)
		quit(1)
		return
	root.add_child(packed.instantiate())
	await process_frame
	var used := _hint_used_groups()
	if used.is_empty():
		print("HINTS-SMOKE: OK — hints declare no group-materialising keys (no_instance/occluder)")
		quit(0)
		return
	var missing: Array[String] = []
	for grp: String in used:
		if get_nodes_in_group(grp).is_empty():
			missing.append(grp)
	if missing.is_empty():
		print("HINTS-SMOKE: OK — optimized scene carries hinted groups: ", used)
		quit(0)
	else:
		print("HINTS-SMOKE: FAIL — optimized scene missing hinted groups: ", missing, " of ", used)
		quit(1)


# Group names the hints file's used keys materialise (no_instance -> twin_no_instance, etc.).
func _hint_used_groups() -> Array[String]:
	var txt := FileAccess.get_file_as_string(_globalized(hints_path))
	var parsed: Variant = JSON.parse_string(txt) if txt != "" else null
	var groups := {}
	if parsed is Dictionary:
		var doc: Dictionary = parsed
		var inner: Variant = doc.get("hints", {})
		if inner is Dictionary:
			var hd: Dictionary = inner
			for k: String in hd.keys():
				var h: Variant = hd[k]
				if h is Dictionary:
					var hrow: Dictionary = h
					if hrow.get("no_instance", false) == true:
						groups["twin_no_instance"] = true
					if hrow.get("occluder", false) == true:
						groups["twin_occluder"] = true
	var out: Array[String] = []
	for g: String in groups.keys():
		out.append(g)
	out.sort()
	return out


# --- shared helpers ----------------------------------------------------------------------------


func _res_path(p: String) -> String:
	if p.begins_with("res://") or p.begins_with("user://"):
		return p
	if p.is_absolute_path():
		return p
	return "res://" + p


func _globalized(p: String) -> String:
	if p.begins_with("res://") or p.begins_with("user://"):
		return ProjectSettings.globalize_path(p)
	if p.is_absolute_path():
		return p
	return ProjectSettings.globalize_path("res://" + p)


func _fail(reason: String) -> void:
	print("BIND-SMOKE: FAIL — ", reason)
	quit(1)
