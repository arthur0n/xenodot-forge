# tools/capture_screenshot.gd — captures a PNG of the SubViewport render for visual
# inspection.
extends SceneTree
## Boots a scene (default: main.tscn), warms up ~20 frames so the render settles,
## then captures the raw 640x360 SubViewport texture and saves it as a PNG.
##
## WHY SubViewport, not root.get_texture():
##   When the game uses the SubViewport rig, all 3D content renders inside
##   Main/SubViewportContainer/SubViewport (the SubViewport downscale rig). root.get_texture()
##   returns the upscaled window compositor output — not the raw SubViewport render. This script
##   captures the source.
##
## IMPORTANT — do NOT run with --headless:
##   Godot 4 headless mode sets the renderer to Dummy; get_image() returns a blank image.
##   This is the same reason verify_render.gd does not use --headless.
##   A small window flashes briefly and closes on quit. A display is required.
##   On a headless CI server, use Xvfb (Linux) or report "no display" and skip.
##
## Invocation:
##   $GODOT --path . --resolution 640x360 -s tools/capture_screenshot.gd
##       [-- <scene_path> [output_path [cam_pos [diag_look_at [diag_ortho_size]]]]]
##
## Arguments (optional, pass after --):
##   <scene_path>       res://-relative path to an entry-point scene containing Main
##                      (default: project run/main_scene, i.e. res://main.tscn)
##   <output_path>      destination for the PNG (default: res://.godot/screenshot_last.png)
##   <cam_pos>          world-space X,Y,Z to teleport the CameraRig to before capture
##                      (e.g. "30.75,0,5.25"). Nulls the rig's target so it stops following
##                      the player. Omit or pass "" to use the scene's default camera position.
##                      The rig keeps its scene rotation (isometric 45°/30° dip) so the
##                      pixel-art look is preserved.
##   <diag_look_at>     DIAGNOSTIC MODE: world-space X,Y,Z for the camera to look at
##                      (e.g. "30.0,0.5,5.0"). When provided, a temporary orthographic
##                      Camera3D is injected into the SubViewport and set as current for
##                      capture only — the game CameraRig is disabled. <cam_pos> becomes
##                      the camera's world position (required when using diag_look_at).
##                      Use a high Y position (e.g. "30.0,15.0,5.0") to look down into a
##                      room and see past walls. The camera is removed after capture.
##   <diag_ortho_size>  Orthographic size in world units for the diagnostic camera
##                      (default: 8.0). Larger = wider view, smaller = tighter crop.
##
## Diagnostic mode examples:
##   # Top-down view of master bedroom furniture (cam above, looking down at furniture group):
##   $GODOT --path . --resolution 640x360 -s tools/capture_screenshot.gd \
##       -- main.tscn .godot/screenshot_bedroom.png \
##       "30.0,20.0,5.0" "30.0,0.0,5.0" "10.0"
##
##   # Steep isometric-ish angle (cam high and offset, looking at furniture):
##   $GODOT --path . --resolution 640x360 -s tools/capture_screenshot.gd \
##       -- main.tscn .godot/screenshot_bedroom.png \
##       "24.0,12.0,12.0" "30.0,1.0,5.0" "12.0"
##
## Output:
##   SCREENSHOT: OK — <scene> → <output_path>    (exit 0)
##   SCREENSHOT: FAIL — <reason>                  (exit 1)
##
## The produced PNG is 640x360 (the SubViewport resolution). Read it with the Read
## tool (Claude Code supports image reading) to visually judge placement, scale, etc.

const WARMUP_FRAMES := 20
const SUBVIEWPORT_PATH := "SubViewportContainer/SubViewport"

var _frames := 0
var _scene_path := ""
var _output_path := ""

# Parsed diagnostic-mode parameters
var _diag_cam_pos := Vector3.ZERO
var _diag_look_at := Vector3.ZERO
var _diag_ortho_size := 8.0
var _diag_mode := false

# Injected diagnostic camera (removed after capture)
var _diag_camera: Camera3D = null


func _initialize() -> void:
	var user_args := OS.get_cmdline_user_args()

	# Scene path — first user arg or project main_scene
	if user_args.size() > 0:
		_scene_path = user_args[0]
		if not _scene_path.begins_with("res://"):
			_scene_path = "res://" + _scene_path
	else:
		_scene_path = ProjectSettings.get_setting("application/run/main_scene", "")

	# Output path — second user arg or default
	if user_args.size() > 1:
		_output_path = user_args[1]
		if not _output_path.begins_with("res://") and not _output_path.begins_with("/"):
			_output_path = "res://" + _output_path
	else:
		_output_path = "res://.godot/screenshot_last.png"

	# cam_pos — third user arg (also serves as diag camera position)
	var cam_pos_str := ""
	if user_args.size() > 2:
		cam_pos_str = user_args[2]

	# diag_look_at — fourth user arg; presence activates diagnostic mode
	if user_args.size() > 3 and user_args[3] != "":
		var look_at_str := user_args[3]
		var look_at_parts := look_at_str.split(",")
		if look_at_parts.size() == 3:
			_diag_look_at = Vector3(
				float(look_at_parts[0]), float(look_at_parts[1]), float(look_at_parts[2])
			)
			_diag_mode = true
		else:
			_fail("diag_look_at must be X,Y,Z — got: " + look_at_str)
			return

	# diag_ortho_size — fifth user arg
	if user_args.size() > 4 and user_args[4] != "":
		_diag_ortho_size = float(user_args[4])

	if _scene_path == "":
		_fail("no scene argument and no run/main_scene set in project.godot")
		return

	var packed := load(_scene_path) as PackedScene
	if packed == null:
		_fail("could not load scene: " + _scene_path)
		return

	var scene_instance: Node = packed.instantiate()
	root.add_child(scene_instance)

	# Apply cam_pos / diag camera position (stored for _process after warmup)
	if cam_pos_str != "":
		var parts := cam_pos_str.split(",")
		if parts.size() == 3:
			_diag_cam_pos = Vector3(float(parts[0]), float(parts[1]), float(parts[2]))
		else:
			_fail("cam_pos must be X,Y,Z — got: " + cam_pos_str)
			return

		if _diag_mode:
			# Diagnostic mode: defer camera injection to _process (after warmup) so the
			# SubViewport tree is fully ready and the CameraRig exists to be disabled.
			pass
		else:
			# Standard cam_pos mode: teleport the existing CameraRig.
			_apply_standard_cam_pos(scene_instance, _diag_cam_pos)


