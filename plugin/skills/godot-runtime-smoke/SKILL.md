---
name: godot-runtime-smoke
agents: [godot-dev, godot-enemy, godot-weapons-abilities, godot-player, godot-playtester]
description: >-
  The L2 runtime-smoke layer for a Godot-family game (4.x) WITHOUT
  GdUnit4 — a headless SceneTree tool script (`tools/smoke_*.gd`, run via
  `$GODOT --headless --script`) that boots a real scene, drives ONE gameplay
  seam programmatically (call `weapon.try_fire()`, simulate a hit), and ASSERTS
  runtime outcomes that the static gate and render-snapshot miss: a signal
  emitted with the correct ARITY/payload, a method actually invoked (recoil
  applied), health decremented, `died` fired, no leak. Wires as a step in
  `tools/validate.sh` after the smoke run. Use when a task touches a gameplay
  seam whose correctness validate.sh can't prove — "the weapon fires the wrong
  signal arity", "recoil never applies", "enemy takes damage but never emits
  died", "assert a signal fired", "headless integration test", "smoke test the
  combat contract" — or when a regression slips past lint+parse+render because
  the logic is wrong, not the syntax. Reuses a project's own proven
  integration-test pattern. NOT the render/draw/pipeline-count
  checks (those need a real window — godot-verify layer 3 /
  `verify_render_action.gd`), NOT the load-and-renders gate (godot-verify),
  NOT a feel/polish sweep (not yet a skill), NOT the input-driven playthrough
  bot (`godot-playthrough-bot`).
---

# Godot runtime smoke (L2 — headless logic asserts)

`tools/validate.sh` proves a scene **loads + renders** (L0 static + a `--quit-after`
smoke run that flags ERROR/WARNING). It does NOT prove the game **runs correctly**:
a weapon that emits the wrong signal arity, recoil that never applies, an enemy that
takes damage but never emits `died`, a regressed feel value — all pass L0 and only
surface at human F5. The L2 layer closes that gap by booting a real scene headless,
driving ONE gameplay seam from code, and **asserting observable state**. This skill
un-ad-hocs the common one-off integration test into a re-runnable template +
a checklist of which seams to cover, and wires it as a gate step. No GdUnit4, no
addon: a plain `SceneTree` script gives the same logic-assert capability with zero
new dependency.

## Requirements

- `godot-code-rules` applied — the smoke script is strict typed GDScript and must
  pass the same `validate.sh` format/lint/parse it gates.
- `godot-verify` understood — this is layer **2.5**: it sits between the L2 smoke
  run and the L3 windowed render check, and it asserts logic the others can't.
- The seam under test must be **callable from code** (a public `try_fire()`,
  a `died` signal, an `on_hit()` duck-typed method). If a behaviour is only
  reachable through real physics-overlap between two separately-added nodes, the
  headless cache won't populate it synchronously — assert the **code path** the
  overlap would call instead (see the "headless caveat" below), and leave the true
  overlap to F5.

## The headless caveat (split logic vs render — load-bearing)

`--headless` runs the **dummy renderer**: there is NO RenderingDevice, and draw-call /
`pipeline_compilations` monitors read **0** (probed empirically —
`library/verdicts/polish-quality-eval-2026-06-19.md`). That forces the split this skill
turns on:

- An L2 smoke asserting **gameplay logic** (signal emitted, correct arity, recoil applied,
  health decremented, `died` fired, score incremented, node freed) runs fine headless. THIS
  skill.
- An L2 test asserting **render / draw-calls / pipeline-count / pixels** does NOT work
  headless — it needs a real window. That is godot-verify layer 3 /
  `tools/verify_render_action.gd`. Do NOT put a draw-call or pipeline-monitor assert in a
  `tools/smoke_*.gd` — it will read 0 and either falsely pass or falsely fail.

**Split rule:** logic/signal/state asserts → headless `smoke_*.gd` (gated in validate.sh).
Render/perf/pipeline asserts → windowed run (verify_render_action, F5 territory).

Headless physics also does **not** process overlap detection synchronously between two
separately-added nodes within a few frames. If your seam depends on
`get_overlapping_bodies()` / `body_entered`, assert the method it _would_ call
(`_apply_hit(enemy)`) directly via the duck-typed seam — exactly as a stationary-overlap
integration test does — and prove the code path exists/is callable, leaving the real overlap
to F5.

## Project conventions

- Path/name: `tools/smoke_<seam>.gd` (snake_case), e.g. `tools/smoke_combat.gd`.
  `extends SceneTree`. One file per gameplay seam family; keep it focused.
