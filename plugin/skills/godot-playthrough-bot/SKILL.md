---
name: godot-playthrough-bot
agents: [godot-dev, godot-player, godot-playtester]
domain: godot-core
description: >-
  The headless INPUT-DRIVEN playthrough bot for a Godot-family game (4.x) WITHOUT
  GdUnit4 — an `extends SceneTree` tool script (`tools/bot_playthrough.gd` /
  `tools/play_<slug>.gd`, run via `$GODOT --headless --fixed-fps 60 --script`) that
  drives the real INPUT layer on a timeline (walk/jump/crouch/aim/fire) and ASSERTS the
  player+combat systems respond — position/state DELTAS, a signal fired within a
  timeout, a toggle/pause flip. The companion to `godot-runtime-smoke`: that skill calls
  ONE seam's method directly; THIS one drives input the way a player does, so it catches
  wiring the method-call smoke skips — a dead toggle on a `WHEN_PAUSED` node, an action
  read via `_input` that `action_press` never fires, a held move that integrates 0
  units. Also covers the NAVIGABILITY smoke — a level that RENDERS but is unwalkable
  (player falls through the floor, spawns mid-air, no baked navmesh). Use when a task
  drives the player through input — "playthrough bot", "walk the level headless", "test
  jump/crouch/mouse-look headless", "the toggle does nothing in play but the smoke
  passed", "player falls through the floor", "navigability smoke", "assert movement from
  a real key press". NOT the method-call signal/state smoke (that is
  `godot-runtime-smoke`), NOT the windowed render/pixel check (`godot-verify` layer 3).
---

# Godot playthrough bot (headless — drive the real input layer)

`godot-runtime-smoke` drives ONE gameplay seam by calling its method (`weapon.try_fire()`).
A **playthrough bot** drives the actual _input_ layer — walk/jump/crouch/aim/fire on a
timeline — and asserts the player+combat systems respond. Same `extends SceneTree` family, no
GdUnit4. This catches the class the method-call smoke can't: the trigger wiring, the input
path, the pause/toggle gate — where calling the private method passes but the real key press is
dead.

## Requirements

- `godot-runtime-smoke` — the base `extends SceneTree` headless-smoke pattern (counters,
  frame-gated entry, the `_pass`/`_fail`/`_assert` helpers, spawn + cleanup, the headless
  logic-vs-render caveat). This skill is its input-driven specialization; read it first.
- `godot-code-rules` applied — the bot is strict typed GDScript and must pass the same
  `validate.sh` format/lint/parse it gates.
- The controller must read input the standard way (`Input.is_action_pressed` /
  `Input.get_vector` in `_physics_process`, OR `_input`/`_unhandled_input` for typed events) —
  pick the driving path below by how it reads.

## Two input paths — pick by how the controller reads

- **Polled actions** (move/jump/crouch/fire — anything read via `Input.is_action_pressed` /
  `Input.get_vector` / `Input.get_action_strength`): `Input.action_press(action)` /
  `Input.action_release(action)`. Works headless, **state-only**, and **does NOT fire
  `_input()`**. The CharacterBody3D reads the held state in `_physics_process`, so this drives
  movement correctly.
- **Typed `InputEvent`s** (anything that flows through `_input` / `_unhandled_input`, incl.
  mouse-look): `viewport.push_input(event)` — the canonical headless path. Feed an
  `InputEventMouseMotion` with `.relative` set for look; `InputEventMouseButton` for
  click-driven fire. `root.push_input(ev)` runs headless.
