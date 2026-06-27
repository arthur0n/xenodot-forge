---
name: godot-code-rules
agents: [builders, godot-playtester]
description: Strict typed-GDScript rules (the tsconfig-strict + ESLint equivalent) — full typing, explicit return types, warnings-as-errors, size caps, file headers, @warning_ignore policy, gated by tools/validate.sh. Load BEFORE writing or editing ANY .gd file, when validate.sh / gdlint / gdformat fails, on a typed-GDScript error (UNTYPED_DECLARATION, UNSAFE_*), or when deciding whether code may use Variant, duck typing, or @warning_ignore.
---

# Godot Code Rules (strict mode)

GDScript strict mode = TypeScript strict, enforced by: `project.godot [debug]` warnings→errors, `gdlint`/`gdformat` with `gdlintrc`, and this skill for what no tool checks.

## The contract

| Strict TS / ESLint                | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Enforced by                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `no-explicit-any`                 | No untyped declarations. Every `var`, param, return typed. `Variant` only at `# SEAM:`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `untyped_declaration=2`              |
| type inference                    | `:=` encouraged when RHS makes type obvious (`var dir := Vector2.ZERO`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `inferred_declaration=0`, deliberate |
| explicit return types             | `-> Type` on **every** func, including `-> void`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `untyped_declaration=2`              |
| `no-unsafe-*`                     | No property/method access, cast, or call argument the analyzer can't prove. Fix with typed refs or SEAM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `unsafe_*=2`                         |
| `strict-boolean-expressions`      | Truthiness ONLY for Object null checks (`if node:`). Never on String/int/float/Array/Dict/Vector — use `.is_empty()`, `!= 0`, `!= Vector3.ZERO`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **agent only**                       |
| `no-unused-vars` + `^_`           | Unused locals = errors; unused params get `_` prefix (`_delta`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `unused_variable=2`                  |
| `max-lines`                       | File ≤500 lines, line ≤100 chars, params ≤8, returns ≤6, public methods ≤20                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | gdlint                               |
| `max-lines-per-function`          | Func ≤~100 effective lines, nesting ≤6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **agent only**                       |
| **soft size trigger**             | File ≥300 lines → STOP: split-or-justify (one responsibility per script). A design checkpoint, NOT a gate failure — the 500 cap rarely fires on real god-scripts, which bloat at 200–300                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **agent only**                       |
| `no-duplicate` (DRY)              | 3rd near-identical block (node construction, tween/flash, detached-audio, group lookup) → extract a static util to `tools/lib/` before adding the 3rd                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **agent only**                       |
| **no-magic-tuning** (data-driven) | A gameplay/feel/tuning value (speed, damage, radius, duration, score, color, ramp endpoints, agent size, scale factors) must NOT be a bare literal inside logic. Put it in a named, addressable place — a `.tres` Resource field or an `@export` configured in the Inspector — and have code READ it. `lerpf(0.3, 1.8)`, `Vector3(1.3,0.7,1.3)`, `const _AGENT_HEIGHT = 1.8` inside a behaviour/util are magic numbers even inside a "data-driven" system. Exempt: true structural constants (array sizes, bit masks, math identities). And a data field you author MUST be consumed — an `@export`/`.tres` value nothing reads (e.g. `score_value` never added to score) is the same bug from the other side. | **agent only**                       |
| `no-console`                      | `print()` only for deliberate player/dev-facing output; problems use `push_warning()`/`push_error()` — but NOT at scene-load (`_ready`): a `push_warning`/`push_error` that fires on load emits a WARNING/ERROR line the `validate.sh` smoke + parse greps treat as a FAIL. Defer them to an actual failure branch, or use a plain `#` comment for an unconditional note                                                                                                                                                                                                                                                                                                                                       | **agent only**                       |

## File anatomy

Every `.gd` in this order (gdlint-enforced via `class-definitions-order`):

```gdscript
# entities/player/player.gd — player movement, jumping, and inventory.
class_name Player
extends CharacterBody3D
## Optional docstring for scripts with public API.

signal died                                  # snake_case, past tense

enum Kind { MESSAGE, INVENTORY }             # PascalCase / UPPER_SNAKE elements
const MAX_ITEMS := 8                         # UPPER_SNAKE_CASE
@export var speed: float = 5.0
var inventory: Array[String] = []            # public vars
var _gravity: float = 0.0                    # private: _ prefix
@onready var _mesh: MeshInstance3D = $Mesh   # @onready last, typed
```

- Line 1: `# <path from project root> — <one-line purpose>.` Always.
- `class_name`: required for entity/component scripts other scripts reference by type. Omit for `main.gd` and `tools/` SceneTree scripts.
- Indentation: tabs. Line length ≤100.
- Naming: snake*case funcs/vars/signals, PascalCase classes/enums, UPPER_SNAKE consts, `*`prefix = private. Signal handlers:`_on_<Source>\_<signal>`.
- Author data/config assets as typed `.tres` Resources.

## Inspector `@export` hints (complex systems)

Complex-system Resources/components (e.g. `CastData`, `HealthComponent`) SHOULD annotate tunables so the Inspector constrains them — prevents out-of-range/typo bugs and self-documents:

- `@export_range(min, max[, step])` on numeric tunables (health, damage, radius, speeds, durations) — slider + bounds.
- `@export_group("Name")` to structure a Resource/component with many fields into collapsible sections.
- `@export_enum("a","b")` / `@export_flags("a","b")` where a field is a fixed set / bitmask (`@export_flags` fits future ability/AoE layer-mask fields).

Keep plain `@export var x: Type` when no hint adds value — do not over-annotate. Use `@export_category` sparingly: it bleeds into child nodes in the Inspector.

**`@tool`** ONLY when edit-time behavior is genuinely needed; ALWAYS guard editor-time code with `Engine.is_editor_hint()` and assume no game state at edit time — an unguarded `@tool` script can crash the editor. Strict typing still applies.

## Escape hatches — exactly two greppable markers

**1. `@warning_ignore` — never bare.** Every ignore carries a one-line reason comment immediately above it. Type-boundary reasons use `# SEAM:` prefix:

```gdscript
# SEAM: duck-typed pickup — any body with add_item() can collect (godot-composition rule).
@warning_ignore("unsafe_method_access")
player.add_item(item_name)
```

**2. `# FIXME(agent): <what and why>`** — known deficiency left on purpose.

Audit: `grep -rn "SEAM:\|FIXME(agent)" --include='*.gd' .`

Block form `@warning_ignore_start`/`@warning_ignore_restore` allowed only in `tools/`, never game code.

**Typed ref vs SEAM:**

- Wiring **down** to known node (main → CameraRig, entity → its child): typed `class_name` ref. No ignore.
- Calling **across** entities at gameplay boundary (`body` from collision signal): duck typing + SEAM. Do NOT fix with `is Player`/`as Player` — coupling entities to concrete types is the violation (godot-composition).

## Boundary with godot-composition

This skill = **mechanics** (typing, sizes, headers, naming, gate). godot-composition = **structure** (when to extract components, signals up/calls down). Load both when restructuring.

## In-editor linting (gdstyle) — advisory, NOT the gate

`gdstyle` (config: `gdstyle.toml` at project root; install: `tools/install_gdstyle.sh`) is the
in-editor GDScript linter: live, fixable diagnostics in Godot's bottom panel. It surfaces
signals gdlint can't — `quality/max-class-variables` (a god-class proxy), perf hints
(`allocation-in-loop`, `process-get-node`), and complexity caps. Works on Godot/Redot 4.6;
CLI-only on Blazium.

It is **advisory only**: in v0.1.7 a rule set to `"error"` still reports as "warning" and
`gdstyle check` exits 0, so it never fails a build — and a couple of rules are off because they
false-positive or duplicate gdlint. Treat `gdstyle.toml` as on/off toggles + caps; the blocking
gate below is what catches regressions. Full rationale + the promote-to-gate trigger:
`library/tools/gdscript-linter.md`.

## The gate — tools/validate.sh

Run after every `.gd`/`.tscn` change, before reporting:

```bash
tools/validate.sh
```

Steps: 1 format (`gdformat --check`) → 2 lint (`gdlint`) → 3 parse + analyzer warnings-as-errors → 4 scene properties (godot-verify layer 1) → 5 headless smoke run (layer 2). Stops at first failure; ends with `validate: OK`.

- Never weaken the gate to make it pass — not `project.godot [debug]` warnings, not `gdlintrc` caps, and not `validate.sh` itself (including the layer-2 smoke-grep exclusion list). `tools/` is the plugin-materialized gate (gitignored); a local edit does not commit and is overwritten on re-materialization. A new benign-noise exclusion is a deliberate upstream change, not something to slip into a feature task — report it as friction.
- Never pipe gate output through `rtk grep` — hides FAIL lines; use plain `grep`.

## Root cause + evidence — `validate: OK` is NOT proof a behavior works

A green gate verifies **load / parse / logic-smoke only**. It runs `--headless` with the DUMMY renderer: **NO GPU, no audio, no real-time loop.** So it CANNOT confirm rendering (a mesh/material actually draws), audio (how a sound plays), or that an AI/physics body actually moves. Reporting "fixed" off a green gate for any such behavior is a false claim — the failure mode that destroys user trust.

Rules for every fix report:

- **Name the root cause, with evidence.** "The gate passed" / "should work now" is NOT a root cause. State the actual mechanism (which value/node/signal/order was wrong) and the evidence that proves it — ideally a repro that FAILED before your change and PASSES after. No evidence → say so; do not imply certainty you don't have.
- **Separate "gate green" from "behavior verified."** In the handoff, explicitly list what you verified and HOW, and what you did NOT/could not verify headless. For runtime behavior, write `gate green; runtime UNVERIFIED — needs windowed/capture/playtest`, never "fixed"/"works".
- **Use the right verifier for the behavior:**
  - **Movement / nav / physics / logic** = NO GPU needed → IS headless-testable. Write a SceneTree smoke that steps physics frames and ASSERTS the outcome (e.g. enemy `global_position` moves toward its target). Verifying a poly count or that a resource loads is NOT verifying movement.
  - **Rendering (does it draw?) / audio (how it sounds)** = needs the real-renderer capture capability or a human playtest. Confirming a node exists / `visible=true` / a `.wav` byte-changed is necessary but NOT sufficient — say which you did.
- **Don't fix by guessing.** If you cannot identify the root cause with evidence, report that honestly and request the capture/playtest signal — do not ship a speculative change labelled as a fix.

## Error → Fix

| Output                                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `would reformat <file>` (step 1)                                                                         | Run `gdformat <file>` — never hand-format                                                                                                                                                                                                                                                                                                                                                  |
| `max-line-length` (step 2)                                                                               | Split line; long comments wrap to own `#` lines                                                                                                                                                                                                                                                                                                                                            |
| `max-lines` (file >500)                                                                                  | Extract cohesive steps into helper funcs/files (see godot-composition) — do NOT trim comments to sit at the cap; hitting 500 is a split signal, not a formatting nuisance                                                                                                                                                                                                                  |
| `class-definitions-order` (step 2)                                                                       | Reorder per File anatomy                                                                                                                                                                                                                                                                                                                                                                   |
| `UNTYPED_DECLARATION` (step 3)                                                                           | Add `: Type` or use `:=` with obvious RHS                                                                                                                                                                                                                                                                                                                                                  |
| `UNSAFE_PROPERTY_ACCESS` / `UNSAFE_METHOD_ACCESS`                                                        | Typed ref if wiring down; SEAM + ignore if gameplay boundary                                                                                                                                                                                                                                                                                                                               |
| `UNSAFE_CALL_ARGUMENT`                                                                                   | Explicit-convert engine Variants `float(ProjectSettings.get_setting(...))` — prescribed form, but STILL needs `@warning_ignore("unsafe_call_argument")` (ignore moves here from `unsafe_cast`, not eliminated)                                                                                                                                                                             |
| Hardcoded window/viewport/resolution literal, or `get_window()` size used for camera/raycast/aspect math | Static project config → `ProjectSettings.get_setting("display/window/size/...")`; runtime render size → the active camera's own viewport `get_viewport().get_visible_rect().size` — NEVER a literal and NEVER `get_window()` (that's the OS window, not the camera that rendered the frame; wrong under a SubViewport / split-screen rig)                                                  |
| `INTEGER_DIVISION`                                                                                       | `float()` one operand, or reason + `@warning_ignore("integer_division")` if integral math intended                                                                                                                                                                                                                                                                                         |
| `UNUSED_PARAMETER`                                                                                       | Prefix with `_`                                                                                                                                                                                                                                                                                                                                                                            |
| `SHADOWED_VARIABLE_BASE_CLASS`                                                                           | Rename — collides with base-class member (e.g. `root` on SceneTree script → `scene_root`)                                                                                                                                                                                                                                                                                                  |
| `SHADOWED_GLOBAL_IDENTIFIER` on an autoload script                                                       | Autoload `class_name` equals its autoload key → make them differ. Pattern that passes the per-file gate: give the script a `class_name` distinct from the autoload key, make persisted fields `static var`, and access them via the `class_name` (`MyData.field`), NOT the singleton name — `--check-only` analyzes each file in isolation and does not inject autoload singletons by name |
| Step 5 fails on engine WARNING unrelated to change                                                       | Still failure — investigate; smoke grep is deliberately strict                                                                                                                                                                                                                                                                                                                             |
| Step 5 smoke (or step 3 parse) FAILs on a `push_warning`/`push_error` I added in `_ready()`              | The smoke/parse grep flags every WARNING/ERROR line, including deliberate ones fired at scene load. Move the diagnostic to the real failure branch (a guard that only fires on bad input), not `_ready()`; for an always-on note use a `#` comment. Do NOT widen the `validate.sh` exclusion list.                                                                                         |
| `@warning_ignore("unsafe_method_access")` above `if x.has_method(...)` still errors                      | The directive binds to the NEXT statement; the unsafe call is the bare call INSIDE the guard, not the `if` line. Put the `# SEAM:` comment + `@warning_ignore` directly above the call itself (an early-return guard, then the ignored bare call), not above the `has_method` check.                                                                                                       |
| New `class_name` script / `.tres` has no `.uid` (missing sidecar after a headless write)                 | The editor importer generates `.uid` sidecars — a headless write without an import leaves them missing. Run `$GODOT --headless --path . --import` to generate them (`validate.sh` step 3 already does this). NEVER hand-author a `.uid` file.                                                                                                                                              |
| Out-of-range / typo value silently accepted on a complex-system tunable (negative health, absurd radius) | Annotate the numeric tunable `@export_range(min, max[, step])` so the Inspector bounds it; group many fields with `@export_group`. See Inspector `@export` hints above.                                                                                                                                                                                                                    |
| `@tool` script crashes/errors in the editor (null game state at edit time)                               | Guard all editor-time code with `if Engine.is_editor_hint():`; assume no scene/game state exists. Only use `@tool` when edit-time behavior is genuinely needed.                                                                                                                                                                                                                            |

## Warnings reference (ground truth = project.godot [debug])

Escalated to error (2): `untyped_declaration`, `unsafe_property_access`, `unsafe_method_access`, `unsafe_cast`, `unsafe_call_argument`, `unused_variable`, `unused_local_constant`, `unused_private_class_variable`, `shadowed_variable`, `shadowed_variable_base_class`, `shadowed_global_identifier`, `unreachable_code`, `unreachable_pattern`, `standalone_expression`, `integer_division`, `incompatible_ternary`, `confusable_identifier`, `assert_always_true`, `assert_always_false`.

Deliberate non-rules (left at default 0):

- `inferred_declaration=0` — `:=` encouraged; inference is typing.
- `return_value_discarded=0` — fires on every `connect()`/`move_and_slide()`; no clean TS mapping.
