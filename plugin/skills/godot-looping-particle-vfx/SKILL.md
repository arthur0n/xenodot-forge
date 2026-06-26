---
name: godot-looping-particle-vfx
agents: [godot-vfx]
description: >-
  Persistent LOOPING 3D particle VFX for a Godot 4.6 Forward+ game — fire,
  smoke, torch, aura, magic loops — the opposite-lifecycle sibling of
  godot-oneshot-vfx. A Node3D-rooted rig groups two GPUParticles3D
  (`one_shot=false`, `emitting=true`, never emits `finished`, never self-frees)
  — a billboard fire body (quad draw pass + ParticleProcessMaterial rise/scale
  curve/color ramp + StandardMaterial3D particle-billboard, unshaded,
  vertex_color_use_as_albedo) and an additive flicker sparks pass (blend_add,
  ring emission, render_priority above the fire), plus a shadowless OmniLight3D
  flickered by an autoplay AnimationPlayer on `light_energy`. The emitter is
  ATTACHED to a host / placed in a level and removed DELIBERATELY by its owner
  (`emitting=false` + optional fade, then `queue_free`) — it does NOT free
  itself. Use for a continuous effect — "campfire", "torch", "burning",
  "looping fire", "smoke column", "magic aura", "persistent particles",
  "flame that keeps burning" — when a fire emitter never stops or never starts,
  when a looping GPUParticles3D leaks because nobody frees it, when fire
  particles render unlit/untinted, or when the glow light tanks FPS by casting
  shadows. NOT the fire-and-free burst (muzzle/impact/death — that is
  godot-oneshot-vfx), NOT billboard grass (godot-foliage), NOT a post-process
  screen effect (godot-screen-effects), NOT a surface decal (godot-decal-vfx).
---

# Godot looping particle VFX (persistent emitter)

Some effects are not a one-shot burst — a campfire, a torch, a smoke column, a
burning-status aura keep emitting until something decides to stop them. Build
these as a **persistent looping GPUParticles3D** rig: `one_shot = false`,
`emitting = true`, no `finished` signal, no self-`queue_free()`. The rig is
ATTACHED to a host (a burning enemy, a torch prop) or placed in the level, and
removed **deliberately by its owner** — the inverse of `godot-oneshot-vfx`,
which fires once and frees itself on `finished`. The reusable unit is the
looping-emitter lifecycle and the fire material recipe, not a per-effect
singleton. Group the passes under one Node3D so the whole effect moves, stops,
and frees as a unit.

## Requirements

- `godot-composition` — group the passes under ONE Node3D (scene as unit of
  composition). No `VFXManager` autoload; the owner that spawns the emitter owns
  its lifecycle. If driven by combat seams, the driver is a component
  (signals up / calls down), never a global service-locator.
- `godot-code-rules` — strict typed GDScript; loaded before any `.gd` edit.
- Renderer **Forward+** (per `project.godot` `config/features`). GPUParticles3D
  is Forward+/Mobile — never Compatibility (particles render empty there).
- `godot-oneshot-vfx` — the burst sibling. A looping emitter can be DRIVEN by the
  same gameplay seams (e.g. a burning status spawns/attaches a fire loop on
  `hit`, removes it when the status ends) but its lifecycle differs: oneshot
  frees itself on `finished`; this one is freed by the owner.

## Project conventions

- Effect scenes live at `entities/vfx/<name>.tscn` (snake_case file). Nodes are
  PascalCase (`FireVfx`, `FireBody`, `Sparks`, `GlowLight`, `Flicker`).
- ONE Node3D root groups every pass + the light + the AnimationPlayer.
- Lifecycle/ownership contract: the spawning owner holds the reference and is
  the only thing that stops/frees it. To stop: `emitting = false` (existing
  particles finish their lifetime), then `queue_free()` after one
  `lifetime` — optionally fade `light_energy`/`scale` first. NEVER connect
  `finished` (a looping emitter never emits it).
- A glow light NEVER casts a shadow (`shadow_enabled = false`) — same perf
  discipline as `godot-oneshot-vfx`'s muzzle flash.
