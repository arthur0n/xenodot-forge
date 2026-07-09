---
name: godot-oneshot-vfx
agents: [godot-vfx]
domain: godot-core
description: >-
  Fire-and-free 3D combat VFX for a first-person shooter POC in Godot 4.6 — a
  reusable vfx_base.tscn (Node3D root + GPUParticles3D child) one-shot rig that
  frees itself on the `finished` signal, plus a thin router COMPONENT (not an
  autoload) that maps existing gameplay seams (`fired` / `hit` / `died`) to
  effect scenes. Covers muzzle flash (reusing the existing MuzzleFlash
  OmniLight3D as a shadowless pulse), a generic impact burst, a death burst, and
  a particle-free MeshInstance3D scale-tween shockwave, with an inline perf
  budget. Use when a combat seam needs juice — "muzzle flash", "hit spark",
  "impact effect", "death burst", "shockwave", "explosion particles", "VFX on
  shot/hit/kill" — when a GPUParticles3D plays once then leaks in the remote
  tree, when a burst spawns at the wrong place, or when a one-shot effect never
  frees / never re-triggers. NOT the damage vignette (that is godot-screen-effects)
  and NOT the projectile trail (that is godot-travelling-projectile-3d).
---

# Godot one-shot VFX (fire-and-free)

Combat juice is short, frequent, and disposable: a muzzle flash, a hit spark, a
death burst. Each is spawned, plays once, and is gone. Mirror the audio house
style exactly — **fire-and-free**: instance a small Node3D-rooted effect at a
world point, let it emit one burst, and have it `queue_free()` itself on the
GPUParticles3D `finished` signal. ONE rig (`vfx_base.tscn` + `VfxOneShot.gd`)
backs many effects; a thin **router component** maps gameplay signals to effect
scenes. No global VFX manager — composition over autoloads. Build effects ON
DEMAND, one seam at a time; the reusable unit is the spawn-free lifecycle and
the routing map, never a per-effect singleton.

## Requirements

- `godot-composition` — the router is a plain component (signals up / calls
  down), NOT an autoload. A `VFXManager` singleton contradicts CLAUDE.md.
- `godot-code-rules` — strict typed GDScript; loaded before any `.gd` edit.
- Renderer **Forward+** (per `project.godot` `config/features`). GPUParticles3D
  trails and Decal are Forward+/Mobile only — never Compatibility.
- Combat seams already exist: `godot-shooter-enemy-combat` (enemy `died`, weapon
  `hit_confirmed` / `kill_confirmed`) and `godot-travelling-projectile-3d`
  (projectile `signal hit(target)`, weapon `signal fired`). VFX only _listens_
  on these — it changes no contract.

## Project conventions

- Effect scenes live at `entities/vfx/<name>.tscn` (snake_case file). Nodes are
  PascalCase (`VfxOneShot`, `Particles`, `MuzzleFlash`).
- Reuse the existing muzzle seam: `Muzzle` Marker3D → child `MuzzleFlash`
  OmniLight3D ("off by default") in `rifle.tscn` / `weapon.tscn`.
- **Reparent-before-free** (the audio pattern): a freed one-shot must outlive
  its spawning owner. Spawn it under a surviving `VfxRoot` Node3D (Main-level or
  level-local) BEFORE the owner `queue_free()`s — otherwise the burst is cut
  when the projectile/enemy frees mid-effect. Set `global_transform` after
  reparent so it stays at the impact point.
- NO autoload. The router is a component child of the entity that owns the seam.

## Steps

### 1. The one-shot rig — `entities/vfx/vfx_base.tscn` + `VfxOneShot.gd`

Scene: `VfxOneShot` (Node3D, script below) → `Particles` (GPUParticles3D). On
the GPUParticles3D set `one_shot = true`, `emitting = false` (the script's
`start()` flips it AFTER placement), `explosiveness = 1.0` (whole burst at once), a draw-pass mesh + a
`ParticleProcessMaterial`, and `local_coords = false` so particles stay in world
space where the burst spawned (true would drag them with the node — only use
true for an attached trailing effect).

```gdscript
class_name VfxOneShot
extends Node3D
## One-shot fire-and-free particle burst: emits once, frees self on `finished`.

@onready var _particles: GPUParticles3D = $Particles

func _ready() -> void:
	_particles.one_shot = true
	_particles.local_coords = false
	_particles.emitting = false  # ARM only — _ready() runs DURING add_child, before placement
	if not _particles.finished.is_connected(_on_finished):
		_particles.finished.connect(_on_finished)
	# Do NOT restart()/emit here: global_transform is not set until AFTER add_child, so
	# emitting now seeds every particle at the pre-placement origin (0,0,0).

## Call AFTER global_transform is set on this node — emits from the correct world point.
func start() -> void:
	_particles.restart()  # reset + emit; seeds particle origins at the now-correct world pos

func _on_finished() -> void:
	queue_free()
```

Perf budget (inline, non-negotiable for the POC): lifetime **0.2–0.8 s**,
**≤ ~200 particles per burst**, a flash light NEVER casts shadow. Keep
`explosiveness = 1.0` so one burst = one `finished`.

### 2. The router COMPONENT — map seams → effect scenes (NOT an autoload)

