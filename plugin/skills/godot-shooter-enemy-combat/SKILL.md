---
name: godot-shooter-enemy-combat
agents: [godot-enemy]
domain: godot-core
description: The hit / death / kill-confirm contract for a SHOOTABLE enemy in a shooter game in Godot 4.6 (camera-agnostic — first- or third-person) — projectile or hitscan damage, NOT melee/RTS/other-genre enemy combat. Enemy health + score_value, a `died(enemy)` signal, a duck-typed `on_hit()` shootability seam (non-fatal hit flash vs fatal death flash + reparent-before-free death SFX), and the weapon-side `hit_confirmed` (every hit) / `kill_confirmed` (fatal hit) feedback seam that connects to the enemy's `died` idempotently. Use when an enemy must take damage and die from being shot, when "enemy health", "kill confirm", "hitmarker", "on_hit", "enemy died", "score on kill", or "multi-hit enemy" appears in a task, when a bullet must register a kill, or when a second bullet on a surviving enemy throws "Signal already connected" / the bullet hangs in the air. NOT the firing/despawn side (that is godot-travelling-projectile-3d) and NOT enemy patrol/chase behaviour (that is godot-enemy-ai) — this is the damage CONTRACT that links projectile, enemy, and weapon.
---

# Godot Shooter Enemy Combat (hit / death / kill-confirm contract)

Three entities already exist independently — a `Projectile` that travels and reports impact, an `Enemy` that patrols and chases, a `Weapon` that fires. **Combat is the contract that joins them**, and the contract is what was missing: who holds health, who decides death, who hears about a kill. Getting it wrong (no idempotent connect, freeing a node mid-SFX) is exactly what produced the duplicate-signal and stuck-bullet bugs. The contract is deliberately thin and duck-typed, per `godot-composition` — the projectile does not know what an enemy is, the weapon does not reach into the enemy. It flows in one direction: projectile hits a body → calls the body's `on_hit()` (calls down) → the enemy decrements its own health and, on the fatal hit, emits `died` (signals up) → the weapon, subscribed one-shot to that `died`, emits `kill_confirmed`. Hitmarker on every hit, kill cue on the fatal one. No HealthComponent node, no Hurtbox/Hitbox split — health is an `int` on the `CharacterBody3D` because this POC has exactly one thing that takes damage and "modularize on demand" says don't split until a second does.

## Requirements

- `godot-code-rules` — strict typed GDScript: line-1 path header, `class_name`, typed vars/returns, `@warning_ignore` only at a justified SEAM, `tools/validate.sh` gate. Load BEFORE editing any `.gd` below.
- `godot-composition` — the contract is calls-down / signals-up and duck-typed: the projectile calls `on_hit()` via `has_method`, the weapon detects a kill via `has_signal("died")`. No component reaches into another's type.
- `godot-enemy-ai` — supplies the `Enemy` (`CharacterBody3D`, `entities/enemy/`) this contract attaches to. The combat members below are ADDED to that enemy; its nav/FSM is untouched.
- `godot-travelling-projectile-3d` — owns the firing/despawn side: `Projectile.body_entered` (`CONNECT_ONE_SHOT`) → `hit.emit(body)` → `body.on_hit()` if `has_method`. This skill consumes that seam; it does not redefine it.

## Project conventions

- Enemy: `entities/enemy/enemy.gd` (`class_name Enemy`, `CharacterBody3D`). Combat members: `@export var health: int = 1` (1 = one-shot grunt/runner; tank overrides to 3), `@export var score_value: int = 1` (runner/magnet/tank override), `signal died(enemy: Enemy)`, internal `var _health: int` seeded from `health` in `_ready()`.
- Mesh: per-mesh visual effects address `@onready _mesh: Node3D = $Mesh` and walk every `find_children("*", "MeshInstance3D", true, false)` descendant — a greybox `$Mesh` is one `MeshInstance3D`, a kitbash `.glb` is a wrapper with many. Make each material unique (`duplicate()`) before tinting so sibling enemies sharing a resource don't all flash.
- Weapon: `entities/weapon/weapon.gd` (`class_name Weapon`, `Node3D`). `signal hit_confirmed` (HUD hitmarker, every hit) and `signal kill_confirmed` (kill cue, fatal hit only). The host/HUD connects to these — the weapon does not draw UI.
- Death/hit SFX: `AudioStreamPlayer` (non-positional) reparented to `get_tree().current_scene` before the owner `queue_free()`s, with an idempotent `finished.connect(player.queue_free)` guard.
- Kill detection is duck-typed: only a target with a `died` signal triggers `kill_confirmed`; world geometry is silently ignored.

