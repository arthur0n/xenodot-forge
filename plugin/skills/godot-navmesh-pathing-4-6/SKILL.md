---
name: godot-navmesh-pathing-4-6
agents: [godot-enemy, level-designer]
description: >-
  The Godot 4.6 navmesh + NavigationAgent3D INTEGRATION layer beneath
  `godot-enemy-ai` — the runtime-bake + nav-server-sync + entity-velocity-ordering
  gotchas that make an agent actually move in 4.6, where the editor "Bake
  NavigationMesh" silently ships an EMPTY mesh. Covers: baking at RUNTIME in the
  level `_ready()` via `NavigationRegion3D.bake_navigation_mesh()`;
  `NavigationServer3D.map_force_update()` (or deferring one physics frame) so a
  just-baked / just-spawned agent isn't dead on frame 1 with
  `is_navigation_finished()==true`; snapping a destination onto the mesh with
  `NavigationServer3D.map_get_closest_point()` so an off-mesh waypoint doesn't
  strand the agent (path of `[start]` only, `get_next_path_position()` returns the
  agent's own position); the one-tick path-compute race; throttled repath; and —
  when the entity's BASE class (e.g. a shared pushable base) owns `_physics_process`
  — advancing the FSM BEFORE `move_and_slide()` and composing nav velocity vs a
  knockback/impulse shove. Use when "enemies won't path / stand still", "navmesh
  not baking / empty navmesh in 4.6", "agent reports is_navigation_finished true on
  frame 1", "enemy freezes at spawn", "path is just [start]",
  "get_next_path_position returns my own position", "nav velocity gets overwritten
  to zero", "knockback vs nav fighting", "repath every frame", or "runtime-bake a
  level navmesh". NOT the node-FSM + perception STRUCTURE (that is `godot-enemy-ai`),
  NOT vision/hearing perception (`godot-stealth-perception`), NOT headless testing
  of pathing (`godot-enemy-ai-headless-smoke`). Layers under `godot-enemy-ai`;
  cross-refs `godot-enemy-archetype`, `godot-main-scene`.
---

# Godot 4.6 navmesh pathing (runtime bake + nav-server sync + entity integration)

`godot-enemy-ai` gives you the agent + node-FSM + perception and assumes two things that
**break in Godot 4.6**: that you "bake the `NavigationRegion3D` in the editor", and that the
agent is registered and on-mesh by the time a state sets a destination. In 4.6 the editor
bake silently ships an empty mesh, a runtime-spawned agent is unregistered on frame 1, an
off-mesh destination strands the agent, and an entity whose **base class** owns
`_physics_process` overwrites nav velocity before the FSM ever sets it. This skill is the
substrate that makes the agent actually move. Every snippet is the general shape for a
runtime-baked level plus a nav-driven enemy body.

## Requirements

- `godot-enemy-ai` — the agent / node-FSM / perception structure this layers UNDER. Read it
  first; this skill only adds the 4.6 integration gotchas (and corrects its "bake in editor"
  step, which is the 4.6 trap below).
- `godot-code-rules` — strict typed GDScript; no widened warning levels.
- A `NavigationRegion3D` in the level with a `NavigationMesh` assigned and its geometry source
  set (Godot 4.6 names `geometry_parsed_geometry_type` / `geometry_source_geometry_mode` — the
  un-prefixed Godot-3 names silently drop), even if unbaked at edit time — the runtime bake
  fills it.
- The level is registered through the main-scene host (`godot-main-scene`) so its `_ready()`
  runs and the runtime bake fires.

## The 4.6 navmesh truth (load-bearing)

- **Editor "Bake NavigationMesh" silently fails in 4.6** — the threaded bake does not flush
  polygon data into the `.tscn`, so you ship an EMPTY mesh. Every `NavigationAgent3D` then
  finds no path and the enemy stands still (but is still killable — hit/death run on
  collision layers, not nav). Runtime bake is the **source of truth**; do NOT rely on the
  editor bake.
- **Real pathing/detection is NOT assertable in a headless smoke** — that's a human-F5 gate (see
  `godot-enemy-ai-headless-smoke`). BUT the bake itself IS: the explicit-source bake above runs
  headless and produces real polygons, so a `polygon_count > 0` smoke catches the 0-polygon
  nested-host trap before F5. (The IMPLICIT `bake_navigation_mesh()` also bakes 0 polys headless —
  which is exactly why it hid the bug; assert on the explicit bake.)