- **Toggles / UI open-close / menu / pause-screen seams:** drive the REAL input — the toggle
  action (`Input.action_press`) OR `viewport.push_input(InputEventKey)` — step physics frames,
  then assert the OBSERVABLE flip: screen `visible` toggled, `get_tree().paused` toggled, the
  screen node added/removed. Do NOT call the screen's `_open()`/`_close()` directly and do NOT
  assert only an internal toggle bool — that bypasses the input path where the bug lives.
  **A toggle handled in `_input`/`_unhandled_input` on a node whose `process_mode =
WHEN_PAUSED` is DEAD while the game is unpaused** (and the inverse while paused) — only a
  real-input sim catches it; a logic-only assert passes a dead toggle. (Capturing the resulting
  screen for occlusion/layout is godot-verify Layer 5, root viewport.)

## Headless mouse-look limits (load-bearing)

- `Input.parse_input_event(ev)` needs a manual `Input.flush_buffered_events()` to deliver under
  headless (godot#73557) — so prefer `push_input` (no flush needed).
- `Input.warp_mouse()` and `Input.MOUSE_MODE_CAPTURED` are **UNAVAILABLE headless** (need a
  window). So test mouse-look by feeding `InputEventMouseMotion.relative` and asserting **Head
  pitch / body yaw deltas**, NOT cursor/warp position.

## Driver + stepping

- Run: `$GODOT --headless --fixed-fps 60 --path . --script tools/bot_playthrough.gd`.
  `--fixed-fps 60` makes physics integration deterministic per step.
- Step with `await tree.physics_frame` (NOT a `_process` frame count) so CharacterBody3D
  movement integrates between presses.
- Assert on position/state **DELTAS** (snapshot before, snapshot after) — not just "input
  landed". A held action that moves the body 0 units is a failure even though the press
  "worked".
- Signal-await-with-timeout (hand-rolled, no GdUnit4): race the signal against a timer via a
  bool flag, fail if the timer wins.

Minimal reusable press-for-N-frames pattern:

```gdscript
func _press_for(tree: SceneTree, action: StringName, frames: int) -> void:
    Input.action_press(action)
    for _i in frames:
        await tree.physics_frame
    Input.action_release(action)
```

Look / typed-event pattern (mouse-look — assert Head pitch delta, not cursor):

```gdscript
func _look(viewport: Viewport, dx: float, dy: float) -> void:
    var ev := InputEventMouseMotion.new()
    ev.relative = Vector2(dx, dy)
    viewport.push_input(ev)  # flows through _input/_unhandled_input; no flush needed
```

Signal-await-with-timeout helper (await signal OR N-frame timeout → fail):

```gdscript
func _await_signal(tree: SceneTree, sig: Signal, timeout: float) -> bool:
    var fired: Array = [false]
    sig.connect(func(_a: Variant = null) -> void: fired[0] = true, CONNECT_ONE_SHOT)
    var timer := tree.create_timer(timeout)
    while not (fired[0] as bool):
        if timer.time_left <= 0.0:
            return false
        await tree.physics_frame
    return true
```

(Implementation lives in `tools/bot_playthrough.gd` — a godot-dev task, not this skill.)

## Navigability smoke

A level can RENDER fine (passes godot-verify L3) yet be unwalkable — the player falls through
the floor, has no collider, or spawns mid-air. Physics + navigation run under the headless
DUMMY renderer (no RenderingDevice needed), so this is a headless L2 check — NOT a windowed
render check.

- After instancing the player into the level + 2 `physics_frame`s of navmesh settle, press
  `move_forward` ~120 frames and assert: `moved > 1.0` unit, `end_pos.y > -10` (did NOT fall
  through), `is_on_floor()`, upright (`rotation.x < 90°`).
- Thorough variant: drive a `NavigationAgent3D` to a known reachable point, assert `dist < 2.0`
  (doubles as a navmesh-baked check — an unbaked navmesh yields an empty path).
- Caveat: only works if the controller polls `Input` in `_physics_process` (standard
  CharacterBody3D) — if it reads `_unhandled_input`, feed events via `viewport.push_input`.
- Pattern: name it `tools/smoke_nav.gd` — it auto-joins the `smoke_*.gd` glob (`check_smoke_bots`
  in `tools/lib/checks.sh`) run by `validate.sh`; do NOT hand-wire a new step into `validate.sh`
  (`tools/` is plugin-materialized — a hand-edit there is gitignored + overwritten).

## Verification checklist

- Bot playthrough: pressing `move_forward` N frames moves `player.position.z` by a non-zero
  delta; `jump` flips `is_on_floor()` false then true; crouch lowers eye height / collider; a
  mouse-look `InputEventMouseMotion` changes Head pitch.
- Navigability: after ~120 `move_forward` frames, `moved > 1.0`, `end_pos.y > -10`,
  `is_on_floor()`, upright; break the floor collider → the smoke exits 1.
- A toggle/pause seam: driving the real action/key flips the observable (`visible`,
  `get_tree().paused`, node added) — not merely an internal bool.
- Deliberately break the seam (hold an action that should move but is unwired) → the delta
  assert prints `FAIL:` and the script exits 1. (A bot that can't fail proves nothing.)
- Any gate step awaiting an engine signal is timeout-bounded (never `await` unbounded).

## Error → Fix

| Symptom                                                                                                                     | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bot input had no effect (body never moved)                                                                                  | Controller reads `_input()`, not polled state — `action_press` is state-only and skips `_input`; feed the event via `viewport.push_input(ev)` instead.                                                                                                                                                                                                                                                                                                              |
| Mouse-look assert fails / cursor never moves headless                                                                       | `warp_mouse` + `MOUSE_MODE_CAPTURED` are unavailable headless — feed `InputEventMouseMotion.relative` via `push_input` and assert the Head pitch / body yaw delta, not cursor position.                                                                                                                                                                                                                                                                             |
| Bot moves 0 units but assert passes                                                                                         | Assert the position/state DELTA (before != after), not "input landed"; step with `await tree.physics_frame` so movement integrates.                                                                                                                                                                                                                                                                                                                                 |
| Toggle / UI screen "does nothing" in play but the smoke passed                                                              | Smoke asserted internal toggle logic or called `_open()`/`_close()` directly, skipping the input path. Drive the real toggle action / key event through the SceneTree, step frames, assert the observable flip (`visible`, `get_tree().paused`, node added). If the UI node uses `process_mode = WHEN_PAUSED`, its `_input` never fires while unpaused — handle the toggle on an always-processing node (`PROCESS_MODE_ALWAYS`) or read the action where it's live. |
| `parse_input_event` event never delivered headless                                                                          | godot#73557 — needs `Input.flush_buffered_events()`; prefer `push_input` (no flush) or `action_press` (polled).                                                                                                                                                                                                                                                                                                                                                     |
| Level renders fine in L3 but player falls through / can't walk / spawns mid-air                                             | Render check ≠ navigability. Add a headless nav smoke (physics+nav run under DUMMY): press `move_forward` ~120 frames, assert `moved>1.0`, `end_pos.y>-10`, `is_on_floor()`, upright. A `NavigationAgent3D` reach-target variant doubles as a navmesh-baked check (empty path = unbaked).                                                                                                                                                                           |
| Gate-step diagnostic (`await nav_region.bake_finished`, any awaited engine signal) hangs forever / runs away with no output | A bare `await signal` in a gate has no escape — an empty/failing headless bake never emits. Race the signal against a frame budget: await the signal OR an N-frame timeout, and on timeout print a FAIL line + `quit(1)`. Never let a gate step await unbounded — reuse the `_await_signal` timeout helper above.                                                                                                                                                   |

Headless input facts (`action_press` state-only, `push_input`, `--fixed-fps`, `warp_mouse`
unavailable) verified empirically — see `library/verdicts/runtime-testing-eval-2026-06-19.md`.
The companion to `godot-runtime-smoke` (method-call signal/state smoke); pairs with
`godot-first-person-controller` and `godot-navmesh-pathing-4-6` (the systems it drives).
