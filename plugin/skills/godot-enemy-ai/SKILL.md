---
name: godot-enemy-ai
agents: [godot-enemy]
description: Build a patrolling/chasing enemy in Godot 4.6 from NATIVE nodes only — a baked NavigationRegion3D + NavigationAgent3D for 3D pathfinding/avoidance, a node-based StateMachine component (patrol → chase → attack) composed onto a CharacterBody3D, and a detection-radius + line-of-sight perception seam that flips patrol→chase. Use when adding an enemy/NPC/monster/guard that walks a route and reacts to the player, when an agent must path around walls to a moving target, when an enemy needs distinct behaviour states, when "patrol", "chase", "aggro", "detection range", or "line of sight" appears in a task, or when an enemy stands still / can't find a path / never aggroes. NO third-party AI addon, NO behaviour trees, NO Resource-FSM — node-FSM + native navigation server only.
---

# Godot Enemy AI (native nav + node FSM)

An enemy is two concerns that must stay separated: **where to walk** (pathfinding) and **what to do** (behaviour). We solve each with a native Godot node and **compose** them onto a `CharacterBody3D` rather than baking everything into one god-script — so the FSM is testable, states are addable, and the nav layer is swappable. Pathfinding is a baked `NavigationRegion3D` + a `NavigationAgent3D` child (the engine's own server — no addon, RVO avoidance for free). Behaviour is a node-based FSM: each state is its own `Node` child of a `StateMachine` component, states return the name of the next state, the machine swaps. Perception is the cheap part — a distance check plus one `RayCast3D` line-of-sight test decides when patrol hands off to chase. This matches composition-over-inheritance (component children, signals up / calls down) and stays inside strict typed GDScript.

## Requirements

- `godot-code-rules` — every `.gd` here is strict typed GDScript: line-1 path header, `class_name`, typed vars/returns, `tools/validate.sh` gate. Load it BEFORE writing any file below.
- `godot-composition` — the enemy is an engine-node base (`CharacterBody3D`) with component children (`StateMachine`, `NavigationAgent3D`); states call DOWN into the entity, the entity does not reach UP into states.
- A baked navigation surface in the level: a `NavigationRegion3D` whose `NavigationMesh` is baked over the walkable floor. Without a baked mesh the agent finds no path and the enemy stands still.
- The player node must be in the group `player` (Inspector → Node → Groups, or `add_to_group("player")`). The enemy finds its target by group, never by `class_name` — perception is a cross-entity gameplay boundary.
- Symmetrically, the enemy must register itself in its query group in `_ready()`
  (`add_to_group("enemies")`) — minimaps, target scans, and wave counters find it by group,
  never by `class_name`. An enemy alive in the tree but not in its group is invisible to every
  group query with no error.

## Project conventions

- Entity folder: `entities/enemy/` — `enemy.tscn` + `enemy.gd` (`class_name Enemy`). One scene per entity (CLAUDE.md naming).
- FSM component: `entities/enemy/state_machine/` — `state_machine.gd` (`class_name EnemyStateMachine`), `state.gd` (`class_name EnemyState`), one file per state (`patrol_state.gd`, `chase_state.gd`, `attack_state.gd`). Component scripts are reusable; keep them under the entity until a second enemy needs them.
- Scene tree (PascalCase node names):

  ```
  Enemy            (CharacterBody3D, enemy.gd)
  ├── Mesh         (MeshInstance3D — greybox capsule placeholder, never final art)
  ├── CollisionShape3D
  ├── NavigationAgent3D
  ├── EyeRay       (RayCast3D — line-of-sight probe, enabled=false, points at target each frame)
  ├── AttackTimer  (Timer, one_shot)
  ├── PatrolWaitTimer (Timer, one_shot)
  └── StateMachine (Node, state_machine.gd)
      ├── PatrolState (Node, patrol_state.gd)  ← set as initial_state
      ├── ChaseState  (Node, chase_state.gd)
      └── AttackState (Node, attack_state.gd)
  ```

- Waypoints: `Marker3D` nodes placed in the level scene (NOT under the enemy — they are world anchors). This project hand-authors `.tscn`, where a typed node-ref array (`Array[Marker3D]`) will NOT serialize — so `Enemy` exports `patrol_waypoint_paths: Array[NodePath]` and resolves them to a typed `patrol_waypoints: Array[Marker3D]` in `_ready()`.
- Gravity: read from `ProjectSettings` like the player does; accumulate `velocity.y` separately from nav direction (3D pitfall — see Error→Fix).
- This is a perspective-genre POC (FPS); the enemy renders inside the SubViewport rig like every other 3D entity. No camera work belongs in this skill.

## Steps

1. **Bake navigation in the level.** Add a `NavigationRegion3D` to the level scene, assign a `NavigationMesh`, set its agent radius/height to fit the enemy, and bake over the floor geometry (editor: select region → Bake NavigationMesh). Re-bake whenever the floor changes. Mesh is baked at edit time — do not bake every frame. **Keep the navmesh floor-only in a flat arena:** baking with mesh-instance geometry and no slope cutoff covers the TOPS of platforms and every wall/GridMap tile, so agents path up onto them with no walkable route back down (enemies stuck on platforms). Set `agent_max_slope` (~40°) on the bake and/or carve out the non-walkable elevated surfaces so only the floor plane ends up walkable (in this project's shipped navmesh every vertex sits on the floor at `y = 0.5`). **Hand-authoring the `NavigationMesh` sub_resource:** the Godot 4.6 property names are `geometry_parsed_geometry_type` and `geometry_source_geometry_mode` (NOT `parsed_geometry_type` / `source_geometry_mode` — the un-prefixed Godot-3 names silently drop; verify layer 1 catches them).

2. **State base class** — `entities/enemy/state_machine/state.gd`. Shared interface; the entity reference is injected by the machine.

   ```gdscript
   # entities/enemy/state_machine/state.gd — base class for one enemy behaviour state.
   class_name EnemyState
   extends Node
   ## Override the lifecycle hooks. physics_update returns the next state's
   ## node name to transition, or "" to stay.

   var enemy: Enemy
   var state_machine: EnemyStateMachine


   func enter() -> void:
   	pass


   func exit() -> void:
   	pass


   func physics_update(_delta: float) -> String:
   	return ""
   ```

3. **State machine component** — `entities/enemy/state_machine/state_machine.gd`. Indexes its `EnemyState` children by node name, injects `enemy`, drives the active state each physics frame, swaps on a returned name.

   ```gdscript
   # entities/enemy/state_machine/state_machine.gd — node-based FSM driving the active enemy state.
   class_name EnemyStateMachine
   extends Node

   @export var initial_state: EnemyState

   var current_state: EnemyState
   var _states: Dictionary[String, EnemyState] = {}


   func _ready() -> void:
   	var enemy_owner := owner as Enemy
   	for child in get_children():
   		if child is EnemyState:
   			var state := child as EnemyState
   			_states[state.name] = state
   			state.enemy = enemy_owner
   			state.state_machine = self
   	if initial_state != null:
   		current_state = initial_state
   		current_state.enter()


   func _physics_process(delta: float) -> void:
   	if current_state == null:
   		return
   	var next := current_state.physics_update(delta)
   	if next != "":
   		transition_to(next)


   func transition_to(state_name: String) -> void:
   	if not _states.has(state_name):
   		push_error("EnemyStateMachine: unknown state '%s'" % state_name)
   		return
   	current_state.exit()
   	current_state = _states[state_name]
   	current_state.enter()
   ```

4. **Enemy entity** — `entities/enemy/enemy.gd`. Owns movement, gravity, the nav agent, perception helpers, and the attack hook. States call DOWN into these methods; the enemy never reaches into a state. Movement runs here (not in the FSM `_physics_process`) so gravity and `move_and_slide()` happen once per frame regardless of state.

   ```gdscript
   # entities/enemy/enemy.gd — CharacterBody3D enemy: native nav movement + perception, driven by its StateMachine.
   class_name Enemy
   extends CharacterBody3D

   @export var move_speed: float = 3.5
   @export var patrol_speed: float = 1.75
   @export var detect_range: float = 12.0
   @export var attack_range: float = 1.8
   @export var escape_range: float = 16.0
   @export var attack_cooldown: float = 0.8
   @export var patrol_wait: float = 1.0
   # Hand-authored .tscn can't serialize a typed node-ref array (Array[Marker3D]);
   # export NodePaths and resolve to typed nodes in _ready().
   @export var patrol_waypoint_paths: Array[NodePath] = []
   var patrol_waypoints: Array[Marker3D] = []

   # SEAM: ProjectSettings.get_setting() returns Variant; explicit float(...) conversion still needs @warning_ignore —
   # the ignore moves from unsafe_cast (the old `as float` form) to unsafe_call_argument, it is NOT eliminated.
   @warning_ignore("unsafe_call_argument")
   var _gravity: float = float(ProjectSettings.get_setting("physics/3d/default_gravity"))
   @onready var _nav: NavigationAgent3D = $NavigationAgent3D
   @onready var _eye: RayCast3D = $EyeRay
   @onready var attack_timer: Timer = $AttackTimer
   @onready var patrol_wait_timer: Timer = $PatrolWaitTimer


   func _ready() -> void:
   	attack_timer.wait_time = attack_cooldown
   	attack_timer.one_shot = true
   	patrol_wait_timer.wait_time = patrol_wait
   	patrol_wait_timer.one_shot = true
   	for path in patrol_waypoint_paths:
   		var node := get_node_or_null(path)
   		if node is Marker3D:
   			patrol_waypoints.append(node as Marker3D)
   	_nav.velocity_computed.connect(_on_nav_velocity_computed)


   # ── Perception (called by states) ──────────────────────────────────────────
   func target() -> Node3D:
   	return get_tree().get_first_node_in_group("player") as Node3D


   func distance_to_target() -> float:
   	var t := target()
   	if t == null:
   		return INF
   	return global_position.distance_to(t.global_position)


   func can_see_target() -> bool:
   	var t := target()
   	if t == null:
   		return false
   	_eye.target_position = _eye.to_local(t.global_position)
   	_eye.force_raycast_update()
   	# Clear line of sight = the ray hits nothing (no wall between eye and target).
   	return not _eye.is_colliding()


   # ── Navigation (called by states) ──────────────────────────────────────────
   func set_destination(point: Vector3) -> void:
   	_nav.target_position = point


   func navigation_finished() -> bool:
   	return _nav.is_navigation_finished()


   ## Drive one frame toward the current nav target at `speed`. Call from a state's
   ## physics_update; gravity + move_and_slide run here every frame.
   func move_along_path(speed: float, delta: float) -> void:
   	var desired := Vector3.ZERO
   	if not _nav.is_navigation_finished():
   		var next := _nav.get_next_path_position()
   		desired = (next - global_position)
   		desired.y = 0.0
   		desired = desired.normalized() * speed
   	# Hand horizontal intent to the avoidance system; keep vertical for gravity.
   	if not is_on_floor():
   		velocity.y -= _gravity * delta
   	desired.y = velocity.y
   	_nav.velocity = desired


   func stop(delta: float) -> void:
   	if not is_on_floor():
   		velocity.y -= _gravity * delta
   	velocity.x = 0.0
   	velocity.z = 0.0
   	move_and_slide()


   func _on_nav_velocity_computed(safe_velocity: Vector3) -> void:
   	velocity = safe_velocity
   	move_and_slide()


   # ── Attack hook (called by AttackState) ─────────────────────────────────────
   func perform_attack() -> void:
   	# Replace with real attack (animation, hitbox, damage signal up to the level).
   	pass
   ```

5. **PatrolState** — `entities/enemy/state_machine/patrol_state.gd`. Walks the waypoint loop at half speed, pauses at each via `PatrolWaitTimer`, and hands off to chase when the target is in range AND visible. **One-tick nav race (this bit a real build):** `NavigationAgent3D.is_navigation_finished()` returns `true` on the SAME physics frame `target_position` is set — the server needs one tick to compute the path. A state that sets a destination in `enter()` then checks `navigation_finished()` next frame reads a false "already arrived", starts its wait timer, advances waypoints, and loops forever without moving. Guard with a `_destination_just_set` flag: set it in `_go_to_current()`, and on the next physics frame skip the finished-check and call `move_along_path` instead — give the server its tick. **Runtime-spawn variant (also bit a real build):** when the enemy is instanced and `add_child()`'d at runtime (e.g. by a wave manager), its `NavigationAgent3D` is NOT yet registered with the nav server on the frame `StateMachine._ready()` runs the first `enter()` — so even the one-frame guard isn't enough; the next-frame `is_navigation_finished()` still reads `true` (agent unregistered, no path) and the enemy idles in the wait-loop until detection/chase retries on its throttle (symptom: a spawned enemy stands still until the player gets close). Defer the first destination call itself — `_go_to_current.call_deferred()` inside `enter()` — buying one extra frame so the agent registers before its navigation-finished state is read.

   ```gdscript
   # entities/enemy/state_machine/patrol_state.gd — walk the waypoint loop; hand off to chase on sight.
   class_name PatrolState
   extends EnemyState

   var _index: int = 0
   var _waiting: bool = false
   var _timer_connected: bool = false
   # Guard: NavigationAgent3D.is_navigation_finished() returns true on the SAME physics
   # frame target_position is set (the nav server needs one tick to compute the path).
   # Skip the finished check for one frame after each set_destination() call, else the
   # enemy reads a false "already arrived", starts the wait timer, and never moves.
   var _destination_just_set: bool = false


   func enter() -> void:
   	_waiting = false
   	_go_to_current()


   func exit() -> void:
   	if _timer_connected:
   		enemy.patrol_wait_timer.timeout.disconnect(_on_wait_done)
   		_timer_connected = false


   func physics_update(delta: float) -> String:
   	if enemy.distance_to_target() <= enemy.detect_range and enemy.can_see_target():
   		return "ChaseState"
   	if enemy.patrol_waypoints.is_empty() or _waiting:
   		enemy.stop(delta)
   		return ""
   	# One-tick nav race: the frame after set_destination() the path is not yet computed,
   	# so navigation_finished() lies. Give the server its tick — move, don't wait-check.
   	if _destination_just_set:
   		_destination_just_set = false
   		enemy.move_along_path(enemy.patrol_speed, delta)
   		return ""
   	if enemy.navigation_finished():
   		_start_wait()
   		enemy.stop(delta)
   		return ""
   	enemy.move_along_path(enemy.patrol_speed, delta)
   	return ""


   func _start_wait() -> void:
   	# physics_update is SYNC (returns String) — never await here. Wait on the Timer via a
   	# signal-connected callback plus the _waiting guard instead.
   	if _waiting:
   		return
   	_waiting = true
   	if not _timer_connected:
   		enemy.patrol_wait_timer.timeout.connect(_on_wait_done)
   		_timer_connected = true
   	enemy.patrol_wait_timer.start()


   func _on_wait_done() -> void:
   	_waiting = false
   	_index = (_index + 1) % enemy.patrol_waypoints.size()
   	_go_to_current()


   func _go_to_current() -> void:
   	if enemy.patrol_waypoints.is_empty():
   		return
   	enemy.set_destination(enemy.patrol_waypoints[_index].global_position)
   	_destination_just_set = true
   ```

6. **ChaseState** — `entities/enemy/state_machine/chase_state.gd`. Re-targets the player on a throttle timer (not every frame — see pitfalls), drives full-speed pursuit, and branches to attack (in range) or back to patrol (escaped).

   ```gdscript
   # entities/enemy/state_machine/chase_state.gd — pursue the player; branch to attack or back to patrol.
   class_name ChaseState
   extends EnemyState

   const REPATH_INTERVAL: float = 0.25

   var _repath_accum: float = 0.0
   # Same one-tick nav race as PatrolState: skip the move for one frame after a repath so
   # the server can compute the path before move_along_path reads get_next_path_position().
   var _destination_just_set: bool = false


   func enter() -> void:
   	_repath_accum = REPATH_INTERVAL  # repath immediately on entry


   func physics_update(delta: float) -> String:
   	var dist := enemy.distance_to_target()
   	if dist >= enemy.escape_range or not enemy.can_see_target():
   		return "PatrolState"
   	if dist <= enemy.attack_range:
   		return "AttackState"
   	# Throttle target updates: cheap, avoids per-frame path recompute on a moving target.
   	_repath_accum += delta
   	if _repath_accum >= REPATH_INTERVAL:
   		_repath_accum = 0.0
   		var t := enemy.target()
   		if t != null:
   			enemy.set_destination(t.global_position)
   			_destination_just_set = true
   	# Give the nav server its tick after a fresh destination before moving.
   	if _destination_just_set:
   		_destination_just_set = false
   		return ""
   	enemy.move_along_path(enemy.move_speed, delta)
   	return ""
   ```

7. **AttackState** — `entities/enemy/state_machine/attack_state.gd`. Holds position, fires the attack on the cooldown timer, returns to chase when the target steps out of attack range.

   ```gdscript
   # entities/enemy/state_machine/attack_state.gd — stand and attack on cooldown; resume chase when target leaves range.
   class_name AttackState
   extends EnemyState


   func enter() -> void:
   	_try_attack()


   func physics_update(delta: float) -> String:
   	enemy.stop(delta)
   	if enemy.distance_to_target() > enemy.attack_range:
   		return "ChaseState"
   	_try_attack()
   	return ""


   func _try_attack() -> void:
   	if enemy.attack_timer.is_stopped():
   		enemy.perform_attack()
   		enemy.attack_timer.start()
   ```

8. **Wire the scene.** Build `enemy.tscn` matching the tree above. On `EyeRay` set `enabled = false` (we drive it manually with `force_raycast_update`) and its collision mask to the world/wall layer (so walls block sight but the player does not register as a wall). Set `StateMachine.initial_state` to `PatrolState` in the Inspector. Place `Marker3D` waypoints in the level and assign their `NodePath`s to the enemy's `patrol_waypoint_paths` (NOT a typed node array — that doesn't serialize in hand-authored `.tscn`; the enemy resolves them in `_ready()`). Confirm the level has a baked `NavigationRegion3D` and the player is in group `player`. **Spawn markers (runtime-spawned enemies):** each `Marker3D` an enemy spawns at must sit on the walkable navmesh, on open floor, clear of overhead/embedded geometry — a marker placed under or inside elevated geometry embeds the spawned body in the mesh and physics ejects it upward onto a platform. **Spawning a batch of enemies at once:** pick a DISTINCT marker per enemy within one batch — track markers already claimed this batch (an `_occupied_markers` array) and exclude them from the pool for the next pick, with a graceful fallback (clear the list + use the farthest) when the batch is larger than the marker count. Two `CharacterBody3D` enemies placed at one marker spawn at the same world position; physics ejects them apart, one `NavigationAgent3D` lands off the navmesh, and `is_navigation_finished()` never clears — the enemy freezes (looks like it never spawned). The same overlap happens when you re-seed: `queue_free()` is deferred, so old bodies still occupy physics space the frame you spawn replacements — clear the per-batch occupancy and place the new batch at distinct free markers so they do not spawn into the not-yet-freed bodies.

9. **Validate and verify.** Run `tools/validate.sh` (gate) for the new `.gd` files, then run `godot-verify` on the level scene to confirm it loads and renders with the enemy present.

## Verification checklist

- [ ] Enemy walks its waypoint loop, pausing briefly at each `Marker3D`, on a closed circuit (returns to the first after the last).
- [ ] Walking the player into `detect_range` with clear sight flips the enemy to chase — it turns and pursues.
- [ ] The chasing enemy paths AROUND a wall/obstacle between it and the player (proves the navmesh, not a straight-line move).
- [ ] Standing behind a wall (in range but no line of sight) does NOT trigger chase; stepping into the open does.
- [ ] At `attack_range` the enemy stops and `perform_attack()` fires no faster than `attack_cooldown` (visible once you add a real attack/print).
- [ ] Running away past `escape_range` (or breaking sight) returns the enemy to patrol from its current position.
- [ ] Enemy stays on the floor — no floating, no sinking through it — while moving.
- [ ] `tools/validate.sh` passes with no weakened warning levels; `godot-verify` reports the level loads and renders.

## Error → Fix

| Symptom                                                                                            | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enemy never moves, stays at spawn                                                                  | Navigation mesh not baked, or the spawn is off the navmesh. Bake the `NavigationRegion3D` over the floor; confirm the enemy stands on the baked surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Enemies present and killable but completely frozen — on ONE level only, fine on others             | That level has NO `NavigationRegion3D` / no baked navmesh at all, so every `NavigationAgent3D` finds no path and never moves; hit/death/kill-confirm run on collision-layer signals independent of nav, hence still killable. Signature of a level that shipped nav-less. The level builder must produce the `NavigationRegion3D` itself (load `<level>_navmesh.tres`) — do not hand-add it to the baked `.tscn` (regenerates away); see `godot-gridmap-level`. Assert `NavigationRegion3D` presence in that level's verify (godot-gridmap-level actor-inventory list).                                                           |
| Enemy floats upward or sinks into the floor                                                        | Gravity mixed into the nav direction. Keep `velocity.y` accumulated separately (as in `move_along_path`); only X/Z come from the path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Enemy cycles all waypoints with 1s pauses but never moves horizontally                             | The same-tick nav race: `is_navigation_finished()` returns `true` on the SAME physics frame `target_position` is set (server needs one tick to compute the path). PatrolState's `enter()` set the destination, next frame read a false "arrived", waited, advanced, looped. Add a `_destination_just_set` flag (set it in `_go_to_current`), and the frame after each `set_destination` skip the finished-check and call `move_along_path` instead. ChaseState needs the same guard around its repath block.                                                                                                                      |
| Path is empty on the very first frame                                                              | Nav map not ready when `target_position` was set. Set destinations from `enter()`/after `_ready`, not before the first physics frame. Distinct from the row above: this is "no path yet"; that one is "finished() lies the same tick you set the target". Both are cured by skipping one physics frame after a destination is set.                                                                                                                                                                                                                                                                                                |
| Enemy can't fit through a doorway / corridor                                                       | Agent radius too large. Lower the `NavigationAgent3D.radius` and the navmesh bake agent radius to under half the narrowest gap, then re-bake.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Enemy aggroes through solid walls                                                                  | `can_see_target` ray mask wrong. Set `EyeRay.collision_mask` to the wall/world layer so walls block the ray; ensure the player is NOT on that layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Chase stutters / CPU spikes near the player                                                        | Re-pathing every frame. Keep the `REPATH_INTERVAL` throttle in ChaseState; do not call `set_destination` every physics tick.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Avoidance jitter when near other agents                                                            | Raise `NavigationAgent3D.time_horizon_agents` (try 2–4 s) or lower `move_speed` slightly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `transition_to` logs "unknown state"                                                               | The returned string must match a state child's NODE NAME exactly (e.g. `"ChaseState"`). Rename the node or the returned literal so they match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| State swaps but movement never happens                                                             | Movement lives on the entity, not the FSM. A state must call `enemy.move_along_path(...)` / `enemy.stop(...)` each `physics_update`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `await` in a state → "Trying to call an async function without await"                              | `physics_update` is synchronous (returns `String`). Never `await` inside it. Wait on a `Timer` via a signal-connected callback (`timeout.connect(_on_wait_done)`) plus a `_waiting` guard, as in PatrolState.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hand-authored `NavigationMesh` properties silently dropped                                         | Use the Godot 4.6 names `geometry_parsed_geometry_type` / `geometry_source_geometry_mode`, NOT `parsed_geometry_type` / `source_geometry_mode`. Verify layer 1 catches the wrong names.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `patrol_waypoints` empty after loading a hand-authored `.tscn`                                     | A typed node-ref array (`Array[Marker3D]`) doesn't serialize by hand. Export `patrol_waypoint_paths: Array[NodePath]`, assign the marker NodePaths, and resolve to `Array[Marker3D]` in `_ready()`.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A runtime-spawned enemy idles at its spawn until the player gets close                             | Runtime-spawn nav-registration delay: an enemy `add_child()`'d at runtime has its `NavigationAgent3D` unregistered on the frame the first `enter()` runs, so `is_navigation_finished()` reads `true` and it waits forever until detection retries. Distinct from the same-tick race — the one-frame `_destination_just_set` guard is not enough. Defer the first destination call itself: `_go_to_current.call_deferred()` in `PatrolState.enter()`, buying one extra frame for the agent to register.                                                                                                                            |
| Re-seeded / batch-spawned enemies stand still, don't appear, or won't chase                        | Two enemies spawned at the same world position (a batch picked the same marker twice, or replacements spawned into not-yet-freed bodies because `queue_free()` is deferred). Overlapping `CharacterBody3D`s are ejected apart, one `NavigationAgent3D` ends up off the navmesh, and `is_navigation_finished()` never clears. Pick a DISTINCT marker per enemy per batch (per-batch `_occupied_markers` exclusion + farthest fallback), and clear that occupancy on re-seed so replacements take distinct free markers. Compounded by the runtime-spawn nav-registration delay (row above) — apply that `call_deferred()` fix too. |
| Spawner/manager node's exports vanish, nothing spawns                                              | A seam typing the player as `Node3D` (per `godot-composition`) called `player.get_rid()` — that method is on `CollisionObject3D`, so under strict typing it's an `unsafe_method_access` parse error that silently drops the whole script's exports. Drop the redundant raycast `exclude` entirely when the player is on a different collision layer than the ray's mask (the ray can't hit the player anyway) — `query.exclude = []`.                                                                                                                                                                                             |
| Enemies get stuck on top of platforms / wall tiles                                                 | Navmesh baked over elevated geometry: with mesh-instance geometry and no slope cutoff the bake covers platform tops and wall tiles, routing agents up with no walkable path down. Set `agent_max_slope` (~40°) on the bake and/or strip the elevated polygons so only the floor plane is walkable (floor-only navmesh).                                                                                                                                                                                                                                                                                                           |
| Spawned enemy launches up onto a platform / clips into geometry                                    | Spawn marker placed under or inside elevated geometry — the body spawns embedded in the mesh and physics ejects it upward. Move the `Marker3D` onto open floor that sits on the walkable navmesh, clear of overhead/embedded geometry.                                                                                                                                                                                                                                                                                                                                                                                            |
| Enemy never sees the player / never aggroes, no error                                              | Group-name string mismatch. The player is added with one literal but looked up with another — group names are case-sensitive string contracts. The canonical player group is `player` (lowercase); `add_to_group`, `is_in_group`, and `get_first_node_in_group` must use the EXACT same literal in every file (builder, `wave_manager.gd`, `enemy.gd`, the level body check). A mismatch (`"Player"` vs `"player"`) is a silent no-match, never a parse error — `get_first_node_in_group` just returns `null`. Grep all group literals after any spawn/wiring refactor.                                                           |
| Per-mesh visual effect (flash/tint) breaks after swapping the greybox `$Mesh` for a sourced `.glb` | The greybox `$Mesh` is one `MeshInstance3D`; a kitbash `.glb` is a `Node3D` wrapper with many `MeshInstance3D` children. Type `@onready _mesh: Node3D = $Mesh` and apply per-mesh effects to every `find_children("*", "MeshInstance3D", true, false)` descendant (Make-Unique each material first), not to `$Mesh` directly.                                                                                                                                                                                                                                                                                                     |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
