---
name: godot-enemy-ai-headless-smoke
agents: [godot-enemy, bug-triage, godot-playtester]
description: >-
  How to TEST a Godot enemy AI when `--headless` has no RenderingDevice and doesn't
  sync `Area3D` overlaps — so you CANNOT assert real pathing, vision-cone detection,
  or hearing headless, and a "does the enemy chase?" headless test can NEVER pass. The
  one nav fact you CAN assert headless: the runtime navmesh BAKE produced polygons
  (`get_polygon_count() > 0`) — catching the nested-host 0-polygon trap that silently
  passes every gate. The split: assert the FSM transition LOGIC in isolation (build
  `EnemyFSM` by hand with no scene tree, inject timer state, call
  `advance()` / `_physics_process(dt)`, assert `current_state.name`), assert the
  archetype `.tres` load + field round-trip, and assert `take_damage` →
  `_current_health` decrement → `died` + `queue_free` — all pure logic/data. Leave
  real path / see / hear to an in-editor / windowed F5 AFTER a human (or runtime)
  navmesh bake: a hard gate, not a CI assert. The pattern is
  `tools/smoke_enemy_ai.gd` + `tools/smoke_enemy_health.gd`. Use when "my enemy AI
  test is failing / hangs", "test the enemy FSM", "headless smoke for enemy AI",
  "assert patrol→aggro→search transitions", "can I test pathing headless", "navmesh
  won't bake in the test", "vision cone test never detects", or "what can I actually
  test without a window". NOT the general headless-smoke template (that is
  `godot-runtime-smoke` — this is its enemy-AI-specific companion), NOT the BUILD of
  the AI (`godot-enemy-ai` / `godot-stealth-perception` / `godot-navmesh-pathing-4-6`).
---

# Godot enemy-AI headless smoke (what you can and can't assert)