func _apply_standard_cam_pos(scene_instance: Node, pos: Vector3) -> void:
	# Walk into SubViewport to find the CameraRig, then teleport it.
	var sv := scene_instance.get_node_or_null(SUBVIEWPORT_PATH) as SubViewport
	if sv == null:
		push_warning("cam_pos set but SubViewport not found — position not applied")
		return
	# CameraRig is a direct child of the SubViewport's scene (LevelHost sibling)
	var rig: Node3D = sv.get_node_or_null("CameraRig") as Node3D
	if rig == null:
		push_warning("CameraRig not found inside SubViewport — position not applied")
		return
	# Null target so the rig stops following the player, then move it.
	if rig.has_method("set") and rig.get("target") != null:
		rig.set("target", null)
	rig.global_position = pos


func _inject_diag_camera(sv: SubViewport) -> void:
	# Disable the game CameraRig so it does not reclaim "current" status.
	var rig: Node3D = sv.get_node_or_null("CameraRig") as Node3D
	if rig != null:
		rig.process_mode = Node.PROCESS_MODE_DISABLED
		# Disable the Camera3D child so it relinquishes current-camera status.
		var rig_cam: Camera3D = rig.get_node_or_null("Camera3D") as Camera3D
		if rig_cam != null:
			rig_cam.current = false

	# Create a temporary orthographic Camera3D at the diagnostic position.
	_diag_camera = Camera3D.new()
	_diag_camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	_diag_camera.size = _diag_ortho_size
	_diag_camera.near = 0.1
	_diag_camera.far = 200.0
	sv.add_child(_diag_camera)
	_diag_camera.global_position = _diag_cam_pos
	# When the camera is nearly above the target (Y axis is roughly parallel to the
	# eye-to-target direction), Vector3.UP becomes colinear with the view direction.
	# Use Vector3.BACK as the up hint in that case so look_at() does not degenerate.
	var eye_dir := (_diag_look_at - _diag_cam_pos).normalized()
	var up_hint := Vector3.UP if abs(eye_dir.dot(Vector3.UP)) < 0.9 else Vector3.BACK
	_diag_camera.look_at(_diag_look_at, up_hint)
	_diag_camera.current = true


func _process(_delta: float) -> bool:
	_frames += 1

	# Inject diagnostic camera on frame 2 (tree ready but before warmup ends) so it has
	# enough frames to render from the new vantage during warmup.
	if _diag_mode and _frames == 2:
		_try_inject_diag_camera()

	if _frames < WARMUP_FRAMES:
		return false

	_capture_and_quit()
	return true


func _try_inject_diag_camera() -> void:
	var sv := _find_subviewport()
	if sv == null:
		return
	_inject_diag_camera(sv)


func _capture_and_quit() -> void:
	var sv := _find_subviewport()
	if sv == null:
		return

	# Wait for the GPU to finish drawing the current frame before sampling.
	await RenderingServer.frame_post_draw

	var img := sv.get_texture().get_image()
	if img == null:
		_fail("SubViewport.get_texture().get_image() returned null — renderer may not be ready")
		return

	# Clean up the diagnostic camera before quitting (does not modify the saved scene).
	if _diag_camera != null:
		_diag_camera.queue_free()
		_diag_camera = null

	var err := img.save_png(_output_path)
	if err != OK:
		_fail("save_png failed (error %d) writing to: %s" % [err, _output_path])
		return

	print("SCREENSHOT: OK — %s → %s" % [_scene_path, _output_path])
	quit(0)


func _find_subviewport() -> SubViewport:
	if root.get_child_count() == 0:
		_fail("scene root has no children after loading " + _scene_path)
		return null
	var scene_root: Node = root.get_child(0)
	var sv := scene_root.get_node_or_null(SUBVIEWPORT_PATH) as SubViewport
	if sv == null:
		_fail(
			(
				"SubViewport not found at '%s/%s' — confirm the pixelation rig is present"
				% [scene_root.name, SUBVIEWPORT_PATH]
			)
		)
	return sv


func _fail(reason: String) -> void:
	print("SCREENSHOT: FAIL — " + reason)
	quit(1)