## Steps

1. **Enemy: declare the combat contract.** Add to `enemy.gd`:

   ```gdscript
   ## Emitted just before queue_free() so listeners (WaveManager, weapon kill-confirm) can react.
   signal died(enemy: Enemy)

   ## Hits required to kill. Default 1 = one-shot. Tank overrides to 3.
   @export var health: int = 1
   ## Score awarded to the player on kill. Grunt = 1 (default); others override.
   @export var score_value: int = 1

   var _health: int = 1
   # Maps MeshInstance3D → saved Material (or null); restored after a non-fatal flash.
   var _saved_overrides: Dictionary = {}
   ```

   Seed `_health` in `_ready()`: `_health = health`.

2. **Enemy: the `on_hit()` shootability seam.** The projectile calls this duck-typed (same contract as any other shootable). Decrement; non-fatal → flash and return; fatal → death SFX, emit `died`, flash-and-free.

   ```gdscript
   ## Called by the projectile via duck-typed on_hit() (godot-travelling-projectile-3d).
   func on_hit() -> void:
   	_health -= 1
   	if _health > 0:
   		_flash_hit()
   		return
   	_play_death_sfx()
   	died.emit(self)
   	_flash_and_die()
   ```

3. **Enemy: non-fatal hit flash (restorable).** Save each mesh's current override (a runner/tank tint may already be set), tint red, then restore — never `queue_free`.

   ```gdscript
   func _flash_hit() -> void:
   	var mesh_nodes: Array[MeshInstance3D] = []
   	for child: Node in _mesh.find_children("*", "MeshInstance3D", true, false):
   		if child is MeshInstance3D:
   			mesh_nodes.append(child as MeshInstance3D)
   	if mesh_nodes.is_empty():
   		return
   	_saved_overrides.clear()
   	var tw: Tween = create_tween()
   	tw.set_parallel(true)
   	for mi: MeshInstance3D in mesh_nodes:
   		_saved_overrides[mi] = mi.get_surface_override_material(0)
   		var mat: StandardMaterial3D = mi.get_active_material(0) as StandardMaterial3D
   		if mat == null:
   			continue
   		var hit_mat: StandardMaterial3D = mat.duplicate() as StandardMaterial3D
   		mi.set_surface_override_material(0, hit_mat)
   		hit_mat.emission_enabled = true
   		tw.tween_property(hit_mat, "albedo_color", Color.RED, 0.05)
   		tw.tween_property(hit_mat, "emission", Color.RED, 0.05)
   	tw.set_parallel(false)
   	tw.tween_callback(_restore_materials)


   func _restore_materials() -> void:
   	for key: Variant in _saved_overrides.keys():
   		if not key is MeshInstance3D:
   			continue
   		# SEAM: keys are MeshInstance3D by construction (only _flash_hit writes this dict).
   		@warning_ignore("unsafe_cast")
   		var mesh_inst: MeshInstance3D = key as MeshInstance3D
   		# SEAM: values are Material or null (Variant) by construction.
   		@warning_ignore("unsafe_cast")
   		mesh_inst.set_surface_override_material(0, _saved_overrides[key] as Material)
   	_saved_overrides.clear()
   ```

