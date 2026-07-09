---
name: godot-composition
agents: [builders]
domain: godot-core
description: Composition conventions ("SOLID translated to Godot") — component nodes over inheritance, signals up / calls down, scene as the unit of composition, and when (not) to modularize. Load before structuring an entity with more than one behavior, before any refactor/extraction, when a script grows past one job, or when someone proposes a base-class hierarchy or a shared-behavior autoload.
---

# Godot Composition (SOLID, translated)

Build entities by **composing small component nodes**, not by inheriting behavior. This is the Godot-native reading of SOLID: nodes are cheap, scenes are composable, signals are the interface.

## The rules

1. **Composition over inheritance.** An entity is a base engine node (`CharacterBody3D`, `Area3D`, …) plus component children (`Health`, `Hitbox`, `MoveInput`). Subclass engine types directly when you need their physics/rendering; never build your own inheritance trees for shared behavior.
2. **One script, one job** (single responsibility). The node name states the job (`Health`, not `Manager`). If you can't name it without "And", split it.
3. **Signals up, calls down.** Parents call methods on their children; children report upward only by emitting signals. A component never does `get_parent().something()`, never uses absolute node paths, never assumes its parent's type.
4. **Scene is the unit of composition.** A component used by more than one entity becomes its own scene in `entities/components/<name>/` (scene + script, names match). Entity-local components stay inside the entity's folder.
5. **Dependencies are injected** (dependency inversion). Node components receive what they need via `@export var target: Node3D`-style exports wired by the composing scene; pure (non-Node) logic/model classes (`RefCounted`/`Object`) receive theirs via `_init(...)` constructor params. Never reach into the tree, an autoload, or a global service-locator to find a dependency — that hidden coupling is the violation, and constructor-injected pure classes stay unit-testable and engine-portable.
6. **Depend on signals and duck typing, not concrete types** (interface segregation). `if body.has_method("take_damage")` or signal connections — not `if body is Player`.
7. **Data-only variants are `@export`, not subclasses.** A variant that differs only in data — a colour, a speed, a scene — is an `@export` on one script set per-scene, NOT a subclass. Two `extends Enemy` stubs that only assign a different tint constant collapse into `@export var tint_color: Color` on `Enemy`.

## Signal hygiene

Signals are the composition interface (rules 3 & 6); keep them disciplined.

- **Guard before disconnect.** Call `is_connected(sig, callable)` before `disconnect(...)` — disconnecting an already-disconnected signal throws. Connect idempotently the same way (`if not is_connected(...): connect(...)`).
- **Name signals for the event, with one canonical name per event.** A signal is named for the **fact that happened** (past tense — `died`, `hit_confirmed`, `health_changed`), not for the command a listener should run (`update_hud`). One event → one signal name, declared once on the entity that owns the event; listeners adapt to it. Don't mirror the same fact under two names or hold the same state in two places.
- **Type the payload; pass data, not nodes.** Declare params with types — `signal health_changed(current: int, max: int)`, not bare `signal health_changed`. Emit the values a listener needs (an amount, an id, a position), not the emitter node, wherever practical — passing the node re-introduces the concrete-type coupling rule 6 removes.
- **Fire-and-forget — the emitter never awaits its listener.** `emit_signal` / `sig.emit(...)` returns immediately; don't `await` a connected handler or assume any listener ran. The emitter announces the fact and moves on; ordering or completion across listeners is not the emitter's concern. (Signals up / calls down — rule 3.)

These keep the seam decoupled **without** a global signal-bus / event-bus autoload. Routing every signal through one shared autoload re-creates the hidden coupling rules 5 & 6 forbid — inject the emitter via `@export` and connect to it directly, or reach it through a duck-typed seam. No autoload-as-message-broker.

## When to modularize — and when NOT to

Extract a component only when one of these is true:

- A **second consumer** exists _in the current agreed scope_ (not a hypothetical one).
- A script demonstrably does **two jobs** (rule 2 fails).
- A design doc names a mechanic as **reusable**.

Otherwise: keep the simplest thing that works. Premature extraction is scope creep in disguise — a `Health` component for the only entity that has health is structure paid for and not used. The framework adds components **on demand**, via the godot-refactor agent, not by default.

**Where extraction goes.** A reusable _behavior with state_ (health, hitbox, input) is a **component scene** in `entities/components/<name>/` (rule 4). A reusable _stateless function_ (node-building, a tween flash, a one-shot SFX, a safe lookup) is a `class_name` **static util in `tools/lib/`** (referenced by bare class name; see the DRY rule in godot-code-rules). Don't grow a component for what is really a function.

## Anti-patterns (refuse these)

| Smell                                                             | Instead                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| God script on the entity root doing input + movement + combat     | one component child per job                                    |
| `class_name Enemy extends BaseEntity extends …` behavior trees    | components on a flat engine-node base                          |
| Autoload used to share behavior between entities                  | a component scene each entity instances                        |
| Component calling `get_parent()` / `$"../.."`                     | signal up, or an `@export` injected by the parent              |
| Extracting "because we might need it later"                       | wait for the second consumer                                   |
| Second `extends MyEntity` stub that only changes a constant       | one script + an `@export` set per-scene (rule 7)               |
| Repeated `get_tree().get_first_node_in_group(...)` for one target | route through a `tools/lib/` accessor, or inject via `@export` |

## Refactor protocol (for mechanical extraction)

1. Run godot-verify first — the baseline must be clean before touching anything.
2. Extract: move lines, don't rewrite them. New API surface (names, signals, exports) is limited to what the extraction itself requires.
3. Re-wire via exports and signals per the rules above.
4. Run godot-verify again — both layers. The scene tree may change; behavior must not.
5. If the extraction requires a design decision (which parts are the shared behavior, what the component API should be), STOP and report the options — that judgment belongs to the designer/user, not the refactor.
