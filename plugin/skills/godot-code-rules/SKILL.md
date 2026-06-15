---
name: godot-code-rules
description: Strict typed-GDScript rules (the tsconfig-strict + ESLint equivalent) — full typing, explicit return types, warnings-as-errors, size caps, file headers, @warning_ignore policy, gated by tools/validate.sh. Load BEFORE writing or editing ANY .gd file, when validate.sh / gdlint / gdformat fails, on a typed-GDScript error (UNTYPED_DECLARATION, UNSAFE_*), or when deciding whether code may use Variant, duck typing, or @warning_ignore.
---

# Godot Code Rules (strict mode)

GDScript strict mode = TypeScript strict, enforced by: `project.godot [debug]` warnings→errors, `gdlint`/`gdformat` with `gdlintrc`, and this skill for what no tool checks.

## The contract

| Strict TS / ESLint           | Rule                                                                                                                                            | Enforced by                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `no-explicit-any`            | No untyped declarations. Every `var`, param, return typed. `Variant` only at `# SEAM:`                                                          | `untyped_declaration=2`              |
| type inference               | `:=` encouraged when RHS makes type obvious (`var dir := Vector2.ZERO`)                                                                         | `inferred_declaration=0`, deliberate |
| explicit return types        | `-> Type` on **every** func, including `-> void`                                                                                                | `untyped_declaration=2`              |
| `no-unsafe-*`                | No property/method access, cast, or call argument the analyzer can't prove. Fix with typed refs or SEAM                                         | `unsafe_*=2`                         |
| `strict-boolean-expressions` | Truthiness ONLY for Object null checks (`if node:`). Never on String/int/float/Array/Dict/Vector — use `.is_empty()`, `!= 0`, `!= Vector3.ZERO` | **agent only**                       |
| `no-unused-vars` + `^_`      | Unused locals = errors; unused params get `_` prefix (`_delta`)                                                                                 | `unused_variable=2`                  |
| `max-lines`                  | File ≤500 lines, line ≤100 chars, params ≤8, returns ≤6, public methods ≤20                                                                     | gdlint                               |
| `max-lines-per-function`     | Func ≤~100 effective lines, nesting ≤6                                                                                                          | **agent only**                       |
| `no-console`                 | `print()` only for deliberate player/dev-facing output; problems use `push_warning()`/`push_error()`                                            | **agent only**                       |

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

## The gate — tools/validate.sh

Run after every `.gd`/`.tscn` change, before reporting:

```bash
tools/validate.sh
```

Steps: 1 format (`gdformat --check`) → 2 lint (`gdlint`) → 3 parse + analyzer warnings-as-errors → 4 scene properties (godot-verify layer 1) → 5 headless smoke run (layer 2). Stops at first failure; ends with `validate: OK`.

- Never weaken `project.godot [debug]` warnings or `gdlintrc` caps to make the gate pass.
- Never pipe gate output through `rtk grep` — hides FAIL lines; use plain `grep`.

## Error → Fix

| Output                                             | Fix                                                                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `would reformat <file>` (step 1)                   | Run `gdformat <file>` — never hand-format                                                                                                                                                                      |
| `max-line-length` (step 2)                         | Split line; long comments wrap to own `#` lines                                                                                                                                                                |
| `class-definitions-order` (step 2)                 | Reorder per File anatomy                                                                                                                                                                                       |
| `UNTYPED_DECLARATION` (step 3)                     | Add `: Type` or use `:=` with obvious RHS                                                                                                                                                                      |
| `UNSAFE_PROPERTY_ACCESS` / `UNSAFE_METHOD_ACCESS`  | Typed ref if wiring down; SEAM + ignore if gameplay boundary                                                                                                                                                   |
| `UNSAFE_CALL_ARGUMENT`                             | Explicit-convert engine Variants `float(ProjectSettings.get_setting(...))` — prescribed form, but STILL needs `@warning_ignore("unsafe_call_argument")` (ignore moves here from `unsafe_cast`, not eliminated) |
| `INTEGER_DIVISION`                                 | `float()` one operand, or reason + `@warning_ignore("integer_division")` if integral math intended                                                                                                             |
| `UNUSED_PARAMETER`                                 | Prefix with `_`                                                                                                                                                                                                |
| `SHADOWED_VARIABLE_BASE_CLASS`                     | Rename — collides with base-class member (e.g. `root` on SceneTree script → `scene_root`)                                                                                                                      |
| Step 5 fails on engine WARNING unrelated to change | Still failure — investigate; smoke grep is deliberately strict                                                                                                                                                 |

## Warnings reference (ground truth = project.godot [debug])

Escalated to error (2): `untyped_declaration`, `unsafe_property_access`, `unsafe_method_access`, `unsafe_cast`, `unsafe_call_argument`, `unused_variable`, `unused_local_constant`, `unused_private_class_variable`, `shadowed_variable`, `shadowed_variable_base_class`, `shadowed_global_identifier`, `unreachable_code`, `unreachable_pattern`, `standalone_expression`, `integer_division`, `incompatible_ternary`, `confusable_identifier`, `assert_always_true`, `assert_always_false`.

Deliberate non-rules (left at default 0):

- `inferred_declaration=0` — `:=` encouraged; inference is typing.
- `return_value_discarded=0` — fires on every `connect()`/`move_and_slide()`; no clean TS mapping.