- Custom flame shader path is PARKED: a per-surface or vertex flame shader
  belongs in `shaders/material/` (spatial/vertex), NOT `shaders/post/`. Particles
  are chosen here for dynamic, movable fire; the shader is the later flexibility
  upgrade, not this skill.

## Steps

### 1. The rig — `entities/vfx/fire_vfx.tscn` + `FireVfx.gd`

Scene tree (one Node3D root, everything under it):

```
FireVfx           (Node3D, script below)
├─ FireBody       (GPUParticles3D — billboard flame)
├─ Sparks         (GPUParticles3D — additive flicker)
├─ GlowLight      (OmniLight3D, shadow_enabled = false)
└─ Flicker        (AnimationPlayer, autoplay a loop on GlowLight:light_energy)
```

```gdscript
# entities/vfx/fire_vfx.gd — persistent looping fire emitter. Owner frees it; never self-frees.
class_name FireVfx
extends Node3D

@onready var _body: GPUParticles3D = $FireBody
@onready var _sparks: GPUParticles3D = $Sparks
@onready var _light: OmniLight3D = $GlowLight

func _ready() -> void:
	# Persistent loop: continuous emission, NO finished, NO self-free.
	_body.one_shot = false
	_sparks.one_shot = false
	_light.shadow_enabled = false  # perf: a glow light never casts a shadow
	_body.emitting = true
	_sparks.emitting = true

## Owner calls this to retire the effect. Stop emitting, let live particles
## finish, then free after one lifetime. Optionally fade the glow first.
func extinguish() -> void:
	_body.emitting = false
	_sparks.emitting = false
	create_tween().tween_property(_light, "light_energy", 0.0, 0.3)
	var tail: float = maxf(_body.lifetime, _sparks.lifetime)
	get_tree().create_timer(tail).timeout.connect(queue_free)
```

### 2. The fire body — billboard GPUParticles3D + ParticleProcessMaterial

On `FireBody`: a **quad-mesh draw pass** (Draw Pass 1 = a `QuadMesh`, ~0.4 m),
`amount ~50`, `lifetime ~1.2`, `local_coords = false` if the emitter is static /
`true` if it should drag with a moving host (a torch on a walking enemy).

`ParticleProcessMaterial` (the rise + grow + fade recipe):

- **Gravity** `(0, +2, 0)` — POSITIVE Y so flames rise (not fall).
- **Emission Shape** = Sphere, small radius (~0.15) — a compact base.
- **Initial Velocity** `+Y` (min/max ~1.0–2.0) so particles shoot up.
- **Scale Curve** small→large over lifetime (a `CurveTexture` rising ~0.3→1.0)
  so each flame grows as it climbs.
- **Color** = a `GradientTexture1D` ramp over lifetime (white-hot → orange →
  red → transparent) and an **Alpha Curve** fading to 0 at end of life for a
  smooth dissolve.
- Optional random `Angle`/`Angular Velocity` (RotY) for variation.

`StandardMaterial3D` on the draw mesh (the recipe that makes the ramp visible):

- `albedo_texture` = the soft fire/smoke PNG (a radial alpha blob).
- `transparency = TRANSPARENCY_ALPHA`.
- `shading_mode = SHADING_MODE_UNSHADED` — fire emits its own light, not lit.
- `billboard_mode = BILLBOARD_PARTICLES` — particle billboard, faces camera +
  respects per-particle transform.
- `vertex_color_use_as_albedo = true` — **critical**: routes the
  ParticleProcessMaterial color ramp into albedo so the gradient tints the
  flame. Without it the ramp does nothing.

### 3. The flicker sparks — 2nd additive GPUParticles3D

On `Sparks`: a smaller `amount ~20`, shorter `lifetime ~0.6`, **Emission Shape =
Ring** (embers spiral off the rim), gentle `+Y` velocity. Its draw-mesh
`StandardMaterial3D`:

- `albedo_texture` = a small soft circle PNG.
- `blend_mode = BLEND_MODE_ADD` — additive so embers glow over the fire.
- `transparency = TRANSPARENCY_ALPHA`, `shading_mode = UNSHADED`,
  `billboard_mode = BILLBOARD_PARTICLES`, `vertex_color_use_as_albedo = true`.
