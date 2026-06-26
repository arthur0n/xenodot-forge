---
name: godot-travelling-projectile-3d
agents: [godot-ranged-combat]
description: Fire a travelling 3D projectile in Godot 4.6 — spawn at a Marker3D muzzle, detach with top_level, move forward along -Z each physics frame, despawn on max range or Area3D hit, gated by a one-shot Timer fire-rate cooldown. A host-agnostic firing component (attaches to any entity). Use when building a weapon that shoots a projectile that physically travels and can be dodged/seen in flight, when a bullet must spawn→move→despawn, or when adding a fire-rate cooldown. NOT for hitscan/raycast (an instant ray with no travel — a different design, not covered here).
---

# Godot Travelling Projectile 3D (spawn → move → despawn + fire-rate)

A **travelling** projectile physically moves through the world after it is fired — you can see it in flight, it takes time to arrive, and it despawns on impact or after a maximum range. This is deliberately **not hitscan**: hitscan casts an instant ray and registers a hit the same frame with no projectile in the world (a different design — out of scope for this skill).

The design is two small, host-agnostic pieces, composed per `godot-composition` (calls down / signals up):

- **`Weapon`** — a `Node3D` firing component with a `Marker3D` muzzle and a one-shot `Timer`. Its host (a player, a turret, anything) calls `try_fire()`; the Timer gates the cadence so it is deterministic and frame-rate independent.
- **`Projectile`** — an `Area3D` that, once spawned, travels along its own local `-Z` and despawns itself. It is `top_level = true` so it keeps travelling in world space regardless of what fired it.

It works with the perspective FPS eye-camera inside the SubViewport (skills `godot-3d-pixelation` / `godot-first-person-controller`): mount the `Weapon` under the player's `Head`, point the muzzle forward, and shots travel along the look direction — but the component assumes **no specific host**.

## Requirements

- `godot-composition` — `Weapon` and `Projectile` are independent components; the host calls `Weapon.try_fire()` (calls down), the projectile reports impact via a signal (signals up). No component reaches up into its host.
- `godot-code-rules` — load before writing the `.gd`; strict typed GDScript, file header, explicit return types, gate `tools/validate.sh`.

## Project conventions

- Scenes: `res://entities/projectile/projectile.tscn` (root `Projectile`, Area3D) and a `Weapon` (Node3D) sub-tree — either its own `res://entities/weapon/weapon.tscn` or composed directly under the firer. Names PascalCase, files snake_case.
- `Projectile` (Area3D) → `CollisionShape3D` (small SphereShape3D) + a visible mesh child. Set its **collision mask** to the layers it should hit (walls / targets), and put projectiles on their own collision **layer** so they don't collide with each other or the firer.
- `Weapon` (Node3D) → `Muzzle` (Marker3D, oriented so local `-Z` points where shots go) + `Cooldown` (Timer, `one_shot = true`).
- Muzzle aim: a `Camera3D` looks down its local `-Z`; mounting the `Weapon`/`Muzzle` under the `Head` and copying the muzzle `global_transform` onto the projectile makes shots travel along the look direction.
- The `shoot` input action is added at **A3 build time** (game-designer scope) — this skill names it but does **not** add it to the Input Map. The host reads `shoot` and calls `Weapon.try_fire()`.
- Spawn projectiles into a world-space node (the current scene), never as a child of the muzzle, and set `top_level = true` — otherwise they inherit the muzzle's motion and drag along with the firer.

## Steps

1. Build `projectile.tscn`: `Projectile` (Area3D) → `CollisionShape3D` (SphereShape3D) + `MeshInstance3D`. Set collision layer/mask.
2. Attach `projectile.gd`:

```gdscript
# entities/projectile/projectile.gd — a travelling projectile: moves forward, despawns on range or hit.
class_name Projectile
extends Area3D

signal hit(target: Node3D)

@export var speed: float = 30.0
@export var max_range: float = 100.0

var _travelled: float = 0.0


func _ready() -> void:
	# body_entered can fire MULTIPLE times in one physics frame before the deferred
	# queue_free() removes us — CONNECT_ONE_SHOT makes the hit handler run exactly once
	# per projectile lifetime (a _consumed bool early-return is the equivalent if you
	# also need area_entered).
	body_entered.connect(_on_body_entered, CONNECT_ONE_SHOT)


func _physics_process(delta: float) -> void:
	# Travel along local -Z (forward). top_level keeps this in world space,
	# independent of whatever fired it.
	var step: float = speed * delta
	global_position += -global_transform.basis.z * step
	_travelled += step
	if _travelled >= max_range:
		queue_free()


func _on_body_entered(body: Node3D) -> void:
	# Runs exactly once (one-shot). Report the impact (the hit entity's own Health
	# component handles damage — signals up, no reaching into the target here), then
	# despawn. Any connect() this triggers downstream (impact SFX, the target's died
	# signal) must STILL be idempotent — guard with is_connected() — because the SAME
	# target can be hit by other projectiles before that signal clears.
	hit.emit(body)
	queue_free()
```

3. Build the `Weapon` sub-tree: `Weapon` (Node3D) → `Muzzle` (Marker3D) + `Cooldown` (Timer). Assign the projectile scene to `projectile_scene`.
4. Attach `weapon.gd`:

