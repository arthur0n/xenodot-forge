---
name: godot-data-driven-composition
agents: [godot-enemy, godot-weapons-abilities]
domain: godot-core
description: The GENERIC data-driven composition pattern in Godot 4.x — a typed `.tres` Resource carrier holds an ordered list of typed, composable pieces, so new variants are authored as DATA (a new `.tres`), not code. The shared base for the two flavours — stateless fire-once `Effect` Resources (`godot-effect-composition`) and stateful per-frame `Node` behaviours (`godot-enemy-archetype`). Use when designing ANY "carrier + ordered pieces" system (abilities, enemies, items, traps, status effects) and deciding how to structure it so designers edit resources, not scripts. Pick the flavour by piece-shape (stateless vs stateful) — this skill is the shared core + that decision.
---

# Data-driven composition (Godot 4.x) — the shared core

Any "a thing made of an ordered set of composable parts" system — abilities (effects), enemies
(behaviours), items, traps, status stacks — wants the SAME backbone: a typed Resource that
CARRIES the data and lists the parts, parts that compose without subclassing, and new variants
authored as `.tres` rather than code. This skill is that backbone. The two flavours that build on
it differ on ONE axis — whether a part is STATELESS (a fire-once Resource) or STATEFUL (a
per-frame Node) — and live in their own skills.

## Requirements