- `render_priority` ABOVE the fire body (e.g. `+1`) so sparks draw in front.

Give the ParticleProcessMaterial a **randomized scale curve** (wide min/max
scale randomness) — the per-particle size jitter reads as flicker.

### 4. The flicker glow — shadowless OmniLight3D + AnimationPlayer

`GlowLight` OmniLight3D: warm orange color, `shadow_enabled = false` (never a
shadow — perf + correctness). `Flicker` AnimationPlayer: an **autoplay**,
looping animation that keyframes `GlowLight:light_energy` between ~1.5 and ~3.0
over ~0.4 s with eased, slightly irregular keys — drives the glow pulse with no
per-frame script. (A looping `AnimationPlayer` here, NOT a one-shot Tween — the
Tween pulse is the oneshot-vfx muzzle pattern.)

### 5. Driving it from a gameplay seam (optional)

A looping effect can be triggered by combat seams just like oneshot VFX, but the
DRIVER must also retire it. Example: a burning-status component attaches a
`FireVfx` to an enemy on a fire hit, holds the reference, and calls
`extinguish()` when the status timer ends — the owner controls the lifecycle.

```gdscript
# In the owner (a status component on the enemy):
var _fire: FireVfx

func ignite(host: Node3D) -> void:
	_fire = preload("res://entities/vfx/fire_vfx.tscn").instantiate()
	host.add_child(_fire)              # attached: drags with the host
	_fire.transform = Transform3D.IDENTITY

func _on_status_expired() -> void:
	if is_instance_valid(_fire):
		_fire.extinguish()             # owner retires it; it never self-frees
		_fire = null
```

## Verification checklist

- The fire emits continuously and never stops on its own (watch >5 s — no
  `finished`, no disappearance).
- The Node3D stays in the running Remote tree until the owner calls
  `extinguish()` — it does NOT free itself.
- Flames RISE and grow (positive gravity + scale curve), tinting white→orange→
  red→transparent (the color ramp shows — proves `vertex_color_use_as_albedo`).
- Sparks glow additively IN FRONT of the fire and flicker in size.
- The glow light pulses (AnimationPlayer autoplays) and casts NO shadow.
- `extinguish()` stops emission, fades the glow, and frees the node after one
  lifetime — no leak, no abrupt pop.
- Scene runs under Forward+ (particles render, not silently empty).
- `tools/validate.sh` passes on all touched `.gd` / `.tscn`.

## Error → Fix

| Symptom                                     | Fix                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Fire never starts / emits nothing           | `emitting` not set true, or no draw-pass mesh — set `emitting = true` and assign a `QuadMesh` to Draw Pass 1.                |
| Fire flickers off / plays once then stops   | `one_shot = true` — a loop needs `one_shot = false`; never connect `finished`.                                               |
| Node leaks in remote tree forever           | A looping emitter must be freed by its OWNER — call `extinguish()` (`emitting=false` + timed `queue_free`); never self-free. |
| Flames fall instead of rising               | Gravity is negative/zero — set ParticleProcessMaterial gravity to `(0, +2, 0)` and initial velocity `+Y`.                    |
| Fire renders flat / untinted (ramp ignored) | `vertex_color_use_as_albedo = false` — set it true so the process-material color ramp drives albedo.                         |
| Fire looks lit / shaded by scene lights     | `shading_mode` not unshaded — set `SHADING_MODE_UNSHADED`.                                                                   |
| Particles don't face camera / draw edge-on  | `billboard_mode` not particle — set `BILLBOARD_PARTICLES`.                                                                   |
| Sparks invisible or behind the fire         | Not additive / wrong layer — set `BLEND_MODE_ADD` and `render_priority` above the fire body.                                 |
| FPS tanks near the fire                     | Glow light casts a shadow — set `shadow_enabled = false`; cap particle `amount` (~50 fire / ~20 sparks).                     |
| Particles render empty                      | Running Compatibility renderer — GPUParticles3D needs Forward+/Mobile; switch to Forward+.                                   |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