```gdscript
# entities/weapon/weapon.gd — host-agnostic firing component: spawns projectiles from a muzzle, gated by a cooldown.
class_name Weapon
extends Node3D

@export var projectile_scene: PackedScene
@export var fire_rate: float = 0.2  # seconds between shots

@onready var _muzzle: Marker3D = $Muzzle
@onready var _cooldown: Timer = $Cooldown


func _ready() -> void:
	_cooldown.one_shot = true
	_cooldown.wait_time = fire_rate


# Called by the host on the `shoot` input. Returns true if a shot was fired.
func try_fire() -> bool:
	if not _cooldown.is_stopped():
		return false
	_fire()
	_cooldown.start()
	return true


func _fire() -> void:
	if projectile_scene == null:
		return
	var projectile := projectile_scene.instantiate() as Projectile
	# Spawn into world space and detach from the muzzle so it travels on its own.
	get_tree().current_scene.add_child(projectile)
	projectile.top_level = true
	projectile.global_transform = _muzzle.global_transform
```

5. Wire the host (calls down): on the `shoot` action, the host calls `weapon.try_fire()`. Example in the player's `_physics_process` / `_unhandled_input`:

```gdscript
	if Input.is_action_pressed("shoot"):
		_weapon.try_fire()
```

6. Run the gate: `tools/validate.sh`, then `godot-verify` (firing changes runtime behaviour — verify it renders and runs).

> The fire-rate is gated by a one-shot `Timer` (`is_stopped()`), **not** by animation playback speed. A Timer cooldown is deterministic and typeable; animation-driven cadence (seen in some tutorials) is harder to reason about and to type-check.

> **Later (parked, not in this POC):** object pooling (reuse projectiles instead of instantiate/`queue_free`), muzzle-flash / impact VFX, projectile gravity/arc, and recoil. Plain instantiate + `queue_free` is correct for a POC volume of shots.

## Verification checklist

- [ ] On the `shoot` input a projectile spawns at the muzzle and **visibly travels** forward (not an instant hit).
- [ ] Holding fire is capped by the cooldown — shots come out at `fire_rate`, not every frame.
- [ ] Projectiles despawn after `max_range` (no infinite/accumulating nodes — watch the remote tree).
- [ ] A projectile that enters a target/wall registers a hit (the `hit` signal fires) and despawns.
- [ ] Projectiles travel in world space — they do **not** drag along when the firer moves after the shot (`top_level = true`).
- [ ] Projectiles do not collide with the firer or each other (collision layer/mask set correctly).

## Error → Fix

| Symptom                                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projectile sticks to / moves with the firer                                                               | Not detached — spawn into `get_tree().current_scene` and set `top_level = true`, then assign `global_transform`                                                                                                                                                                                                                                                                                                                               |
| Projectile flies sideways / wrong way                                                                     | Muzzle `-Z` isn't pointing where you aim — orient the `Marker3D` so local `-Z` is forward; copy the muzzle `global_transform`, not `position`                                                                                                                                                                                                                                                                                                 |
| Firing every frame, no cadence                                                                            | Cooldown not gating — `Timer.one_shot = true`, check `is_stopped()` before firing, `start()` after                                                                                                                                                                                                                                                                                                                                            |
| Node count climbs forever                                                                                 | Missing despawn — `queue_free()` past `max_range` and on `body_entered`                                                                                                                                                                                                                                                                                                                                                                       |
| Projectile passes through targets                                                                         | `body_entered` needs the target to be a PhysicsBody3D on the projectile's collision **mask**; for Area-vs-Area use `area_entered` instead                                                                                                                                                                                                                                                                                                     |
| Projectile hits the firer immediately                                                                     | Firer shares the projectile's collision mask — put projectiles on their own layer and exclude the firer's layer from the mask                                                                                                                                                                                                                                                                                                                 |
| `UNSAFE_CALL_ARGUMENT` / untyped warnings                                                                 | Type the instance: `instantiate() as Projectile`; type signal params and exports per `godot-code-rules`                                                                                                                                                                                                                                                                                                                                       |
| Hit handler runs several times per projectile / `Signal already connected to given callable`              | Area3D `body_entered`/`area_entered` fires multiple times before the deferred `queue_free` frees the node — connect the entered signal with `CONNECT_ONE_SHOT` (or set a `_consumed` flag and early-return) so the hit runs once.                                                                                                                                                                                                             |
| Bullet hits a multi-hit enemy, the second shot throws "already connected" and the bullet hangs in the air | Connecting to the target's signal (e.g. `died`) per hit is not idempotent. `CONNECT_ONE_SHOT` only auto-disconnects AFTER that signal fires — a target still alive after hit 1 is still connected at hit 2. Guard: `if not target.is_connected("died", _on_target_died): target.died.connect(_on_target_died, CONNECT_ONE_SHOT)`. The thrown error otherwise aborts the despawn (stuck bullet), so the guard is correctness, not log hygiene. |

---

Authored in-house from the project's own transcript digest `library/transcripts/fps-survivor-arena-gdquest.md` (points 5–6). Hitscan contrast: `library/transcripts/fps-assault-rifle-hitscan.md` (the design this skill deliberately does not use).
