# Verdict — automated runtime testing (input-bot + log capture)

Date: 2026-06-19. Input: Hermes findings (run run_297a46a27ff54268a945f1cca925f1ab).
Engine: Godot 4.6.3.stable (verified on this machine). No library candidate — both
recommendations are GdUnit4-free hand-rolled patterns; the home is the EXISTING
`godot-runtime-smoke` skill family, not a new library adoption.

## Facts verified (empirically, this machine, 4.6.3)

| Claim                                                                                  | Result                                                                                                               |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Input.action_press` / `is_action_pressed` work under `--headless`                     | YES — `ACTION_PRESSED=true`, `STRENGTH=1.0`. State-only; does NOT fire `_input`.                                     |
| `Viewport.push_input(event)` callable headless                                         | YES (`root.push_input(ev)` runs). Delivers real InputEvent-typed events.                                             |
| `--fixed-fps <n>` exists 4.6                                                           | YES (in `--help`).                                                                                                   |
| `--log-file <path>` exists 4.6                                                         | YES (in `--help`); writes engine output+errors to path.                                                              |
| `push_error()` log form                                                                | `ERROR: <msg>` (long form).                                                                                          |
| GDScript runtime error log form                                                        | `SCRIPT ERROR: <msg>` + `at: fn (file:line)` + `GDScript backtrace` block — file:line present, dev-agent parseable.  |
| Hermes short form `E <ts>:` regex                                                      | NOT observed in `--log-file` output. DROP it.                                                                        |
| `Input.parse_input_event` needs `Input.flush_buffered_events()` headless (godot#73557) | Not load-bearing — prefer `action_press` (polled) + `push_input` (typed) which need no flush.                        |
| `Input.warp_mouse()` headless                                                          | Unavailable (no window) — mouse-look via `push_input(InputEventMouseMotion)` only; true capture/warp needs a window. |

## Recommendation 1 — INPUT BOT: ADOPT (extend godot-runtime-smoke)

> SUPERSEDED 2026-07-01 — the input-bot was later split into its own skill
> `godot-playthrough-bot` (D8-smoke-bloat: runtime-smoke had grown to ~425L / 3–4
> capabilities). The "NOT a new skill" call below no longer holds; the rest (the headless
> input facts, the build slice) still stands.

Fits the POC: hand-rolled `extends SceneTree`, no GdUnit4, strict-typed, same
`smoke_*.gd` family + same validate.sh glob. Extend the EXISTING skill with an
input-driven playthrough section — NOT a new skill (same L2 family).

Canonical headless input path (verified):

- Polled actions (move/jump/crouch/fire) → `Input.action_press(a)` / `Input.action_release(a)`.
  Works headless, state-only. CharacterBody3D reads these in `_physics_process`.
- Typed events incl. mouse-look → `viewport.push_input(ev)` (`InputEventMouseMotion`,
  `InputEventMouseButton`). Use for anything that goes through `_input`/`_unhandled_input`.
- Step: `await tree.physics_frame` (not `_process` frame-count) so movement integrates.
- Drive: `$GODOT --headless --fixed-fps 60 --path . --script tools/bot_playthrough.gd`.
- Assert: position/state deltas + signal-await-with-timeout helper (await signal OR
  N-frame timeout → fail). Pattern mirrors existing `smoke_combat.gd` `_pass/_fail/_assert`.

Caveats to document in the skill:

- `action_press` does NOT fire `_input` (state-only); for `_input`-driven logic use `push_input`.
- `warp_mouse` + true mouse-capture (`Input.MOUSE_MODE_CAPTURED`) need a real window —
  headless tests mouse-look by feeding `InputEventMouseMotion.relative` via `push_input`,
  asserting Head pitch / body yaw deltas, NOT capture behaviour.
- Overlap/physics-contact caveat from the base skill still applies (assert the code path).

First build slice (after approval): `tools/bot_playthrough.gd` — timeline:
press move_forward N frames → assert player.position.z delta; jump → assert is_on_floor
false then true; crouch (push_input or action) → assert eye-height/collider delta;
push InputEventMouseMotion → assert Head pitch delta; weapon.try_fire on an enemy in
front → assert `hit_confirmed`/`died` via signal-await-timeout. Exit 0/1.

## Recommendation 2 — LOG CAPTURE: ADOPT (partial; mostly already shipped)

Largely ALREADY DONE by `tools/smoke_scene_errors.sh` (per-scene headless stderr grep).
Net-new from Hermes that is worth adopting:

- `--log-file <path>` per gate run + grep the FILE (more robust than stderr piping,
  and captures the multi-line GDScript backtrace intact for dev-agent feedback).
- Project setting `debug/file_logging/enable_file_logging = true` makes file logging the
  default even without the flag (optional; the `--log-file` flag alone suffices per-run).

Exact wiring (UPSTREAM PROMOTION — `tools/` is plugin-materialized + gitignored):

- Regex (CORRECTED — drop `E <ts>:`, keep SCRIPT ERROR):
  `grep -nE '^(ERROR|SCRIPT ERROR):' "$LOG"` after the benign-teardown exclusion filter
  (reuse the existing `$BENIGN` list). `material.*is null` / `name clashes` stay in the
  exclusion-aware grep as today.
- Per smoke/scene run add `--log-file "$LOG"`; on a hit, emit the matched lines AND the
  following `GDScript backtrace` block (file:line) so the dev-agent gets structured
  feedback (file, line, message). Lives in `smoke_scene_errors.sh` (extend) + the
  `godot-verify` skill contract; promote to the plugin validate.sh template.
- Home: extend `smoke_scene_errors.sh` (log-file capture) + document the regex/backtrace
  contract in `godot-verify`. NOT a new skill.

## Recommendation 3 — WINDOWED / Xvfb RENDER-ERROR GATE: DEFER

THE SPLIT (state explicitly):

- (a) HEADLESS `--log-file`+grep catches: parse errors, `SCRIPT ERROR` (runtime null,
  bad arity at runtime), node name clashes, non-render engine errors. ✓ covered.
- (b) RENDER-PATH error classes (e.g. `material_casts_shadows: material is null` on a
  shadow-caster) DO NOT execute under the `--headless` DUMMY renderer — godot-dev's
  empirical finding. The `material.*is null` token in smoke_scene_errors.sh therefore
  CANNOT fire headless; only a WINDOWED / Xvfb run catches this class.

Decision: DEFER for the POC. Cost (Xvfb/display dependency in the run env, CI plumbing,
flakier runs) outweighs value at POC stage: this class is caught at human F5 and by the
existing L3 `verify_render_action.gd` windowed run when invoked. Re-open when (i) the run
env already has a display, or (ii) a material-null-class regression actually ships past
the gate a second time. Park: a `tools/verify_render_action.gd`-style windowed gate
behind Xvfb, gated on display availability, would close (b).

## Recommendation 4 — GdUnit4: KEEP REJECTED

Hermes agrees. Hand-rolled `SceneTree` gives equivalent logic-assert with zero new
dependency; matches "modularize ON DEMAND only". Re-evaluate only if the suite grows past
~a handful of smoke files or needs fixtures/parameterized cases.

## Net actions (priority order)

1. (highest ROI) Extend `godot-runtime-smoke` with the input-bot section + build
   `tools/bot_playthrough.gd` (walk/jump/crouch/aim/fire timeline, position+signal asserts).
2. Add `--log-file` capture + corrected regex + backtrace-feedback to
   `smoke_scene_errors.sh`; document the contract in `godot-verify`. Upstream-promotion item.
3. Defer windowed/Xvfb render gate.
4. Keep GdUnit4 rejected.

No library candidate adopted (no GodotPrompter skill involved); no `.claude/skills/eval/`
created → nothing to delete.