A plain component child of the entity owning the seam. It holds a dictionary of
preloaded effect scenes and a single `_spawn_vfx()` that instances under the
surviving `VfxRoot`, places it, and lets the rig free itself.

```gdscript
class_name VfxRouter
extends Node
## Thin router: gameplay signal → one-shot effect scene. No autoload.

const FX_IMPACT: PackedScene = preload("res://entities/vfx/impact_burst.tscn")
const FX_DEATH: PackedScene = preload("res://entities/vfx/death_burst.tscn")

@export var vfx_root_path: NodePath  # a surviving VfxRoot Node3D

func _spawn_vfx(scene: PackedScene, at: Transform3D) -> void:
	var root: Node3D = get_node(vfx_root_path) as Node3D
	if root == null:
		return
	var fx: Node3D = scene.instantiate() as Node3D
	root.add_child(fx)            # into tree BEFORE placement (arms the rig, does NOT emit)
	fx.global_transform = at      # place AFTER add_child — a pre-tree transform silently no-ops
	if fx.has_method("start"):
		@warning_ignore("unsafe_method_access")
		fx.start()                # emit LAST, from the now-correct world point

func on_hit(target: Node3D) -> void:
	_spawn_vfx(FX_IMPACT, target.global_transform)

func on_died(enemy: Node3D) -> void:
	_spawn_vfx(FX_DEATH, enemy.global_transform)
```

Wire it by connecting the existing seams to these handlers (e.g. projectile
`hit` → `on_hit`, enemy `died` → `on_died`, weapon `fired` → the muzzle pulse
below). The contract owners (`godot-shooter-enemy-combat`,
`godot-travelling-projectile-3d`) are unchanged — VFX only hangs a listener.

### 3. Muzzle flash off `fired` — reuse the existing OmniLight3D

Do not add a new light. Drive the existing `MuzzleFlash` OmniLight3D as a
shadowless pulse on the weapon's `fired` signal. Confirm `shadow_enabled =
false` on it (a flash must never cast a shadow — perf + correctness). Pulse its
energy up then tween back, optionally spawning a tiny spark `VfxOneShot` at the
`Muzzle` Marker3D.

```gdscript
func _on_fired() -> void:
	$Muzzle/MuzzleFlash.shadow_enabled = false
	$Muzzle/MuzzleFlash.light_energy = 4.0
	create_tween().tween_property(
		$Muzzle/MuzzleFlash, "light_energy", 0.0, 0.06)
```

### 4. Generic impact burst off projectile `hit`

`entities/vfx/impact_burst.tscn` is a `vfx_base.tscn` instance tuned to a short
spark cone (lifetime ~0.3 s, ≤ ~120 particles). Route projectile `signal
hit(target)` → `VfxRouter.on_hit`, spawning at the hit point. ONE generic impact
first — per-surface (metal/concrete/flesh) tags are deferred.

### 5. Shockwave alternative — MeshInstance3D scale-tween (no particles)

For a cheap ring/blast with no particle cost: a `MeshInstance3D` (flat
ring/quad, unshaded transparent material) whose scale tweens up while alpha
tweens to 0, then `queue_free()`. Use when a burst needs a big readable shape
but not 200 particles.

```gdscript
func _ready() -> void:
	var t: Tween = create_tween().set_parallel()
	t.tween_property(self, "scale", Vector3.ONE * 4.0, 0.4)
	t.tween_property($Ring, "transparency", 1.0, 0.4)
	t.chain().tween_callback(queue_free)
```

## Verification checklist

- Firing once produces exactly one burst per shot; hitting once produces one
  impact burst; a kill produces one death burst (no double-fire).
- After its lifetime the effect node is GONE from the remote scene tree (open
  the running Remote tree — no accumulating `VfxOneShot` leak).
- The muzzle flash light casts NO shadow (`shadow_enabled = false`).
- Bursts appear at the impact/muzzle world point, not dragged or at origin.
- Scene runs under Forward+ (trails/decals present render, not silently empty).
- `tools/validate.sh` passes on all touched `.gd` / `.tscn`.

## Error → Fix

| Symptom                                           | Fix                                                                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect invisible (emits but nothing drawn)        | GPUParticles3D has no draw-pass mesh — assign a mesh to Draw Pass 1.                                                                                                                               |
| Node never frees / leaks in remote tree           | `one_shot` is false, or `finished` not connected — set `one_shot = true` and connect `finished` → `queue_free`.                                                                                    |
| Burst at wrong spot (origin / dragged with owner) | `local_coords` wrong — set `false` for a world burst; set `global_transform` AFTER reparenting under `VfxRoot`.                                                                                    |
| Burst flashes at world origin (0,0,0) on spawn    | Emission fires in `_ready()` (which runs DURING `add_child`, before `global_transform` is set) — split emit into `start()` and call it AFTER placement; `_ready()` only arms (`emitting = false`). |
| Burst cut short when projectile/enemy frees       | Owner freed before the effect — reparent the effect under a surviving `VfxRoot` BEFORE the owner `queue_free()`s.                                                                                  |
| Trail empty / no trail renders                    | Running Compatibility renderer — trails are Forward+/Mobile only; switch to Forward+.                                                                                                              |
| Re-used rig won't re-fire second time             | Call `start()` (which `restart()`s) after placement; toggling `emitting` alone won't re-fire a `one_shot` mid-cycle.                                                                               |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