## Steps

1. **Bake at RUNTIME in the level `_ready()` — with the LEVEL ROOT as the explicit
   source-geometry node.** NOT the bare `_nav_region.bake_navigation_mesh()`: that implicit call
   uses the **NavigationRegion3D node itself** as the geometry scan root, and in the default
   `SOURCE_GEOMETRY_ROOT_NODE_CHILDREN` mode it parses only the region's **own children**. When
   your level runs **nested under `Main/LevelHost`** (the normal case — `godot-main-scene`), not as
   the standalone main scene, the region's children are empty → **0 source geometry → 0 polygons →
   no navmesh**, the destination snaps to origin `(0,0,0)`, `path_size == 0`, and every enemy
   freezes (while `nav non-null`, `map_rid valid`, `is_target_reachable` all read true — the trap).
   A standalone `test_*.tscn` "works" only because it's F5'd as the main scene, where the floor IS
   a child of the scan root. **Parse explicitly with `self` (the level root) as the source node** so
   floor + walls + cover are always scanned:

   ```gdscript
   # levels/<level>.gd — runtime navmesh bake (editor bake ships EMPTY in 4.6;
   # the implicit bake_navigation_mesh() scans the wrong root when nested under LevelHost).
   @onready var _nav_region: NavigationRegion3D = $NavigationRegion3D

   func _ready() -> void:
   	if _nav_region == null or _nav_region.navigation_mesh == null:
   		return
   	var nm: NavigationMesh = _nav_region.navigation_mesh
   	var geo: NavigationMeshSourceGeometryData3D = NavigationMeshSourceGeometryData3D.new()
   	NavigationServer3D.parse_source_geometry_data(nm, geo, self)  # self = LEVEL ROOT, not the region
   	NavigationServer3D.bake_from_source_geometry_data(nm, geo)
   	_nav_region.navigation_mesh = nm                              # re-assign → server RID sees new polys
   	var map_rid: RID = _nav_region.get_navigation_map()
   	if map_rid.is_valid():
   		NavigationServer3D.map_force_update(map_rid)             # commit immediately (step 2)
   ```

   Set `geometry_parsed_geometry_type = STATIC_COLLIDERS` on the `NavigationMesh` for greybox
   (`StaticBody3D`+`BoxMesh`): it parses colliders, not visual meshes, so the bake reads no
   RenderingServer mesh data (no GPU stall) — and works headless (see the polygon-count gate in
   `godot-enemy-ai-headless-smoke`). Any new level that needs nav follows this pattern. The naive
   `bake_navigation_mesh()` is a one-line trap that cost a full day; do not teach or copy it.

2. **Make the nav map ready before a frame-1 agent reads it.** After a bake (or after spawning
   an agent at runtime) the `NavigationServer` has not committed the map; the agent reads
   `is_navigation_finished() == true` and never moves until something forces a path. Two proven
   cures:
   - **Force-commit:** `NavigationServer3D.map_force_update(map_rid)` right after the bake so the
     map is queryable that frame (wrap it in a small force-bake helper if several levels need it).
   - **Defer one physics frame:** set the first destination via `call_deferred`, or skip the
     finished-check for one tick (the one-tick wait, step 4) so the server gets its tick.

   Symptom this fixes: _"a spawned enemy stands still until the player gets close."_

3. **Snap every destination ONTO the mesh.** An off-mesh point (a waypoint a hair above the
   floor, a player on a ledge) yields a path of `[start]` only — `get_next_path_position()`
   returns the agent's own position and it never moves. Snap first (the enemy's
   `set_nav_destination`):

   ```gdscript
   func set_nav_destination(point: Vector3) -> void:
   	if _nav == null:
   		return
   	var map_rid: RID = _nav.get_navigation_map()
   	var nav_point: Vector3 = point
   	if map_rid.is_valid():
   		# Without this, a destination slightly off the baked mesh gives a [start]-only
   		# path and get_next_path_position() returns the enemy's own position.
   		nav_point = NavigationServer3D.map_get_closest_point(map_rid, point)
   	_nav.target_position = nav_point
   ```

