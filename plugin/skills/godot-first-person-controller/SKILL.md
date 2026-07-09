---
name: godot-first-person-controller
agents: [godot-player]
domain: genre-fps
description: First-person CharacterBody3D player in Godot 4.6 — yaw the body / pitch a child Head holding a perspective eye-camera, raw mouse-look, camera-relative WASD, gravity from ProjectSettings, jump on is_on_floor, plus flat sprint (hold-to-run speed multiplier), crouch (hold-to-lower eye height + collider), and a procedural sprint view-model "running feel" (the held weapon lowers + swings side-to-side while sprinting). Use when building an FPS player entity, when a first-person genre needs its controller, when the view must look out through the player's eyes, when mouse-look pitch/yaw or camera-relative movement misbehaves, when adding sprint/run or crouch/duck to the player ("hold to sprint", "run speed", "crouch", "duck under", "lower stance"), or when the view-model / held weapon should react to sprinting ("sprint view-model", "running feel", "weapon swing while running", "lower the gun when sprinting", "arm-swing sway"). NOT for top-down / isometric — that uses the orthographic follow rig (godot-orthographic-follow-camera). This is the FPS sibling of that skill; pick one per genre.
---

# Godot First-Person Controller (perspective eye-camera)

A `CharacterBody3D` is the player body; a child `Head (Node3D)` holds the `Camera3D`. Mouse X yaws the **body**, mouse Y pitches the **head** (clamped to ±90° so you can't somersault the view), and movement is taken relative to the body's facing. Splitting yaw onto the body and pitch onto the head is what keeps walking direction tied to where you look horizontally while letting you look up/down freely.

This is a **perspective** camera, and that is correct here: the 3D-pixel-art look in this project comes from the SubViewport **downscale** (skill `godot-3d-pixelation`), not from the projection. Orthographic would feel wrong in first person. The eye-camera lives **inside the SubViewport** like every other camera in the project (skill `godot-main-scene`), so it renders at the low internal resolution and gets the pixel look for free.

## Requirements

- `godot-composition` — the player is a CharacterBody3D base with component children; movement logic stays on the body, look-target on the Head child (signals up / calls down).
- `godot-3d-pixelation` — the eye-camera is the SubViewport's current Camera3D; the pixel look is the downscale.
- `godot-code-rules` — load before writing the `.gd`; strict typed GDScript, file header, explicit return types, gate `tools/validate.sh`.

## Project conventions

- Scene: `res://entities/player/player.tscn`, root `Player` (CharacterBody3D) → child `Head` (Node3D) → child `Camera3D`. Add a `CollisionShape3D` (capsule) on the root.
- Script: `res://entities/player/player.gd` on the root.
- Head local Y ≈ eye height (e.g. `1.6`); Camera3D stays at the Head origin with rotation `(0,0,0)` — pitch lives on the Head, never on the Camera3D.
- Camera3D **Projection = Perspective** (the default). Do NOT set Orthogonal here — that is the top-down rig's contract, not this one.
- The Camera3D is the current camera **inside the SubViewport** (skill `godot-3d-pixelation` / `godot-main-scene`). Exactly one current Camera3D per viewport.
- Input actions (already in the project map): `move_left`, `move_right`, `move_forward`, `move_back`, `jump`. Mouse-look is raw `InputEventMouseMotion` — no action. `ui_cancel` (Esc) releases the mouse.
- `shoot` is an **A3** action — out of scope here; do not wire it.

## Steps

1. Build the scene: `Player` (CharacterBody3D) → `CollisionShape3D` (CapsuleShape3D) + `Head` (Node3D, position Y = eye height) → `Camera3D` (child of Head, transform identity, Perspective).
2. Instance `player.tscn` inside the SubViewport (under the level / Main's host per `godot-main-scene`); make its Camera3D the current one for that viewport.
3. Attach `player.gd`:

```gdscript
# entities/player/player.gd — first-person movement, mouse-look, and jump.
class_name Player
extends CharacterBody3D

@export var move_speed: float = 5.0
@export var jump_velocity: float = 5.0
@export var mouse_sensitivity: float = 0.002

var _gravity: float = float(ProjectSettings.get_setting("physics/3d/default_gravity"))
@onready var _head: Node3D = $Head


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var motion := event as InputEventMouseMotion
		# Yaw on the body, pitch on the head (clamped so the view can't flip over).
		rotate_y(-motion.relative.x * mouse_sensitivity)
		_head.rotate_x(-motion.relative.y * mouse_sensitivity)
		_head.rotation.x = clampf(_head.rotation.x, -PI / 2.0, PI / 2.0)
	elif event.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _physics_process(delta: float) -> void:
	# 1. Gravity while airborne.
	if not is_on_floor():
		velocity.y -= _gravity * delta

	# 2. Jump only when grounded.
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity

	# 3. Movement relative to where the body faces (yaw).
	var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var direction := (transform.basis * Vector3(input_dir.x, 0.0, input_dir.y)).normalized()
	if direction != Vector3.ZERO:
		velocity.x = direction.x * move_speed
		velocity.z = direction.z * move_speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, move_speed)
		velocity.z = move_toward(velocity.z, 0.0, move_speed)

	# 4. Engine resolves collisions and updates position.
	move_and_slide()
```

4. Run the gate: `tools/validate.sh`. Then run `godot-verify` on the entry-point scene (this changes what F5 renders).

> Movement-loop order is fixed: read input → apply gravity → modify velocity → `move_and_slide()` → read post-move state. All of it lives in `_physics_process`, never `_process`, or movement becomes frame-rate dependent and jittery.

> **Later (parked, not in this POC):** coyote-time and jump-buffer feel-tuning (jump grace after leaving a ledge, buffered jump before landing), variable jump height (cut `velocity.y` on early release), dash and wall-jump recipes. Available in the GodotPrompter `player-controller` skill (§3, §5) if a later phase wants game feel.

## Sprint + crouch (flat, no state machine)

Sprint and crouch are **hold-to-act modifiers**, not states — read the action each physics frame and branch inline. No FSM, no enum, no `godot-composition` state node: a run player is the base player with a speed multiplier, a crouch player is the base player with a lower Head and shorter capsule. Keeping them flat means the movement loop above stays the single source of truth and they compose (crouch-walk, not sprint-while-crouched) by simple precedence.

Crouch lowers the **eye height** (Head local Y) and shrinks the **capsule** so you fit under low geometry; releasing restores both. There is no stand-up blocking check in this POC (you can always stand) — that headroom raycast is parked below.

Add these to the project conventions for this skill:

- Input actions: `sprint` (Shift) and `crouch` (Ctrl) — both `_pressed`-held, not just-pressed. Add them to the project input map alongside `move_*` / `jump`.
- Precedence: **crouch wins over sprint** — while crouched the player walks at crouch speed even if Shift is held. Sprint only multiplies the standing walk speed.
- Crouch geometry: cache the capsule's stand height and the Head's stand Y at `_ready`; crouch lerps to a crouch fraction of each. Lerp (don't snap) so the camera dips smoothly.

Replace the movement section (step 3 / the `velocity.x`/`velocity.z` block) so the planar speed is chosen before it's applied, and add the crouch geometry update:

```gdscript
@export var sprint_multiplier: float = 1.6
@export var crouch_speed: float = 2.5
@export var crouch_height_fraction: float = 0.6   # crouched capsule / eye height vs standing
@export var crouch_lerp_speed: float = 12.0

@onready var _collision: CollisionShape3D = $CollisionShape3D
var _capsule: CapsuleShape3D
var _stand_height: float = 0.0
var _stand_eye_y: float = 0.0


func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	# Cache standing geometry so crouch can lerp back to it.
	_capsule = _collision.shape as CapsuleShape3D
	_stand_height = _capsule.height
	_stand_eye_y = _head.position.y


func _current_speed() -> float:
	# Crouch wins over sprint; sprint only multiplies the standing walk.
	if Input.is_action_pressed("crouch"):
		return crouch_speed
	if Input.is_action_pressed("sprint"):
		return move_speed * sprint_multiplier
	return move_speed


func _update_crouch(delta: float) -> void:
	var crouched := Input.is_action_pressed("crouch")
	var target_height := _stand_height * crouch_height_fraction if crouched else _stand_height
	var target_eye_y := _stand_eye_y * crouch_height_fraction if crouched else _stand_eye_y
	var t := clampf(crouch_lerp_speed * delta, 0.0, 1.0)
	_capsule.height = lerpf(_capsule.height, target_height, t)
	_head.position.y = lerpf(_head.position.y, target_eye_y, t)
```

Then in `_physics_process`, call `_update_crouch(delta)` and take the speed from `_current_speed()`:

```gdscript
	# 0. Lower / restore stance before moving.
	_update_crouch(delta)

	# ... gravity + jump unchanged ...

	# 3. Movement relative to facing, at the current (walk / sprint / crouch) speed.
	var speed := _current_speed()
	var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var direction := (transform.basis * Vector3(input_dir.x, 0.0, input_dir.y)).normalized()
	if direction != Vector3.ZERO:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)
```

> Sprint/crouch live in the same `_physics_process` as the rest — never `_process`. The capsule mutation goes through the cached `CapsuleShape3D`; make the shape **unique** in the scene (not shared) or every player instance crouches at once.

> **Later (parked, not in this POC):** stand-up headroom check (raycast up before un-crouching; stay crouched if blocked), crouch-jump, slide-on-sprint-crouch, and FOV kick on sprint. Available in the GodotPrompter `player-controller` skill if a later phase wants them.

## Sprint view-model "running feel" (procedural, no clips)

While sprinting the held weapon should lower and swing side-to-side — the "running feel". Do it as **pure procedural sine sway on the view-model's own local transform**, not an AnimationPlayer clip: view-models are mesh-only `Node3D`s, and ~40 LOC of sine math is cheaper to author and tune than a clip per weapon. The whole effect is one `_sprint_weight` (0..1) driving a static pose offset plus a continuously-phased sine sway, scaled by how fast the player is actually moving.

**The architecture lesson — isolate the layer on its own node.** The weapon's swap/holster/draw and reload dip tweens write the view-model's `position`/`rotation_degrees` **absolutely** (last writer each frame wins). A continuous sprint sway that writes those same properties will _fight_ those tweens and snap. Do **not** try to reconcile them by hand. Insert a dedicated child `SprintSway (Node3D)` between the weapon node and its mesh: the existing tweens keep writing the weapon-level view-model node, the sprint layer writes only `SprintSway`'s local transform. No contention, and per-weapon calibration (pistol vs rifle vs melee origins) lives on each `SprintSway` rest transform.

### Project conventions for this section

- View-model tree: `…/Weapon/ViewModel (Node3D)` → **`SprintSway (Node3D)`** → mesh. The swap/reload tweens target `ViewModel`; sprint writes `SprintSway` only. **Never** write sprint sway to `Head` or `Camera3D` — those own pitch, head-bob, and recoil; mixing sprint in there double-applies and corrupts aim.
- The composite gate is **split across the seam**: the player owns movement truth (`is_sprinting`), the weapon owns combat truth (`not _aiming and not _firing and not _reloading and not _swapping`). Sway only runs when ALL hold.
- Forwarding seam mirrors the existing `set_active_weapon_crouch`: `player → weapon_controller.update_sprint(active, velocity_factor, delta) → active weapon.update_sprint(...)`. `velocity_factor` is the planar speed normalized to top sprint speed, so the swing tracks real movement (no swing while standing-and-holding-Shift against a wall).
- Asymmetric lerp: snap **in** moderately, drop **out** faster, kill **instantly** on interrupt (fire/ADS/reload/swap) so the gun is rock-steady the moment you act.

### The forwarding seam

`is_sprinting` is local to the player's `_physics_process`. Forward it (and a velocity factor) the same way crouch is already relayed:

```gdscript
# player.gd — inside _physics_process, next to set_active_weapon_crouch(...)
var sprint_top: float = move_speed * sprint_multiplier
var velocity_factor: float = clampf(Vector2(velocity.x, velocity.z).length() / sprint_top, 0.0, 1.0)
_weapon_controller.update_sprint(is_sprinting, velocity_factor, delta)
```

```gdscript
# weapon_controller.gd — relay to the active weapon (mirrors set_active_weapon_crouch)
func update_sprint(active: bool, velocity_factor: float, delta: float) -> void:
	if _active_weapon != null:
		_active_weapon.update_sprint(active, velocity_factor, delta)
```

### The sprint layer on the weapon

The weapon ANDs in its own combat state, lerps `_sprint_weight` on the composite gate, advances the sine phase **every frame** (so amplitude — not phase — is what fades), and writes `SprintSway`'s local transform. Roll (`-Z`) is the dominant arm-swing term; vertical bob runs at **2×** the roll frequency:

```gdscript
@export var sprint_pose_pos: Vector3 = Vector3(0.18, -0.15, 0.05)   # lower + to the side
@export var sprint_pose_rot: Vector3 = Vector3(-12.0, 8.0, -18.0)    # degrees; roll (-Z) dominant
@export var sway_roll_deg: float = 8.0       # dominant arm-swing amplitude
@export var sway_pos_amp: float = 0.03        # lateral/vertical sway amplitude (metres)
@export var sway_freq: float = 6.0            # roll/lateral phase rate; vertical runs at 2×
@export var enter_lerp: float = 8.0
@export var exit_lerp: float = 12.0
@export var interrupt_lerp: float = 20.0

@onready var _sprint_sway: Node3D = $ViewModel/SprintSway
var _sprint_weight: float = 0.0
var _sway_phase: float = 0.0


func update_sprint(active: bool, velocity_factor: float, delta: float) -> void:
	# Combat truth ANDed in on the weapon side; movement truth came from the player.
	var interrupted: bool = _aiming or _firing or _reloading or _swapping
	var want_sway: bool = active and not interrupted

	# Reset phase only on ENTER, so the swing always starts from neutral.
	if want_sway and _sprint_weight < 0.001:
		_sway_phase = 0.0

	# Asymmetric lerp: ramp in, fall out faster, kill instantly on interrupt.
	var rate: float = enter_lerp
	if not want_sway:
		rate = interrupt_lerp if interrupted else exit_lerp
	var target: float = 1.0 if want_sway else 0.0
	_sprint_weight = lerpf(_sprint_weight, target, clampf(rate * delta, 0.0, 1.0))

	# Phase advances ALWAYS; amplitude (not phase) carries the fade. Scale by real speed.
	_sway_phase += sway_freq * delta
	var amp: float = _sprint_weight * velocity_factor

	var roll: float = sin(_sway_phase) * sway_roll_deg * amp
	var lateral: float = sin(_sway_phase) * sway_pos_amp * amp
	var vert: float = sin(_sway_phase * 2.0) * sway_pos_amp * amp   # 2× freq = footfall bob

	_sprint_sway.position = sprint_pose_pos * _sprint_weight + Vector3(lateral, vert, 0.0)
	_sprint_sway.rotation_degrees = sprint_pose_rot * _sprint_weight + Vector3(0.0, 0.0, roll)
```

This must run **after** bob/recoil/ADS write each frame, and it touches only `SprintSway` — so those layers stack additively instead of overwriting each other.

### Head-bob reconciliation (do not double-apply)

The existing sprint head-bob (`sprint_bob_mult` / `sprint_bob_freq_mult` on `_head.position`) is a _second_ sprint emphasis. Shipping both at full strength reads as nauseating. When this lands, **dial the head-bob sprint multipliers back toward ~1.0–1.1** and let the view-model swing carry the arm-swing; keep just enough bob for footfall cadence, then tune the two together in-editor. The head-bob is the camera moving; this is the _weapon_ moving — one of them should dominate, not both.

> **Per-weapon calibration:** pistol, rifle, and melee view-models have different origins. Tune `sprint_pose_pos/rot` (and optionally `sway_*`) per weapon on each `SprintSway` rest transform / per-weapon `@export` overrides — a shared value will look right on one and wrong on the others.

## Verification checklist

- [ ] On F5 the window shows a first-person view out through the player's eyes (perspective), pixelated by the SubViewport downscale — not a top-down or floating view.
- [ ] Moving the mouse left/right turns the whole view (body yaw); up/down tilts it and **stops** at straight-up / straight-down (no somersault).
- [ ] WASD (move_forward/back/left/right) walks relative to where you're looking horizontally; strafing is perpendicular to facing.
- [ ] Jump (Space) only fires while on the floor; the player falls back down under gravity and lands.
- [ ] Esc releases the mouse (cursor reappears); the view stops following the mouse.
- [ ] Camera3D's own rotation stays `(0,0,0)`; pitch is visible on the Head node, yaw on the Player root.
- [ ] Holding Sprint (Shift) while walking visibly speeds the player up; releasing returns to walk speed.
- [ ] Holding Crouch (Ctrl) smoothly lowers the eye/camera height and the player fits under low geometry; releasing rises back to standing height (no snap).
- [ ] Crouch beats sprint: holding Shift+Ctrl together walks at crouch speed, not run speed.
- [ ] While sprinting forward, the held weapon visibly lowers + swings side-to-side; the swing rides on the weapon, not the camera/crosshair (Head pitch and aim are unaffected).
- [ ] The swing scales with movement: full while running, none while standing still and holding Shift against a wall.
- [ ] Firing / aiming (ADS) / reloading / swapping while sprinting snaps the weapon steady **instantly**, not over a slow fade.
- [ ] Releasing Shift settles the weapon back to its rest pose smoothly (faster than it ramped in), with no snap.
- [ ] The sprint ramp-in starts the swing from neutral every time (no jolt at the first frame of sprint).
- [ ] Sprint head-bob and weapon swing together don't read as nauseating — one carries the arm-swing, not both at full strength.

## Error → Fix

| Symptom                                                           | Fix                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mouse-look inverted                                               | Wrong sign on the delta — keep `-motion.relative.x` for yaw and `-motion.relative.y` for pitch                                                                                                         |
| View can flip upside-down                                         | Missing pitch clamp — `_head.rotation.x = clampf(_head.rotation.x, -PI/2.0, PI/2.0)`                                                                                                                   |
| Movement ignores where you look                                   | Direction not taken from the basis — `transform.basis * Vector3(input_dir.x, 0, input_dir.y)` (rotates with body yaw)                                                                                  |
| Jittery / frame-rate-dependent movement                           | Movement code is in `_process` — move it all into `_physics_process(delta)`                                                                                                                            |
| Player sticks to / climbs walls                                   | Set `floor_block_on_wall = false` (and tune `floor_max_angle`) on the CharacterBody3D                                                                                                                  |
| `UNSAFE_CALL_ARGUMENT` on the gravity line                        | `ProjectSettings.get_setting(...)` is a Variant — wrap it: `float(ProjectSettings.get_setting("physics/3d/default_gravity"))`                                                                          |
| Window black / nothing renders                                    | The eye-camera must be the current Camera3D **inside the SubViewport**; another active camera elsewhere steals the view (one current camera per viewport)                                              |
| View looks flat / "too 3D" or distorted                           | Leave it Perspective — the pixel look is the SubViewport downscale (`godot-3d-pixelation`); do not switch to Orthogonal (that's the top-down rig)                                                      |
| Mouse never captured                                              | `Input.mouse_mode = MOUSE_MODE_CAPTURED` must be in `_ready`; release on `ui_cancel`                                                                                                                   |
| Sprint / crouch does nothing                                      | `sprint` / `crouch` not in the input map, or you used `is_action_just_pressed` — these are **held**, use `Input.is_action_pressed(...)`                                                                |
| Sprint works while crouched                                       | Precedence wrong — check `crouch` first in `_current_speed()` and `return` before the `sprint` branch (crouch wins)                                                                                    |
| Camera snaps instead of dipping on crouch                         | Setting Head Y / capsule height directly — lerp toward the target each frame (`lerpf(..., crouch_lerp_speed * delta)`)                                                                                 |
| All players crouch at once                                        | The `CapsuleShape3D` is shared — make the CollisionShape3D's shape **unique** (Make Unique) so each instance mutates its own                                                                           |
| Crouch leaves the player floating / sunken                        | Lower the eye height (Head Y) and capsule height together; cache both stand values in `_ready` and lerp both back when released                                                                        |
| Weapon snaps / jitters during sprint after a swap or reload       | Sprint sway is written to the same node the swap/reload tweens drive — move sway onto a dedicated child `SprintSway` so the tweens own `ViewModel` and sway owns its child (no last-writer contention) |
| Whole view / crosshair swings while sprinting                     | Sway is being written to `Head` or `Camera3D` — write it ONLY to the view-model's `SprintSway` local transform; Head/Camera own pitch + recoil + bob                                                   |
| Weapon swings even when standing still and holding Shift          | No velocity scaling — multiply amplitude by `velocity_factor` (planar speed / sprint top speed) so the swing tracks real movement                                                                      |
| Swing jolts / pops at the first frame of sprint                   | Phase reset every frame, or never — reset `_sway_phase = 0.0` ONLY on enter (`_sprint_weight < 0.001`), and advance phase every frame so amplitude (not phase) fades                                   |
| Weapon takes too long to steady when you fire / ADS while running | Symmetric lerp — use the asymmetric rate: `interrupt_lerp` (~20) on fire/ADS/reload/swap, `exit_lerp` (~12) on plain release, `enter_lerp` (~8) on ramp-in                                             |
| Weapon keeps swaying while aiming / reloading                     | Composite gate missing the combat conditions — AND in `not _aiming and not _firing and not _reloading and not _swapping` on the weapon side before swaying                                             |
| Sprint feels nauseating / over-emphasised                         | Head-bob double-apply — dial `sprint_bob_mult` / `sprint_bob_freq_mult` back toward ~1.0–1.1 and let the view-model swing carry the arm-swing                                                          |

---

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