- `godot-code-rules` (or the project's strict-typing gate) — every Resource/part is strict typed
  GDScript: line-1 path header, `class_name`, typed `@export`s/returns; duck-typed seams guarded
  with `has_method` + `@warning_ignore("unsafe_method_access")`. Load BEFORE writing.
- `godot-composition` — parts compose as data (Resource sub-resources) or child component Nodes;
  signals up / calls down; no god-object manager by default.

## The core shape (both flavours)

1. **Carrier = a typed `Resource` (`.tres`, NOT JSON).** Holds metadata + an ordered `@export`
   list of parts (+ optional config such as a resolver). Prefer `.tres`: Godot gives typed
   sub-resources, in-editor authoring, and load-time type checks for free; JSON throws all three
   away.
2. **Parts = typed, composable units** listed on the carrier, each owning its own `@export`
   tunables. Composing parts = a new combination, never a new subclass.
3. **Guarded duck-typed seam.** A part reaches its host/target through a `has_method` guard (then
   `@warning_ignore("unsafe_method_access")`), assuming no concrete type — so the same part works
   across hosts and a missing seam no-ops instead of crashing.
4. **New variant = a new `.tres`.** Mixing parts / swapping config in a resource is the authoring
   act; the call sites never change. That is the whole payoff.

## Pick the flavour — stateless vs stateful (the one decision)

The part-shape splits everything. Decide by what a part must DO:

|                       | stateless → `godot-effect-composition` | stateful → `godot-enemy-archetype`                    |
| --------------------- | -------------------------------------- | ----------------------------------------------------- |
| Part is a…            | **`Effect` Resource**                  | **`Node` behaviour**                                  |
| Lifecycle             | `apply(target, ctx)` fire-once         | `bind(host)` + `_physics_process` + tweens            |
| Per-instance state    | none (read-only tunables)              | yes (guards, counters, timers, owned nodes/materials) |
| Shared across loaders | YES — fine (stateless)                 | NO — fresh node instance per host                     |
| New part              | new `Effect` subclass / `.tres`        | new behaviour scene / `.tres`                         |

**Why it's load-bearing:** a `Resource` has no `_physics_process`, no scene-tree lifecycle, and a
`.tres` loaded twice SHARES its sub-resources across every loader. Perfect for a stateless effect,
FATAL for per-instance behaviour. So: stateless/fire-once → Resource parts (effect flavour);
per-frame/stateful/owns-nodes → Node parts (enemy flavour). Never model a stateful behaviour as an
`Effect` Resource.

## The `.tres` sharing caveat (decides the flavour)

A `.tres` loaded more than once shares its `@export` sub-resource objects across every loader.
Harmless while a part is stateless (read-only `amount`). The moment a part holds mutable
per-instance state, either make it a Node (stateful flavour) or, if it must stay a Resource, make
it unique — `resource_local_to_scene = true` on the sub-resource, or `duplicate(true)` the carrier
at load.

## When a central manager earns its place (and not before)

Keep iteration/application in the entity that OWNS the trigger (the spawned projectile, the enemy,
the trap). Introduce a manager component ONLY when a real need forces it — instigator-side effects
with no carrier, multi-stage / multi-spawn sequencing, or a prereq/cost gate that must validate
before anything spawns. Until then a manager is a god-object that re-centralizes what the
composition decentralized.

## Verification (both flavours)

- Strict-typing gate passes — every Resource/part typed, every duck-typed seam guarded.
- A new variant is authored as a `.tres` ONLY (part mix / config swap), no call-site edit, and it
  works.
- A part applied where the host lacks the seam method no-ops silently (no crash).
- Headless smoke (`godot-runtime-smoke`): load the `.tres`, run the real iteration loop against a
  stub/real host, assert the observable — and it FAILS if you break the loop (a test that can't
  fail proves nothing).
- **The carrier `.tres` is assigned non-null on the live node in the shipped scene** — not only
  loadable. Authored + read is TWO halves; the third is WIRED. Load the entity scene, instantiate,
  and assert `node.get(prop) != null` (the deterministic `check_scene_export_assigned(scene, node,
prop)` check). An `@export` that is authored and read but never assigned in the `.tscn` is a dead
  feature behind a green gate — and a smoke that INJECTS the resource itself proves the seam, not
  that production wires it, so it must be a SEPARATE check that reads the real scene without
  injecting. **Enroll the pair on the gate floor**: add a `<scene.tscn> <NodePath> <field>` line to
  `design/export-wiring.tsv` — `validate.sh` (`check_export_assigned`) runs every enrolled pair on
  each build; no file = SKIP.

## Error → Fix

| Symptom                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Want JSON config                                                | Use `.tres` typed Resources — typed sub-resources, editor authoring, load-time checks; JSON loses all three.                                                                                                                                                                                                                                                                        |
| `UNSAFE_METHOD_ACCESS` fails the strict gate                    | Annotate the guarded duck-typed call `@warning_ignore("unsafe_method_access")`; never lower warning levels.                                                                                                                                                                                                                                                                         |
| Part crashes on some hosts                                      | Don't assume a type — `has_method` guard, no-op when the seam is absent.                                                                                                                                                                                                                                                                                                            |
| State bleeds across instances / all share a counter or material | A `.tres` shares sub-resources across loaders. Stateless part → fine; stateful → use a Node (enemy flavour) or `duplicate()` the resource/material before mutating.                                                                                                                                                                                                                 |
| A central manager grew and owns everything                      | Move iteration back into the owning entity; a manager only validates prereqs / builds context for instigator-side or multi-stage cases.                                                                                                                                                                                                                                             |
| Adding a part forces call-site edits                            | The host must only iterate the part list + duck-check the role method; a new part is a new scene/`.tres`, never a call-site change. Widen the seam contract once, not per part.                                                                                                                                                                                                     |
| Smoke/gate passes but the feature is dead in the shipped scene  | A smoke bot INJECTED the `.tres`/dependency programmatically — it proves the seam, not that production wires it. Assert the live-node assignment with a SEPARATE `check_scene_export_assigned` / `smoke_*_wire_check.gd` that loads the real `.tscn` and reads `node.get(prop) != null` WITHOUT injecting. A bot that injects what production must wire manufactures a false green. |

---

Generic base. Flavours: `godot-effect-composition` (stateless effects → abilities / buffs / debuffs / dots), `godot-enemy-archetype` (stateful node behaviours → trait-mixing enemies).