Enemy AI is the worst case for headless testing: three load-bearing systems — actual navmesh
PATHING, `VisionCone3D` detection, `HearingArea` overlap — are exactly the ones `--headless`
can't run (no `RenderingDevice`, no synchronous `Area3D` overlap). The trap is writing a "does the
enemy chase the player?" headless test that can never go green, then fighting it. The fix is to
SPLIT: assert the FSM **logic** headless (it's pure state math), assert the navmesh **bake produced
polygons** headless (the explicit-source bake DOES run under the dummy renderer — the one nav fact
you get, and the one whose absence let a 0-polygon bake hide a day-long bug), and leave actual
path/see/hear to a human F5. The pattern uses `tools/smoke_enemy_ai.gd`,
`tools/smoke_enemy_health.gd`, and `tools/smoke_nav_bake.gd`, consistent with the
`godot-runtime-smoke` headless caveat.

## Requirements

- `godot-runtime-smoke` — the general `extends SceneTree` headless-smoke pattern + the headless
  caveat (no `RenderingDevice`; headless physics doesn't sync two-node overlap in a few frames).
  This skill is its enemy-AI specialization; read it first.
- The FSM must be constructible WITHOUT a full scene — states as plain nodes, transitions driven
  by `trigger_*` methods + timer state — so it can be exercised in isolation (a test seam).

## The split (load-bearing — do NOT cross it)

- **CAN assert headless** (pure logic / data; no render, no bake, no overlap):
  - FSM transitions: Patrol → Aggro → Alert → Search → Patrol, plus re-acquire.
  - Archetype `.tres` load + every field value (FOV, ranges, speeds, timers) round-trips.
  - `take_damage` → `_current_health` decrement → `died` signal + `queue_free`; hits accumulate.
- **CAN assert headless — the navmesh BAKE produced polygons** (the one nav fact that IS
  headless-testable, and whose absence hid a day-long bug):
  - Load the real level `.tscn`, `add_child` it (runs `_ready()`, which runtime-bakes), then read
    `nav_region.navigation_mesh.get_polygon_count() > 0`. The explicit-source bake
    (`godot-navmesh-pathing-4-6` step 1) parses static colliders and runs fine under the dummy
    renderer. This is the `tools/smoke_nav_bake.gd` pattern (assert a known-good poly count > 0,
    not 0).
  - This catches the **nested-host 0-polygon trap**: `bake_navigation_mesh()` scans only the
    region's own children when the level loads under `Main/LevelHost`, silently baking 0 polys.
    The NAIVE bake ALSO bakes 0 polys headless — so without this assert every wiring fix falsely
    "passes" and the enemy is still frozen at F5. Assert on the EXPLICIT-source bake.
- **CANNOT assert headless** (needs a window / settled overlap):
  - An enemy actually PATHING to the player — the baked mesh exists, but the agent's path query +
    `move_and_slide` arrival need physics + a settled map; that's still F5.
  - `VisionCone3D.body_sighted` firing — needs the addon's render/physics.
  - `HearingArea` overlap — headless doesn't sync `Area3D` overlap in a handful of frames.

  These are a windowed / in-editor **F5 after a (human or runtime) bake** — a hard gate.

## Steps

1. **Test the FSM in isolation — build it by hand, no scene tree** (the `smoke_enemy_ai.gd`
   pattern):

   ```gdscript
   # tools/smoke_enemy_ai.gd — headless FSM-logic smoke. extends SceneTree.
   func _check_fsm_transitions() -> void:
   	var fsm := EnemyFSM.new()
   	var patrol := PatrolState.new()
   	var aggro := AggroState.new()
   	# … add states as children, name them, set the initial state …
   	fsm.trigger_aggro()
   	fsm._physics_process(0.016)
   	_assert(fsm.current_state.name == "AggroState", "trigger_aggro -> AggroState")
   ```

   INJECT timer state directly (set the deaggro/search elapsed) instead of sleeping real seconds,
   then assert the next `current_state.name`. Drive the WHOLE sequence — `trigger_aggro` → Aggro,
   `trigger_lost` → Alert, (deaggro expire) → Search, (search expire) → Patrol, then re-acquire —
   not just one hop.

2. **Test archetype data round-trips.** `load()` the `.tres`, assert each field (FOV, ranges,
   speeds, timers) equals the authored value. Catches a renamed or silently-dropped field.

3. **Test health / damage** (the `smoke_enemy_health.gd` pattern): `take_damage()` reduces
   `_current_health`; reaching 0 emits `died` and calls `queue_free()`; multiple hits accumulate.

4. **DO assert the navmesh BAKED (`polygon_count > 0`); do NOT assert pathing / detection.** Load
   the real level `.tscn`, `add_child` it so its `_ready()` runtime-bake runs, then assert
   `nav_region.navigation_mesh.get_polygon_count() > 0` — the `tools/smoke_nav_bake.gd` pattern.
   This is the ONE nav signal you get headless, and it catches the nested-host 0-polygon trap:

   ```gdscript
   # tools/smoke_nav_bake.gd — headless: the level _ready() must bake a non-empty navmesh.
   func _check() -> bool:
   	var inst: Node = (load("res://levels/<level>.tscn") as PackedScene).instantiate()
   	get_root().add_child(inst)   # runs _ready() → the explicit-source bake
   	var nav := inst.get_node("NavigationRegion3D") as NavigationRegion3D
   	var ok := nav.navigation_mesh.get_polygon_count() > 0  # 0 = nested-host scan-root trap
   	inst.queue_free()
   	return ok
   ```

   Then STOP at the bake: no `body_sighted` assert, no `get_overlapping_bodies` assert, no
   "enemy reached the player" assert — those read empty/zero and either FALSELY pass or hang. If you
   must drive a destination, assert the CODE PATH (`set_nav_destination` snapped the point), not
   "did it arrive". (The naive `bake_navigation_mesh()` also bakes 0 polys headless — so assert on
   the explicit-source bake from `godot-navmesh-pathing-4-6`, or the gate is blind to the very trap
   it should catch.)

5. **Name the human-F5 gate explicitly.** Real chase/see/hear acceptance passes only after a
   human bakes — or the level runtime-bakes (`godot-navmesh-pathing-4-6`) and you F5. State it in
   the slice; never block CI on it.

6. **`tools/` is plugin-materialized.** Like `godot-runtime-smoke`: don't hand-edit
   `tools/validate.sh` in the game repo (gitignored + overwritten on re-materialization); report
   the wiring to the verifier. A `smoke_*.gd` glob auto-joins the gate; each script self-reports
   pass/fail and sets the exit code (0 = pass, 1 = any fail).

## Verification checklist

- [ ] `godot --headless --path . --script tools/smoke_enemy_ai.gd` prints pass/fail and exits 0;
      deliberately break one transition → it prints `FAIL` and exits 1. (A smoke that can't fail
      proves nothing.)
- [ ] The FSM smoke drives the FULL sequence (patrol→aggro→alert→search→patrol + re-acquire), not
      a single hop.
- [ ] A `smoke_nav_bake.gd`-style smoke asserts `get_polygon_count() > 0` after the level `_ready()`
      bake (catches the nested-host 0-polygon trap); break the bake → it exits 1.
- [ ] No `body_sighted` / `get_overlapping_bodies` / "enemy reached the player" assert lives in any
      enemy `smoke_*.gd` (the bake-polygon assert is the ONLY nav assert that belongs headless).
- [ ] The archetype smoke fails if you rename a field; the health smoke fails if `died` never emits.
- [ ] "Enemy chases / sees / hears" is documented as a human-F5-after-bake gate, NOT a headless
      assert.

## Error → Fix

| Symptom                                                                                                      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enemy-AI test hangs forever / runs away with no output                                                       | An unbounded `await` on `bake_finished` or a never-firing overlap. Don't `await` the bake — run the SYNCHRONOUS explicit-source bake in the level `_ready()` and read `get_polygon_count()` after `add_child`, or bound any awaited engine signal with a frame timeout (`godot-runtime-smoke`).                                                                                                                      |
| Test asserts "enemy reached the player" and always fails                                                     | ARRIVAL is a human-F5 gate (path query + physics need a window). Assert instead: the bake produced polygons (`get_polygon_count() > 0`), the FSM state, and that `set_nav_destination` was called — not arrival.                                                                                                                                                                                                     |
| `body_sighted` / `noise_heard` never fires in the test                                                       | `VisionCone3D` and `HearingArea` need render/physics + settled overlap; not headless-testable. Move detection to F5.                                                                                                                                                                                                                                                                                                 |
| FSM smoke is green but the real enemy does nothing in game                                                   | The LOGIC is fine; the failure is bake/perception — navmesh didn't bake (`godot-navmesh-pathing-4-6`), player not in group `"player"`, or `emit_noise` un-wired (`godot-stealth-perception`). FSM/perception failures are F5 — but a 0-polygon BAKE is catchable headless (next row).                                                                                                                                |
| Every nav wiring fix "passes" the gate but the enemy is still frozen at F5 (`target (0,0,0)`, `path_size 0`) | The gate never asserted the bake produced polygons. The level's `bake_navigation_mesh()` scans only the region's children when nested under `LevelHost` → 0 polys; the naive headless bake ALSO yields 0, so the gate was structurally blind. Add a `polygon_count > 0` smoke that loads the `.tscn`, `add_child`s it (runs the `_ready()` explicit-source bake), and asserts polys > 0 (`tools/smoke_nav_bake.gd`). |
| FSM can't be built without a full scene                                                                      | A state reaches into scene-only nodes in `enter()`. Keep state logic driven by `trigger_*` + timer state so the FSM is unit-constructible (the test seam).                                                                                                                                                                                                                                                           |

## Parked (intentionally not built)

- A windowed / Xvfb nav+detection integration run (deferred for the POC — the human F5 covers it).
- A navigability bot driving a `NavigationAgent3D` to a reachable point — `godot-runtime-smoke`'s
  nav-smoke variant works headless for the PLAYER controller (physics+nav run under the dummy
  renderer), but enemy DETECTION (cone/hearing) still needs a window.

The enemy-AI companion to `godot-runtime-smoke`; pairs with `godot-enemy-ai`,
`godot-navmesh-pathing-4-6`, and `godot-stealth-perception` (the systems whose logic this tests
and whose physics/render it deliberately can't). Verified on Godot 4.6.
