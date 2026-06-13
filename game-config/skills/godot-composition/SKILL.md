---
name: godot-composition
description: Composition conventions for this Godot project — "SOLID translated to Godot": component nodes over inheritance, signals up / calls down, scene as the unit of composition, and the explicit rules for WHEN to modularize (and when not to). Load this skill before structuring any entity with more than one behavior, before any refactor/extraction, when a script grows past one job, or when someone proposes a base-class hierarchy or an autoload for shared behavior.
---

# Godot Composition (SOLID, translated)

Build entities by **composing small component nodes**, not by inheriting behavior. This is the Godot-native reading of SOLID: nodes are cheap, scenes are composable, signals are the interface.

## The rules

1. **Composition over inheritance.** An entity is a base engine node (`CharacterBody3D`, `Area3D`, …) plus component children (`Health`, `Hitbox`, `MoveInput`). Subclass engine types directly when you need their physics/rendering; never build your own inheritance trees for shared behavior.
2. **One script, one job** (single responsibility). The node name states the job (`Health`, not `Manager`). If you can't name it without "And", split it.
3. **Signals up, calls down.** Parents call methods on their children; children report upward only by emitting signals. A component never does `get_parent().something()`, never uses absolute node paths, never assumes its parent's type.
4. **Scene is the unit of composition.** A component used by more than one entity becomes its own scene in `entities/components/<name>/` (scene + script, names match). Entity-local components stay inside the entity's folder.
5. **Dependencies are injected** (dependency inversion). Components receive what they need via `@export var target: Node3D`-style exports wired by the composing scene — never by reaching into the tree to find it.
6. **Depend on signals and duck typing, not concrete types** (interface segregation). `if body.has_method("take_damage")` or signal connections — not `if body is Player`.

## When to modularize — and when NOT to

Extract a component only when one of these is true:

- A **second consumer** exists _in the current agreed scope_ (not a hypothetical one).
- A script demonstrably does **two jobs** (rule 2 fails).
- A design doc names a mechanic as **reusable**.

Otherwise: keep the simplest thing that works. Premature extraction is scope creep in disguise — a `Health` component for the only entity that has health is structure paid for and not used. The framework adds components **on demand**, via the godot-refactor agent, not by default.

## Anti-patterns (refuse these)

| Smell                                                          | Instead                                           |
| -------------------------------------------------------------- | ------------------------------------------------- |
| God script on the entity root doing input + movement + combat  | one component child per job                       |
| `class_name Enemy extends BaseEntity extends …` behavior trees | components on a flat engine-node base             |
| Autoload used to share behavior between entities               | a component scene each entity instances           |
| Component calling `get_parent()` / `$"../.."`                  | signal up, or an `@export` injected by the parent |
| Extracting "because we might need it later"                    | wait for the second consumer                      |

## Refactor protocol (for mechanical extraction)

1. Run godot-verify first — the baseline must be clean before touching anything.
2. Extract: move lines, don't rewrite them. New API surface (names, signals, exports) is limited to what the extraction itself requires.
3. Re-wire via exports and signals per the rules above.
4. Run godot-verify again — both layers. The scene tree may change; behavior must not.
5. If the extraction requires a design decision (which parts are the shared behavior, what the component API should be), STOP and report the options — that judgment belongs to the designer/user, not the refactor.