4. **Enemy: fatal flash-and-free + death SFX.** White flash on unique materials, then free; death SFX reparented (to `get_tree().current_scene` before `queue_free()`) so it outlives the node.

   ```gdscript
   func _flash_and_die() -> void:
   	var mesh_nodes: Array[MeshInstance3D] = []
   	for child: Node in _mesh.find_children("*", "MeshInstance3D", true, false):
   		if child is MeshInstance3D:
   			mesh_nodes.append(child as MeshInstance3D)
   	if mesh_nodes.is_empty():
   		queue_free()
   		return
   	var tw: Tween = create_tween()
   	tw.set_parallel(true)
   	for mi: MeshInstance3D in mesh_nodes:
   		var mat: StandardMaterial3D = mi.get_active_material(0) as StandardMaterial3D
   		if mat == null:
   			continue
   		var flash_mat: StandardMaterial3D = mat.duplicate() as StandardMaterial3D
   		mi.set_surface_override_material(0, flash_mat)
   		flash_mat.emission_enabled = true
   		tw.tween_property(flash_mat, "albedo_color", Color.WHITE, 0.06)
   		tw.tween_property(flash_mat, "emission", Color.WHITE, 0.06)
   	tw.set_parallel(false)
   	tw.tween_callback(queue_free)


   func _play_death_sfx() -> void:
   	var scene_root: Node = get_tree().current_scene
   	if scene_root == null:
   		return
   	_death_sfx.reparent(scene_root)
   	# Idempotent: on_hit() could be re-entered before free; never double-connect.
   	if not _death_sfx.finished.is_connected(_death_sfx.queue_free):
   		_death_sfx.finished.connect(_death_sfx.queue_free)
   	_death_sfx.play()
   ```

5. **Weapon: the hit/kill-confirm seam.** On each projectile spawn, subscribe to its `hit`. On hit, emit `hit_confirmed`; if the struck body has a `died` signal, connect ONE_SHOT — **guarded by `is_connected`** so a multi-hit enemy that survives bullet 1 is not double-connected on bullet 2.

   ```gdscript
   signal hit_confirmed
   signal kill_confirmed

   # in _fire(), after instancing the projectile:
   projectile.hit.connect(_on_projectile_hit)


   func _on_projectile_hit(target: Node3D) -> void:
   	hit_confirmed.emit()
   	# Duck-typed kill detection: only targets with `died` trigger kill_confirmed;
   	# world geometry is silently ignored (godot-composition).
   	if target.has_signal("died"):
   		# SEAM: `died` proven present by has_signal; Node3D base has connect()/is_connected().
   		# Guard: CONNECT_ONE_SHOT only auto-disconnects AFTER `died` fires. A multi-hit enemy
   		# alive after hit 1 is still connected at hit 2 — connecting again throws "already
   		# connected" and aborts the projectile's despawn (stuck bullet). is_connected prevents it.
   		@warning_ignore("unsafe_method_access")
   		if not target.is_connected("died", _on_target_died):
   			target.connect("died", _on_target_died, CONNECT_ONE_SHOT)


   func _on_target_died(_enemy: Node) -> void:
   	kill_confirmed.emit()
   ```

6. **Wire SFX nodes + score listener.** Add `DeathSfx` (and any `HitSfx`) `AudioStreamPlayer` children to `enemy.tscn`. Connect the enemy's `died(enemy)` where score is tallied (e.g. a wave/score manager) and read `enemy.score_value` there. The HUD connects to the weapon's `hit_confirmed` / `kill_confirmed` for the hitmarker / kill cue.

7. **Gate + verify.** Run `tools/validate.sh` on the changed `.gd`, then `godot-verify` on the level (combat changes runtime behaviour — confirm it loads, renders, and a shot kills).

## Verification checklist

- [ ] Shooting a one-shot enemy (`health = 1`) kills it on the first hit: white flash → it disappears.
- [ ] A multi-hit enemy (`health = 3`) takes a red hit flash on the first two bullets and dies (white flash) on the third — and the third bullet does NOT hang in mid-air or log "Signal already connected".
- [ ] Every hit produces a hitmarker (weapon `hit_confirmed`); only the fatal hit produces the kill cue (`kill_confirmed`) — kill fires exactly once per enemy.
- [ ] The death sound plays in full even though the enemy node frees itself (reparented SFX outlives it).
- [ ] Shooting a wall produces neither `kill_confirmed` nor an `on_hit` error (duck-typed guards hold).
- [ ] A runner/tank with a base tint shows its tint again AFTER a non-fatal hit flash (saved overrides restored).
- [ ] Score increments by the killed enemy's `score_value` exactly once on death.
- [ ] `tools/validate.sh` passes with no weakened warning levels; `godot-verify` reports load + render.

