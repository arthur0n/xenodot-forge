# main.gd — twin-viewer shell. Boots to a lit, empty 3D space with a placeholder
# grid; when a model path is supplied it loads the GLB at RUNTIME instead
# (GLTFDocument reads it in place — models are never imported into the project).
# Model path sources, in order: `--model=<path.glb>` user arg (after `--` on the
# command line), then viewer.cfg `[viewer] model=...`. Twin content (models,
# sidecars, bindings) arrives later via twin-import; this shell stays neutral.
#
# Playback: `--recording=<path.ndjson>` user arg or viewer.cfg `[twin] recording=...`
# loads a twin-recording, switches the DataBus to playback mode and shows the timeline
# bar (_start_playback). With no recording configured the viewer is identical to before.
extends Node3D

const CameraRigScript := preload("res://core/camera_rig.gd")
const BindingMapScript := preload("res://core/binding_map.gd")
const OverlayScript := preload("res://overlay/overlay.gd")
const PlaybackScript := preload("res://core/playback.gd")
const TimelineScript := preload("res://overlay/timeline.gd")
const TimelineScene := preload("res://overlay/timeline.tscn")

const CONFIG_PATH := "res://viewer.cfg"
const DEFAULT_BINDING_MAP := "binding_map.json"
const GRID_HALF_EXTENT := 10
const GRID_COLOR := Color(0.3, 0.34, 0.42)
const AXIS_X_COLOR := Color(0.85, 0.35, 0.35)
const AXIS_Z_COLOR := Color(0.35, 0.55, 0.9)
const SCREENSHOT_SETTLE_FRAMES := 12

@onready var _model_host: Node3D = %ModelHost
@onready var _camera_rig: CameraRigScript = %CameraRig
@onready var _overlay: OverlayScript = $Overlay


func _ready() -> void:
	var model_path := _user_arg("model")
	var recording_path := _user_arg("recording")
	var binding_map_path := DEFAULT_BINDING_MAP
	if FileAccess.file_exists(CONFIG_PATH):
		var cfg := ConfigFile.new()
		if cfg.load(CONFIG_PATH) == OK:
			if model_path == "":
				model_path = str(cfg.get_value("viewer", "model", ""))
			if recording_path == "":
				recording_path = str(cfg.get_value("twin", "recording", ""))
			binding_map_path = str(cfg.get_value("twin", "binding_map", DEFAULT_BINDING_MAP))

	if model_path == "":
		_build_placeholder_grid()
	elif _load_model(model_path):
		_frame_model()

	_load_bindings(binding_map_path)

	if recording_path != "":
		_start_playback(recording_path)

	var shot_path := _user_arg("screenshot")
	if shot_path != "":
		await _capture_screenshot(shot_path)


## Load the binding map (if configured) and resolve it against the loaded model, then push the
## "bindings resolved N/M" HUD line. The map path may be res://-relative or a bare project file.
func _load_bindings(path: String) -> void:
	var res_path := _rooted_path(path)
	if not FileAccess.file_exists(res_path):
		return  # no map for this deployment — stay a neutral viewer
	var binder := BindingMapScript.new()
	binder.name = "BindingMap"
	add_child(binder)
	binder.load_map(res_path)
	binder.build_index(_model_host)
	print("viewer: bindings resolved %d/%d" % [binder.resolved_count, binder.total_count])
	_overlay.set_bindings(binder.resolved_count, binder.total_count)


## Wire the recording player + timeline bar and start playing (a viewer pointed at a
## recording should be playing it — pause is one Space away). Playback reaches every
## consumer through the DataBus inject seam, so bindings/overlay behave exactly as with
## live data. A failed load (already push_warning'd by the parser) tears the pair down
## and leaves the viewer fully live.
func _start_playback(path: String) -> void:
	var player: PlaybackScript = PlaybackScript.new()
	player.name = "Playback"
	add_child(player)
	var timeline := TimelineScene.instantiate() as TimelineScript
	_overlay.add_child(timeline)
	timeline.bind_playback(player)  # before load — playback_loaded must not be missed
	if not player.load_recording(_rooted_path(path)):
		timeline.queue_free()
		player.queue_free()
		return
	player.play()
	print("viewer: playback of %s (%d ms)" % [path, player.duration_ms()])


## Root a bare project-relative file under res://; absolute and res://-/user://-style
## paths pass through. Shared by the binding-map and recording config paths.
func _rooted_path(path: String) -> String:
	var rooted := (
		path.begins_with("res://") or path.begins_with("user://") or path.is_absolute_path()
	)
	return path if rooted else "res://" + path


## Value of `--<key>=<value>` among the user args (everything after `--`), or "".
func _user_arg(key: String) -> String:
	var prefix := "--%s=" % key
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with(prefix):
			return arg.substr(prefix.length())
	return ""


func _load_model(path: String) -> bool:
	var fs_path := path
	if path.begins_with("res://") or path.begins_with("user://"):
		fs_path = ProjectSettings.globalize_path(path)
	var gltf := GLTFDocument.new()
	var state := GLTFState.new()
	var err := gltf.append_from_file(fs_path, state)
	if err != OK:
		push_error("viewer: failed to load model '%s' (error %d)" % [path, err])
		return false
	_model_host.add_child(gltf.generate_scene(state))
	print("viewer: model loaded from %s" % path)
	return true


## Merge the AABBs of every loaded mesh and point the camera at the result.
func _frame_model() -> void:
	var merged := AABB()
	var first := true
	for node: Node in _model_host.find_children("*", "MeshInstance3D", true, false):
		var mesh_instance := node as MeshInstance3D
		var bounds := mesh_instance.global_transform * mesh_instance.get_aabb()
		merged = bounds if first else merged.merge(bounds)
		first = false
	if not first:
		_camera_rig.frame(merged)


## No model yet: draw a ground grid with colored X/Z axes so the empty shell
## still renders something and a screenshot proves the pipeline works.
func _build_placeholder_grid() -> void:
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	for i in range(-GRID_HALF_EXTENT, GRID_HALF_EXTENT + 1):
		var along_z := AXIS_Z_COLOR if i == 0 else GRID_COLOR
		mesh.surface_set_color(along_z)
		mesh.surface_add_vertex(Vector3(i, 0.0, -GRID_HALF_EXTENT))
		mesh.surface_set_color(along_z)
		mesh.surface_add_vertex(Vector3(i, 0.0, GRID_HALF_EXTENT))
		var along_x := AXIS_X_COLOR if i == 0 else GRID_COLOR
		mesh.surface_set_color(along_x)
		mesh.surface_add_vertex(Vector3(-GRID_HALF_EXTENT, 0.0, i))
		mesh.surface_set_color(along_x)
		mesh.surface_add_vertex(Vector3(GRID_HALF_EXTENT, 0.0, i))
	mesh.surface_end()

	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true

	var grid := MeshInstance3D.new()
	grid.name = "PlaceholderGrid"
	grid.mesh = mesh
	grid.material_override = material
	_model_host.add_child(grid)


## `--screenshot=<abs path.png>`: let the frame settle, save the viewport, quit.
## Needs a windowed run — the headless renderer produces a black image.
func _capture_screenshot(path: String) -> void:
	for _i: int in SCREENSHOT_SETTLE_FRAMES:
		await get_tree().process_frame
	var image := get_viewport().get_texture().get_image()
	image.save_png(path)
	print("viewer: screenshot saved to %s (%dx%d)" % [path, image.get_width(), image.get_height()])
	get_tree().quit()
