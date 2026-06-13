---
name: godot-camera-rig
description: Create the camera rig for a Godot 4.x 3D pixel-art game — an orthographic Camera3D at a fixed angle on a pivot that smoothly follows a target. Use this skill whenever the user needs a camera for the pixel-art project, says the game looks distorted or "too 3D", asks for an isometric or fixed-angle view, wants the camera to follow the player, or is setting up a POC scene. Also use it if someone proposes a perspective camera in this project, to explain why orthographic is required.
---

# Godot Camera Rig (orthographic, fixed angle)

A pivot-based rig: `CameraRig (Node3D)` rotates to the fixed view angle; the `Camera3D` child sits back along the pivot's axis and renders **orthographically**.

Why orthographic is a hard requirement, not taste: with a perspective camera, world texels change size across the screen and per frame, so pixels shimmer ("pixel crawl") and the later texel-snapping fix is mathematically impossible. Orthographic keeps texel density constant, which is what makes 3D read as pixel art.

## Requirements

- `godot-project-conventions` applied (read `CLAUDE.md` first).
- If `godot-3d-pixelation` is set up, the entire rig goes **inside the SubViewport** (it contains the camera). If skills run out of order, build the rig at the world root and note in CLAUDE.md that it must move into the SubViewport later.

## Project conventions

- Scene: `res://entities/camera_rig/camera_rig.tscn`, root `CameraRig` (Node3D) with child `Camera3D`.
- Script: `res://entities/camera_rig/camera_rig.gd` attached to the root.
- Default angle: pitch **−30°**, yaw **45°** (classic 3/4 "isometric-style" view). 2:1 true isometric would be pitch ≈ −26.57° (`atan(0.5)`); offer it only if the user asks for strict isometric.

## Steps

1. Create the scene: `CameraRig` (Node3D) → child `Camera3D`.
2. On `CameraRig`: Rotation Degrees = `(-30, 45, 0)`.
3. On `Camera3D`: Position = `(0, 0, 20)` (pulled back along the pivot's local Z — distance is irrelevant to framing in orthographic, it only avoids near-plane clipping); **Projection = Orthogonal**; **Size = 10** (this is the zoom knob: world units visible vertically); Far = `100`.
4. Attach `camera_rig.gd`:

```gdscript
class_name CameraRig
extends Node3D

@export var target: Node3D
@export var follow_speed: float = 8.0

func _physics_process(delta: float) -> void:
	if target == null:
		return
	# Frame-rate independent exponential smoothing of the pivot position.
	global_position = global_position.lerp(
		target.global_position, 1.0 - exp(-follow_speed * delta))
```

5. Instance `camera_rig.tscn` in the main scene (inside the SubViewport if present) and assign `target` in the inspector once a player exists. With no target it is a static camera — valid for the first POC step.

## Verification checklist

- [ ] Camera3D inspector shows Projection = Orthogonal; parallel level edges stay parallel on screen (no vanishing point).
- [ ] Changing **Size** zooms; moving the Camera3D along Z does **not** change framing (proves orthographic).
- [ ] With a target assigned, moving the target makes the view glide after it without rotation drift.
- [ ] Pivot rotation lives on `CameraRig`, Camera3D's own rotation stays `(0,0,0)`.

## Error → Fix

| Symptom                                             | Fix                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scene has perspective distortion                    | Projection left at Perspective; set Orthogonal — and do not "compromise" with a narrow FOV perspective, it breaks texel snapping later                                                                                                                                                        |
| Nearby geometry gets sliced/invisible               | Camera too close with default near plane → increase Camera3D Z position (e.g. 20–50); cost-free in orthographic                                                                                                                                                                               |
| Everything black/empty                              | Rig outside the SubViewport while another active camera exists inside it; exactly one current Camera3D per viewport                                                                                                                                                                           |
| Follow feels frame-rate dependent / jittery         | Smoothing must use the `1.0 - exp(-speed * delta)` form, not a constant lerp weight; jitter against a CharacterBody3D target means follow belongs in `_physics_process` (as written)                                                                                                          |
| User wants camera rotation (Q/E to turn)            | Rotate `CameraRig` yaw in 45°/90° steps via tween; free rotation reintroduces shimmer. See normalization gotcha row below                                                                                                                                                                     |
| Yaw rotation tweens over-rotate after a few presses | `_target_yaw` accumulates unbounded while Godot normalizes `rotation_degrees.y` to [-180, 180] after each tween — they diverge. Fix: (1) if killing a running tween, snap `rotation_degrees.y = _target_yaw` first; (2) always wrap: `_target_yaw = wrapf(_target_yaw + step, -180.0, 180.0)` |