- **Drive the REAL entry path, assert the DOWNSTREAM observable.** When a seam is reached in
  play through a signal/trigger (`Area3D.body_entered`, a button press, a level-load), drive
  THAT path — instantiate the real scene, fire the real signal with a real (group-tagged) body
  — not the private `_arm`/`_spawn` method it eventually calls. And assert the user-visible
  OUTCOME (entity is in its query group `get_nodes_in_group("enemies")`, appears in a registry,
  persists N frames), NOT merely "the node exists". A smoke that calls the private method and
  checks node-existence passes while the trigger wiring, collision mask, or group registration
  is broken. (A real `Area3D` overlap DOES populate headless — pump ~30 physics frames, not 3 —
  so prefer the real signal when reachable; fall back to the duck-typed method only for true
  two-node physics overlaps that never settle.)
- Run: `$GODOT --headless --path . --script tools/smoke_<seam>.gd`. Exit **0** = all
  asserts passed, **1** = any failure (`quit(1 if _fail_count > 0 else 0)`).
- Drive at **frame 3** (not 1): frame 1 = nodes added + `_ready()`; frame 2 = physics
  server first tick; frame 3 = overlaps/state populated. Use a `_frame` counter in
  `_process` and a `_done` guard so the body runs once.
- Scenes under test live in their domain folder (`res://entities/...`,
  `res://levels/<level>.tscn`). Load with `load(path) as PackedScene`,
  `instantiate()`, `root.add_child(...)`; `queue_free()` every spawn at the end so the
  smoke leaves no leak (validate.sh's leak greps still apply).
- Private-field reads (`_health`, `_swing_active`) are a **test SEAM**: read via
  `e.get("_health") as int`, set via `node.set("_swing_active", true)`; annotate the
  duck-typed call site with `@warning_ignore("unsafe_method_access")` /
  `("unsafe_cast")` exactly per godot-code-rules — never widen warning levels.
- Input actions for seam-driving: the generic movement set (`move_left, move_right,
move_forward, move_back, jump`) plus any game-specific actions the project defines.
  Fire/recoil/hit are driven by calling the entity's own methods, not by faking `Input`.
- **Per-domain coverage rule — a smoke must vary the inputs the seam's domain depends
  on, not just the happy path.** Pick the smoke's discriminating cases from what the
  seam reads, by domain:
  - **Transform / spatial** (targeting arc, aim cone, relative position, basis math):
    run >=1 case with a **non-identity origin** — rotated yaw AND translated — so a
    `rotation.y` vs `global_rotation.y` (local vs world, parent vs global) bug is
    forced to diverge. A yaw=0 / origin-at-zero case alone makes local==global and
    hides the entire class. Assert a discriminating OFF-AXIS target, not just a
    head-on one.
  - **Signal / contract**: assert exact arity AND payload identity, not "not null".
  - **Numeric / state**: assert the before!=after DELTA, and at least one boundary
    (edge-of-range, zero, max).
  - **Awaited engine signal in a gate step** (bake_finished, etc.): bound it with a
    timeout (see the gate-step row in Error->Fix) — never `await` unbounded.

## Steps

1. **Pick the seam + the observable.** What changed that L0 can't see? For the combat
   contract: fire emits a signal with the right arity; a hit on an enemy emits `died`
   with the enemy payload; recoil state changed on the weapon. Each observable = one
   assert.

2. **Scaffold the SceneTree script.** Counters + frame-gated entry, mirroring the proven
   base:

   ```gdscript
   # tools/smoke_combat.gd — headless L2 smoke: weapon fire + hit/kill contract.
   # Run: $GODOT --headless --path . --script tools/smoke_combat.gd
   # Exit 0 = all pass, 1 = any failure.
   extends SceneTree

   const LEVEL_SCENE := "res://levels/<level>.tscn"
   const ENEMY_SCENE := "res://entities/<enemy>.tscn"
   const WEAPON_SCENE := "res://entities/<weapon>.tscn"

   var _pass_count: int = 0
   var _fail_count: int = 0
   var _frame: int = 0
   var _done: bool = false


   func _initialize() -> void:
       print("=== COMBAT SMOKE ===")


   func _process(_delta: float) -> bool:
       _frame += 1
       if _frame == 3 and not _done:
           _done = true
           _run_all()
       return false


   func _run_all() -> void:
       _test_fire_signal_arity()
       _test_hit_emits_died()
       _test_recoil_applied()
       print("\n=== RESULTS: %d pass / %d fail ===" % [_pass_count, _fail_count])
       quit(1 if _fail_count > 0 else 0)
   ```

3. **Use the reusable assert helpers** (copy verbatim — the proven `_pass`/`_fail` shape):

   ```gdscript
   func _pass(msg: String) -> void:
       _pass_count += 1
       print("  PASS: %s" % msg)


   func _fail(msg: String) -> void:
       _fail_count += 1
       print("  FAIL: %s" % msg)


   func _assert(cond: bool, msg: String) -> void:
       if cond:
           _pass(msg)
       else:
           _fail(msg)
   ```

4. **Assert a signal fired with the correct ARITY/payload.** Capture into a one-element
   array from a lambda (closures can't reassign a captured local, but can mutate an
   Array element — the proven idiom):

   ```gdscript
   func _test_hit_emits_died() -> void:
       var e := _spawn(ENEMY_SCENE) as Enemy
       if e == null:
           _fail("enemy failed to spawn")
           return
       # arity check: died(enemy) — payload must be the enemy that died.
       var got: Array = [0, null]  # [count, last_payload]
       e.died.connect(func(en: Enemy) -> void:
           got[0] = (got[0] as int) + 1
           got[1] = en)
       e.on_hit()  # health=1 enemy: fatal
       _assert(got[0] == 1, "died emitted exactly once on fatal hit")
       _assert(got[1] == e, "died payload is the enemy (correct arity/payload)")
       if is_instance_valid(e):
           e.queue_free()
   ```

   A wrong arity (a builder changes `died` to `died()` or `died(enemy, score)`) breaks
   the `connect`/emit at runtime and this assert catches it — validate.sh's parse pass
   does not.

5. **Assert a method actually ran (recoil applied).** Read the observable state the
   method mutates, before and after:

   ```gdscript
   func _test_recoil_applied() -> void:
       var w := _spawn(WEAPON_SCENE)
       if w == null or not w.has_method("try_fire"):
           _fail("weapon missing try_fire()")
           return
       var before := w.get("_recoil_offset")  # SEAM: private state read
       @warning_ignore("unsafe_method_access")
       w.try_fire()
       var after := w.get("_recoil_offset")
       _assert(after != before, "recoil offset changed after try_fire (recoil applied)")
       if is_instance_valid(w):
           w.queue_free()
   ```

6. **Spawn helper + cleanup.** Free everything; leave no leak.

   ```gdscript
   func _spawn(path: String) -> Node:
       var packed := load(path) as PackedScene
       if packed == null:
           push_error("Failed to load: %s" % path)
           return null
       var inst := packed.instantiate()
       root.add_child(inst)
       return inst
   ```

7. **Name it `smoke_*.gd` — it auto-joins via `check_smoke_bots`; just create the file.**
   `tools/validate.sh` already globs `tools/smoke_*.gd` and runs each headless as part of
   its runtime-smoke step (`check_smoke_bots` in `tools/lib/checks.sh`) — do NOT hand-wire
   a new step into `validate.sh`; `tools/` is the plugin-materialized gate and a hand-edit
   there is gitignored + overwritten on re-materialization. Each script self-reports
   pass/fail counts and sets the exit code; the gate only needs the exit code.

## Input-driven playthrough → `godot-playthrough-bot`

The signal/state smoke above drives ONE seam by calling its method. Driving the actual _input_
layer instead (walk/jump/crouch/aim/fire on a timeline, mouse-look, toggle/pause seams) and the
**navigability smoke** (a level that renders but is unwalkable) are the companion skill
`godot-playthrough-bot` — same `extends SceneTree` family, no GdUnit4. Reach for it when the bug
is in the input path or trigger wiring, not in a directly-callable seam.

## Engine-error log capture

The static gate greps stderr per-scene. A **`--log-file` capture** per gate run is more
robust (survives piping, captures the multi-line GDScript backtrace intact) and feeds the
dev-agent structured failures. Verified on Godot 4.6.3, this machine.

- Add `--log-file <path>` to each smoke/scene run; the engine writes all output+errors
  there. Optional: project setting `debug/file_logging/enable_file_logging = true` makes
  file logging the default even without the flag (the per-run flag alone suffices).
- Grep the FILE with the CORRECTED regex, **after** the benign-teardown exclusion filter:

  ```bash
  grep -nE '^(ERROR|SCRIPT ERROR):' "$LOG"
  ```

  DROP the Hermes short form `E <ts>:` — it does NOT appear in 4.6 `--log-file` output.
  `push_error()` → `ERROR: <msg>`; a GDScript runtime error → `SCRIPT ERROR: <msg>` +
  `at: fn (file:line)` + a `GDScript backtrace` block (file:line present, 4.5+).

- On a hit, emit the matched lines AND the following `GDScript backtrace` block (file +
  line + message) as structured dev-agent feedback — not just the first line.

THE HEADLESS / WINDOWED SPLIT (critical — do NOT assume headless catches everything):

- Headless `--log-file`+grep catches: parse errors, `SCRIPT ERROR` (runtime null, bad
  arity at runtime), node name clashes, non-render engine errors. ✓
- RENDER-PATH error classes (e.g. `material_casts_shadows: material is null` on a
  shadow-caster) NEVER execute under the `--headless` DUMMY renderer — so they CANNOT
  be caught headless. They need a windowed / Xvfb run (DEFERRED for the POC; see
  tech_debt #4). State this so no one trusts headless to catch render-path errors.

## Verification checklist

- Run `$GODOT --headless --path . --script tools/smoke_combat.gd` directly →
  prints `=== RESULTS: N pass / 0 fail ===` and exits 0.
- `--log-file` capture: a deliberate `push_error("x")` in a smoke run appears as
  `ERROR: x` in the log and the grep flags it; a forced runtime null prints a
  `SCRIPT ERROR:` + `GDScript backtrace` block with file:line.
- Deliberately break the seam (rename `died` arity, comment out the recoil mutation)
  → the matching assert prints `FAIL:` and the script exits 1. (A smoke test that
  can't fail proves nothing.)
- `tools/validate.sh` now prints `validate: PASS runtime-smoke` between
  `PASS smoke` and `validate: OK`.
- The smoke run adds no new leak lines to validate.sh's leak greps (every spawn
  `queue_free`d).
- No render/draw-call/pipeline assert lives in any `smoke_*.gd` (those are windowed).
- Any smoke over a transform-dependent seam (targeting arc, aim cone, relative
  position) runs >=1 case with a rotated AND translated origin — not only at the world
  origin — and any gate step awaiting an engine signal is timeout-bounded.

## Error → Fix

| Symptom                                                                           | Fix                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Smoke passes but the feature is dead in play (minimap empty, trigger never armed) | Smoke called the private `_arm`/`_spawn` method and checked node-existence. Drive the real signal/trigger path with a group-tagged body (~30 frames for `Area3D` overlap) and assert the downstream observable — group membership / registry entry / persistence — not "node exists".                                          |
| Asserts run before state populated (signals never connected, overlaps empty)      | Drive at `_frame == 3`, not 1 — frame 1 is only `_ready()`.                                                                                                                                                                                                                                                                    |
| `pipeline_compilations` / draw-call assert reads 0 and always passes/fails        | Headless has no RenderingDevice — move that assert to a windowed `verify_render_action`-style run.                                                                                                                                                                                                                             |
| `get_overlapping_bodies()` empty for two separately-added nodes                   | Headless physics doesn't sync overlap in a few frames — assert the method the overlap would call (`_apply_hit`) directly via the duck-typed seam.                                                                                                                                                                              |
| Lambda "Cannot assign to captured local"                                          | Capture a one-element `Array` and mutate `arr[0]`, don't reassign the local.                                                                                                                                                                                                                                                   |
| `UNSAFE_METHOD_ACCESS` / `UNSAFE_CAST` fails parse                                | Annotate the duck-typed seam call with `@warning_ignore("unsafe_method_access")` / `("unsafe_cast")` immediately above it; never lower warning levels.                                                                                                                                                                         |
| Script exits 0 even though the seam is broken                                     | The assert reads a value that's true regardless — assert the _delta_ (before != after) or the exact payload, not mere "not null".                                                                                                                                                                                              |
| New leak lines appear in validate.sh smoke greps                                  | `queue_free()` every spawned node at the end of each test; check `is_instance_valid` first.                                                                                                                                                                                                                                    |
| Editing `tools/validate.sh` doesn't persist                                       | `tools/` is plugin-materialized + gitignored — don't hand-edit; report the step to the verifier to add upstream.                                                                                                                                                                                                               |
| Log grep finds nothing though errors occurred                                     | Regex is `^(ERROR\|SCRIPT ERROR):` — drop the Hermes `E <ts>:` short form (absent in 4.6); run grep AFTER the benign-teardown filter, on the `--log-file` path.                                                                                                                                                                |
| `material.*is null` never fires headless                                          | Render-path errors don't execute under the `--headless` dummy renderer — needs a windowed/Xvfb run (deferred, tech_debt #4); do not expect headless to catch it.                                                                                                                                                               |
| Spatial-seam smoke passes but the transform reference (local vs global) is wrong  | Every case used an identity / yaw=0 origin, where local==global. Drive >=1 case with a NON-identity origin (rotated yaw AND translated) so a `rotation.y` vs `global_rotation.y` (or local-vs-world basis) bug is forced to diverge; assert a discriminating OFF-AXIS target. (Per-domain coverage rule, Project conventions.) |

For input-path / navigability failures (bot input had no effect, mouse-look, toggle/UI "does
nothing", player falls through the floor, an unbounded gate `await` hangs), see
`godot-playthrough-bot`.

Authored from a project's own proven integration-test pattern; no external
library source.
