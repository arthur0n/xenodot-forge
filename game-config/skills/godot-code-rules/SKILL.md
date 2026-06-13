---
name: godot-code-rules
description: Strict GDScript code rules for this project — the tsconfig-strict + ESLint equivalent. Full typing (no untyped declarations, no Variant outside documented SEAMs), explicit return types, warnings-as-errors, size caps, file headers, and the @warning_ignore policy, all gated by tools/validate.sh. Load this skill BEFORE writing or editing ANY .gd file, whenever validate.sh / gdlint / gdformat fails, whenever a typed-GDScript error (UNTYPED_DECLARATION, UNSAFE_*) appears, or when deciding whether code may use Variant, duck typing, or @warning_ignore.
---

# Godot Code Rules (strict mode)

GDScript is optionally typed; this project removes the option. The rules below are strict
TypeScript translated to Godot, enforced by three mechanisms: `project.godot` `[debug]`
warnings escalated to errors (the "tsconfig strict"), `gdlint`/`gdformat` with `gdlintrc`
(the "eslint + prettier"), and this skill for what no tool checks (the agent is the linter).

## The contract (strict TS → GDScript)

| Strict TS / ESLint                     | Rule here                                                                                                                                                                         | Enforced by                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `no-explicit-any`                      | No untyped declarations. Every `var`, parameter, and return is typed. `Variant` only at a `# SEAM:` (below)                                                                       | `untyped_declaration=2`                      |
| type inference                         | `:=` is encouraged when the right side makes the type obvious (`var dir := Vector2.ZERO`) — inference is typing                                                                   | `inferred_declaration=0`, deliberate         |
| explicit return types                  | `-> Type` on **every** func, including `-> void`                                                                                                                                  | `untyped_declaration=2`                      |
| `no-unsafe-*`                          | No property/method access, cast, or call argument the analyzer can't prove. Fix with typed refs or a SEAM, never by weakening the config                                          | `unsafe_*=2`                                 |
| `strict-boolean-expressions`           | Truthiness ONLY for Object null checks (`if node:` — TS's `allowNullableObject`). Never on String/int/float/Array/Dictionary/Vector: use `.is_empty()`, `!= 0`, `!= Vector3.ZERO` | **agent only — no tool checks this**         |
| `no-unused-vars` + `^_`                | Unused locals are errors; an intentionally unused parameter gets a `_` prefix (`_delta`)                                                                                          | `unused_variable=2`, `unused_parameter` warn |
| `max-lines` 500 etc.                   | File ≤ 500 lines, line ≤ 100 chars, params ≤ 8, returns ≤ 6, public methods ≤ 20                                                                                                  | gdlint                                       |
| `max-lines-per-function`, `complexity` | Function ≤ ~100 effective lines, nesting ≤ 6 — gdlint has no rule for these                                                                                                       | **agent only**                               |
| `no-console`                           | `print()` only as deliberate player/dev-facing output; problems use `push_warning()` / `push_error()`                                                                             | **agent only**                               |

## File anatomy

Every `.gd` file, in this order (order is gdlint-enforced via `class-definitions-order`):

```gdscript
# entities/player/player.gd — player movement, jumping, and inventory.
class_name Player
extends CharacterBody3D
## Optional ## docstring for scripts with public API.

signal died                                  # snake_case, past tense

enum Kind { MESSAGE, INVENTORY }             # PascalCase / UPPER_SNAKE elements
const MAX_ITEMS := 8                         # UPPER_SNAKE_CASE
@export var speed: float = 5.0
var inventory: Array[String] = []            # public vars
var _gravity: float = 0.0                    # private: _ prefix
@onready var _mesh: MeshInstance3D = $Mesh   # @onready last, typed
```

- Line 1: `# <path from project root> — <one-line purpose>.` Greppable header, always.
- `class_name`: required for any entity/component script other scripts reference by type.
  Omit it for `main.gd` and `tools/` SceneTree scripts — nothing types against them.
- Indentation: tabs (gdformat is tab-only). Line length ≤ 100.
- Naming: snake*case functions/vars/signals, PascalCase classes/enums, UPPER_SNAKE consts,
  `*`prefix = private. Signal handlers:`_on_<Source>\_<signal>`.

## Escape hatches — exactly two greppable markers

**1. `@warning_ignore` — never bare.** Every ignore carries a one-line reason comment
immediately above it; a bare ignore is itself a violation. When the reason is a type
boundary (duck typing across entities, heterogeneous Variant storage), the comment uses
the `# SEAM:` prefix:

```gdscript
# SEAM: duck-typed pickup — any body with add_item() can collect (godot-composition rule).
@warning_ignore("unsafe_method_access")
player.add_item(item_name)
```

**2. `# FIXME(agent): <what and why>`** — a known deficiency left on purpose, phrased so a
future agent can fix it without archaeology.

Audit everything: `grep -rn "SEAM:\|FIXME(agent)" --include='*.gd' .`
Block form `@warning_ignore_start`/`@warning_ignore_restore` is allowed only in `tools/`
scripts, never in game code. A growing ignore count is a design smell — report it as friction.

**Typed ref vs SEAM — the decision rule:**

- Wiring **down** to a known node (main → CameraRig, entity → its child): use the typed
  `class_name` reference (`var rig: CameraRig = %CameraRig`). No ignore needed.
- Calling **across** entities at a gameplay boundary (`body` from a collision signal):
  duck typing + SEAM. Do NOT "fix" it with `is Player` / `as Player` — coupling entities
  to concrete types is the violation; see godot-composition.

## Boundary with godot-composition

This skill is **mechanics**: typing, sizes, headers, naming, annotations, the gate.
godot-composition is **structure**: when to extract components, signals up / calls down,
when NOT to modularize. Load both when restructuring; never resolve an `unsafe_*` error
by violating composition (concrete cross-entity types), and never justify a god script
by pointing at passing types.

## The gate — tools/validate.sh

Run after every change to `.gd`/`.tscn`, before reporting. From the project root:

```bash
tools/validate.sh        # via rtk: rtk tools/validate.sh (passthrough)
```

Steps: 1 format (`gdformat --check`) → 2 lint (`gdlint`) → 3 parse + analyzer
warnings-as-errors per file → 4 scene properties (godot-verify layer 1) → 5 headless
smoke run (layer 2). It stops at the first failure and ends with `validate: OK`.
godot-verify layer 3 (render) is separate — run it when an entry-point scene changed.

Hard rules:

- Never weaken `project.godot` `[debug]` warnings or `gdlintrc` caps to make the gate
  pass. Those are project-wide decisions for the human, recorded in CLAUDE.md.
- Warnings-as-errors means a violating script blocks F5 entirely. That is intended.
- Never pipe the gate's output through `rtk grep` — it summarizes and hides FAIL lines.

### Error → Fix

| Output                                                     | Fix                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `would reformat <file>` (step 1)                           | Run `gdformat <file>` — never hand-format                                                             |
| `max-line-length` (step 2)                                 | Split the line; long comments wrap to their own `#` lines                                             |
| `class-definitions-order` (step 2)                         | Reorder members per File anatomy above                                                                |
| `UNTYPED_DECLARATION` (step 3)                             | Add `: Type` or use `:=` with an obvious right side                                                   |
| `UNSAFE_PROPERTY_ACCESS` / `UNSAFE_METHOD_ACCESS`          | Typed ref if wiring down; SEAM + ignore if a gameplay boundary                                        |
| `UNSAFE_CALL_ARGUMENT`                                     | Wrap engine Variants in a constructor: `float(ProjectSettings.get_setting(...))`                      |
| `INTEGER_DIVISION`                                         | `float()` one operand, or reason + `@warning_ignore("integer_division")` if integral math is intended |
| `UNUSED_PARAMETER`                                         | Prefix with `_`                                                                                       |
| Step 5 fails on an engine WARNING unrelated to your change | Still a failure — investigate; the smoke grep is deliberately strict                                  |

## Warnings reference (ground truth = project.godot [debug])

Escalated to error (2): `untyped_declaration`, `unsafe_property_access`,
`unsafe_method_access`, `unsafe_cast`, `unsafe_call_argument`, `unused_variable`,
`unused_local_constant`, `unused_private_class_variable`, `shadowed_variable`,
`shadowed_variable_base_class`, `shadowed_global_identifier`, `unreachable_code`,
`unreachable_pattern`, `standalone_expression`, `integer_division`,
`incompatible_ternary`, `confusable_identifier`, `assert_always_true`,
`assert_always_false`.

Deliberate non-rules (left at their default 0, do not "fix"):

- `inferred_declaration=0` — `:=` is encouraged; strict TS allows inference too.
- `return_value_discarded=0` — would fire on every `connect()` / `move_and_slide()`;
  too noisy for GDScript. The TS analogue (`no-floating-promises`) has no clean mapping.

Deferred option (not active): a PostToolUse hook running gdlint on edited `.gd` files —
enforcement currently routes through agents running the gate.