4. **Drive movement; survive the one-tick race; throttle repath.** When `next_path_pos ==
global_position` the path is not resolved yet (or you're already there) — set zero velocity
   this tick and let the server resolve next frame (the enemy's `drive_nav_movement`):

   ```gdscript
   func drive_nav_movement(speed: float) -> void:
   	if _nav == null or _nav.is_navigation_finished():
   		return
   	var next_pos: Vector3 = _nav.get_next_path_position()
   	var dir: Vector3 = next_pos - global_position
   	dir.y = 0.0
   	if dir.length_squared() <= 0.0001:
   		_nav_desired_velocity = Vector3.ZERO   # path not yet resolved this tick; wait
   		return
   	dir = dir.normalized()
   	_nav_desired_velocity = dir * speed
   	_nav.velocity = dir * speed                # also feed the avoidance system
   ```

   Re-path the chase target on a THROTTLE (e.g. `REPATH_INTERVAL`), never every physics frame —
   per-frame `set_*_destination` on a moving target spikes CPU and stutters.

5. **Fix the entity-velocity ordering when a BASE class owns `_physics_process`.** If the base
   class runs `move_and_slide()` in its own `_physics_process`, the FSM child nodes run AFTER the
   parent — so nav velocity a state set arrives a frame late or is overwritten to zero (the enemy
   sets velocity but never moves). Override `_physics_process` on the entity, advance the FSM
   MANUALLY first, THEN compose velocity, THEN slide (the enemy's `_physics_process`):

   ```gdscript
   func _physics_process(delta: float) -> void:
   	if _fsm != null:
   		_fsm.advance(delta)              # FSM sets _nav_desired_velocity BEFORE we read it
   	if not is_on_floor():
   		velocity.y -= _gravity * delta
   	else:
   		velocity.y = 0.0
   	_impulse_velocity = _impulse_velocity.lerp(Vector3.ZERO, velocity_damping)
   	var horiz_impulse: float = Vector2(_impulse_velocity.x, _impulse_velocity.z).length()
   	if horiz_impulse > shove_threshold:  # being shoved → impulse WINS, don't fight the push
   		velocity.x = _impulse_velocity.x
   		velocity.z = _impulse_velocity.z
   	else:
   		velocity.x = _nav_desired_velocity.x
   		velocity.z = _nav_desired_velocity.z
   	move_and_slide()
   	_nav_desired_velocity = Vector3.ZERO   # reset: the enemy stops if the FSM set nothing this tick
   ```

   The avoidance callback (`_on_nav_velocity_computed`) refines `_nav_desired_velocity.x/z` —
   unless `horiz_impulse > shove_threshold`, in which case it bails so the shove is not fought.

6. **Promote the magic literals to archetype fields.** `REPATH_INTERVAL` (0.25) and the
   `shove_threshold` (the `0.5` horizontal-impulse cutoff, used twice) are tuning tech-debt →
   they belong on `EnemyArchetype` / an `@export`, not as bare literals in logic (data-driven
   rule).

7. **Silence `nav_debug` once movement is confirmed.** The enemy's `@export nav_debug` defaults
   `true` and prints `[NavDebug]` lines (path size, reachability, next-path-pos) — invaluable
   while an enemy is frozen, noise once it moves. Flip it `false` per instance.

## Verification checklist

- [ ] The level `_ready()` runtime-bakes (`bake_navigation_mesh()`); an editor-baked-only build
      leaves every enemy frozen. F5 → enemies walk.
- [ ] A just-spawned enemy moves within a frame or two, not only after the player approaches
      (nav map committed via `map_force_update` or a deferred first destination).
- [ ] A destination beside/above the mesh still resolves — `get_current_navigation_path().size()
  > 1`, `is_target_reachable()` true (snap works).
- [ ] Nav velocity survives to `move_and_slide` (the enemy moves) — not overwritten to zero by the
      base `_physics_process` (FSM advanced FIRST).
- [ ] A pull/push still flings the enemy (`apply_force` → impulse wins above `shove_threshold`);
      it resumes pathing after the impulse decays.
- [ ] No bare `0.25` / `0.5` tuning literals left in the state / enemy logic.
- [ ] You did NOT try to prove any of this in a headless smoke — bake/path are a human-F5 gate
      (`godot-enemy-ai-headless-smoke`).

## Error → Fix

| Symptom                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All enemies frozen — killable but never move, on a fresh level                                                                                    | Navmesh never baked: the 4.6 editor bake ships EMPTY. Runtime-bake in the level `_ready()` — but with the LEVEL ROOT as the explicit source node (next row), not the bare `bake_navigation_mesh()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Enemies frozen at origin: `target (0,0,0)`, `path_size 0`, yet `nav non-null` / `map_rid valid` / `is_target_reachable` all true; bake WAS called | The level runs nested under `Main/LevelHost`, and `_nav_region.bake_navigation_mesh()` scans only the NavigationRegion3D's own children (`SOURCE_GEOMETRY_ROOT_NODE_CHILDREN`) — empty → 0 polygons. Parse explicitly with the level root: `NavigationServer3D.parse_source_geometry_data(nm, geo, self)` + `bake_from_source_geometry_data(nm, geo)` + re-assign + `map_force_update`. A standalone `test_*.tscn` hides it (floor is a child of the scan root when F5'd as main scene). Add a `polygon_count > 0` headless gate (`godot-enemy-ai-headless-smoke`) — the naive headless bake also yields 0 polys, so without it every fix falsely "passes". |
| `is_navigation_finished()` reads `true` on frame 1; agent never moves                                                                             | Nav map not committed after bake/spawn. `NavigationServer3D.map_force_update(map_rid)` after the bake, OR defer the first `set_*_destination` one physics frame (`call_deferred`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Path is just `[start]`; `get_next_path_position()` == the agent's own position                                                                    | Destination is off the baked mesh. Snap it: `NavigationServer3D.map_get_closest_point(_nav.get_navigation_map(), point)` before `target_position`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Enemy sets a velocity but never moves; nav velocity ends up 0                                                                                     | A base class ran `move_and_slide()` before the FSM children. Override `_physics_process`, call `_fsm.advance(delta)` FIRST, then compose velocity + `move_and_slide()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Pull/push doesn't move the enemy, or the enemy rubber-bands while shoved                                                                          | Impulse below `shove_threshold` so nav overwrites it, or the threshold is too high. Compose: impulse wins above `shove_threshold`; promote the `0.5` literal to a field and tune.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Chase stutters / CPU spikes near the player                                                                                                       | Re-pathing every frame. Throttle with `REPATH_INTERVAL` (≈0.25s); do not `set_*_destination` every physics tick.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `[NavDebug]` spam floods the console                                                                                                              | The enemy's `@export nav_debug` defaults `true`. Flip it `false` on the enemy instances once movement is confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Enemy floats up / sinks through the floor while pathing                                                                                           | Gravity mixed into the nav direction. Keep `velocity.y` accumulated separately (as above); only X/Z come from the path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Parked (intentionally not built)

- Editor-side bake — broken in 4.6 (threaded flush); revisit only if the engine fixes it.
- `NavigationServer3D.map_force_update()` is DEPRECATED in 4.6 (Godot docs) but still functions and
  is the proven force-commit here; revisit if a future release removes it (defer-one-physics-frame
  is the fallback, step 2).
- Re-baking for dynamic/destructible geometry (bake cost per change), off-mesh links/jumps, and
  flying / full-3D-volume navigation — the agent here is floor-plane.

Layers under `godot-enemy-ai`; pairs with `godot-stealth-perception` (perception that triggers
the chase), `godot-enemy-archetype` (where the tuning lives), and `godot-enemy-ai-headless-smoke`
(what you can/can't test). Nav-server facts verified on Godot 4.6.