## Error → Fix

| Symptom                                                                                                                                                                 | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Second bullet on a surviving multi-hit enemy throws "Signal already connected to given callable" and the bullet hangs in the air                                        | Per-hit `connect` to the enemy's `died` is not idempotent — `CONNECT_ONE_SHOT` only disconnects AFTER `died` fires, so a still-alive enemy stays connected. Guard: `if not target.is_connected("died", _on_target_died): target.connect("died", _on_target_died, CONNECT_ONE_SHOT)`. The unguarded throw aborts the projectile's `queue_free` (stuck bullet) — the guard is correctness, not log hygiene.                                                                                                                                                                                                                                                                                           |
| `kill_confirmed` fires several times for one enemy                                                                                                                      | Connecting without `CONNECT_ONE_SHOT`, or re-`hit.connect` per frame. Use `CONNECT_ONE_SHOT` on the `died` connection (guarded as above); connect `projectile.hit` once at spawn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Death sound is cut off the instant the enemy dies                                                                                                                       | The `AudioStreamPlayer` is freed with its owner. Reparent it to `get_tree().current_scene` before `queue_free()` and connect `finished → queue_free` (idempotently).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Cannot call method 'get_parent' on a previously freed instance` (or any method/property access) on a reparented SFX node on a LATER attack/hit                         | The reparent-to-survive-free pattern makes the SFX node OUTLIVE-then-PREDECEASE its owner: once reparented to the scene root with `finished → queue_free`, it frees itself on play-end while the owner (a multi-hit enemy, a repeat-attacker) lives on. The NEXT access to that `@onready` ref touches a freed instance. Guard EVERY later access — not just the connect — with `if is_instance_valid(_sfx):` before `.get_parent()`/`.play()`/any member. Applies to both the touch SFX (`perform_attack`) and the death SFX. (`is_instance_valid(enemy)` does NOT fix it — the freed object is the SFX node, not the enemy.)                                                                      |
| Only one mesh of a kitbash `.glb` enemy flashes (or none)                                                                                                               | Flashing `$Mesh` directly assumes a single `MeshInstance3D`. Walk `find_children("*", "MeshInstance3D", true, false)` and tint each (Make-Unique its material first).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| All enemies of a type flash when one is hit                                                                                                                             | Tinting a shared material resource. `duplicate()` the material and `set_surface_override_material(0, ...)` per instance before tinting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Runner/tank loses its tint after a non-fatal hit                                                                                                                        | `_flash_hit` overwrote the override without saving it. Save `get_surface_override_material(0)` per mesh before tinting and restore it in the tween callback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Shooting a wall errors on `on_hit()` / fires a phantom kill                                                                                                             | Missing duck-type guards. Projectile calls `on_hit()` only behind `has_method`; weapon connects `died` only behind `has_signal("died")`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Enemy never dies / `_health` ignores the export                                                                                                                         | `_health` not seeded from `health` in `_ready()` (`_health = health`), or `health` edited at runtime instead of the export default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `UNSAFE_METHOD_ACCESS` on `target.is_connected` / `target.connect`                                                                                                      | Duck-typed via `has_signal` — annotate the proven seam with `@warning_ignore("unsafe_method_access")`; do not widen warning levels (godot-code-rules).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A multi-phase Tween (e.g. a weapon-swing / view-model anim) only plays its first run, or all phases fire at once, or a rapid re-trigger starts from a corrupt transform | `set_parallel(true/false)` does NOT create sequential groups — it sets the mode for subsequently-added steps, so toggling it still fires everything together. Build sequential phases with chained `tween_property()` (sequential by default) and call `.parallel()` on the returned `PropertyTweener` for steps that run together. For a retriggerable view-model tween, kill the in-flight tween and snap the node back to its rest pos/rot BEFORE creating the new one, so overshoot (`TRANS_BACK`) doesn't corrupt the next start. (The `set_parallel(true)…set_parallel(false)` in `_flash_hit`/`_flash_and_die` above is correct: one parallel group, no sequential phases, not retriggered.) |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
