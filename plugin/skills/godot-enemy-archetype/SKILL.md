---
name: godot-enemy-archetype
agents: [godot-enemy]
description: The STATEFUL flavour of data-driven composition (Godot 4.x) — trait-mixing enemies via an `EnemyArchetype` Resource (`.tres`: stats + an ordered list of behaviour `PackedScene`s) whose pieces are stateful `EnemyBehaviour` child NODES instanced fresh per enemy, NOT stateless Resources. One generic `Enemy` scene reads the archetype at spawn; behaviours plug into its attack/movement seams. A trait-mix (tank + magnet, tank + shooter) is a new `.tres`, no subclass, no code. Use when "trait-mixing", "enemy archetype", "tank that also shoots", "data-driven enemy" appears. Builds on `godot-data-driven-composition`; the stateless sibling is `godot-effect-composition`. Composes `godot-enemy-ai` (FSM, no BTs), `godot-composition`, `godot-shooter-enemy-combat` (hit/death contract).
---

# Enemy archetypes — the stateful flavour (trait-mixing enemies)

Builds on **`godot-data-driven-composition`** (read it first). This flavour fixes the part-shape to
**stateful, per-frame `Node` behaviours**, because an enemy behaviour is the wrong shape for a
stateless Resource:

- it is **per-frame** (`_physics_process`: hover spring, magnet contact poll, bob sine),
- it is **stateful per instance** (dive-in-progress guard, telegraph lock, hit counter, group
  membership, accumulated bob time),
- it **hooks engine seams** (`move_and_slide`, `create_tween`, `look_at`, nav-velocity callbacks),
- it **owns child nodes / materials** (the magnet bubble mesh, tinted surface materials).

So the ARCHETYPE is the typed `.tres` carrier (stats + an ordered piece list), but the pieces it
lists are **NODES** (`extends EnemyBehaviour extends Node`), instanced fresh per enemy — exactly
the child-component model `godot-composition` prescribes for stateful per-entity behaviour. Data
rides the Resource; live behaviour rides nodes. (The stateless contrast and the `.tres`-sharing
reason this matters live in the base skill; `godot-effect-composition` is the stateless sibling.)

## Requirements

- `godot-data-driven-composition` — the shared core (carrier, parts, guarded seam, `.tres`
  variants). This skill assumes it.
- `godot-code-rules` — `EnemyArchetype` and every behaviour is strict typed GDScript; numeric stats
  use `@export_range`, grouped with `@export_group`; behaviour seams go through `has_method` +
  `@warning_ignore("unsafe_method_access")`.
- `godot-composition` — behaviours are component child NODES under an `Abilities` container; signals
  up / calls down. `bind(enemy)` is calls-down. Extract a behaviour only when a variant needs it.
- `godot-enemy-ai` — the enemy keeps its native nav + node-FSM. Behaviours plug INTO the existing
  `perform_attack` / movement seams; they do NOT replace the FSM. **NO behaviour trees.**
- `godot-shooter-enemy-combat` — the archetype MUST preserve the duck-typed `on_hit()` / `apply_damage`
  / `died(enemy)` contract and the child `HealthComponent`. Stats only seed `HealthComponent`.

## Project conventions

Engine-agnostic shape; adapt paths/names to the host project.

- Archetype Resource: `EnemyArchetype extends Resource` — stats only (`@export_range` each numeric,
  `tint_color`, `display_name`) plus `@export var behaviours: Array[PackedScene]`. No per-frame
  logic. Put it with the reusable enemy lib (e.g. `tools/lib/enemy/`).
- Behaviour base: `EnemyBehaviour extends Node` — defines the OPTIONAL seam methods as no-op
  virtuals. Beside the archetype.
- Behaviour pieces: one scene+script per piece in `entities/enemy/behaviours/`, each
  `extends EnemyBehaviour`, owning its own `@export` tunables, tints, child nodes.
- Generic enemy scene: the ONE `entities/enemy/enemy.tscn` (`class_name Enemy`), with an
  `Abilities: Node` child + a child `HealthComponent`.
- Archetypes: `.tres` files in `archetypes/`. Node names PascalCase; files/folders snake_case.

## The pattern (four parts)

1. **`EnemyArchetype` Resource = the data** (`.tres`): stats + an ordered piece list.

   ```gdscript
   class_name EnemyArchetype
   extends Resource

   @export_group("Identity")
   @export var display_name: String = "Grunt"
   @export var tint_color: Color = Color.WHITE

   @export_group("Stats")
   @export_range(1, 50, 1) var max_health: int = 2
   @export_range(0.5, 20.0, 0.1) var move_speed: float = 3.5
   @export_range(1, 100, 1) var score_value: int = 1
   # ... patrol_speed, detect_range, attack_range, escape_range, attack_cooldown ...

   @export_group("Behaviours")
   ## Ordered behaviour-component scenes (each root extends EnemyBehaviour).
   ## Empty = default melee. Instanced under Enemy/Abilities at spawn.
   @export var behaviours: Array[PackedScene] = []
   ```

2. **`EnemyBehaviour` Node base = the seam contract.** Optional virtuals the enemy calls only via
   `has_method` — a behaviour overrides just the ones for its role:

   ```gdscript
   class_name EnemyBehaviour
   extends Node

   func bind(_enemy: Node) -> void: pass            # once after instancing; store the enemy ref

   # Attack role — overrides the default melee:
   func do_attack() -> void: pass

   # Movement role — overrides the default gravity-nav walk:
   func wants_nav_velocity() -> bool: return false  # true = I drive movement
   func drive_move(_speed: float, _delta: float) -> void: pass
   func drive_stop(_delta: float) -> void: pass
   func blocks_nav_velocity() -> bool: return false # true = suppress nav callback (e.g. mid-dive)
   func pre_set_destination(point: Vector3) -> Vector3: return point  # e.g. flyer clamps Y
   ```

   A behaviour is per-frame/stateful by overriding `_physics_process` and holding its own vars —
   exactly why it is a Node, not a Resource.

3. **The generic `Enemy` reads the archetype at spawn.** In `_ready()`: seed stats, instance + bind
   behaviours, then preserve the bottom-up HealthComponent ordering:

   ```gdscript
   @export var archetype: EnemyArchetype
   @onready var _abilities: Node = $Abilities
   @onready var _health_comp: HealthComponent = $HealthComponent

   func _ready() -> void:
       if archetype != null:
           health = archetype.max_health
           score_value = archetype.score_value
           move_speed = archetype.move_speed
           if archetype.tint_color != Color.WHITE:
               _apply_tint(archetype.tint_color)
           for scene: PackedScene in archetype.behaviours:
               var beh: Node = scene.instantiate()
               _abilities.add_child(beh)
               if beh.has_method("bind"):
                   @warning_ignore("unsafe_method_access")
                   beh.bind(self)
       # Seed HealthComponent AFTER stats, then reset — child _ready ran first (bottom-up).
       _health_comp.max_health = health
       _health_comp.reset()
       _health_comp.died.connect(_on_health_comp_died)
   ```

4. **The enemy's seams delegate to bound behaviours, else fall back.** Each seam loops `Abilities`
   children, duck-checks the role method, delegates if present, else runs the built-in default:

   ```gdscript
   func perform_attack() -> void:
       for child: Node in _abilities.get_children():
           if child.has_method("do_attack"):
               @warning_ignore("unsafe_method_access")
               child.do_attack()
               return
       _default_melee_lunge()   # archetype-free / behaviour-free path unchanged
   ```

   The enemy stays THIN: it owns nav / perception / health / death; behaviours own how-it-fights and
   how-it-moves. The hit/death contract (`on_hit` → `apply_damage` → HealthComponent → `died`) is
   untouched — `godot-shooter-enemy-combat` still holds.

**Trait-mixing is the payoff.** A behaviour piece binds to whatever stats the archetype carries:

- `tank_magnet.tres` = tank stats + `[MagnetBehaviour]` → tanky AND pulls bullets.
- `tank_shooter.tres` = tank stats + `[ShooterAttack]` → tanky AND fires telegraphed shots.
- `tank.tres` / `runner.tres` = pure stat + tint, `behaviours = []` → no behaviour node.

None is a subclass. That reuse — one behaviour composing with any stat set — IS the win, exactly as
WHAT-from-WHOM is in `godot-effect-composition`.

## Steps (apply the pattern to a project)

1. **Write `EnemyArchetype`** (part 1). Author one `grunt.tres` with no behaviours that reproduces
   the plain enemy — proves the generic scene + archetype path before any behaviour exists.
2. **Write `EnemyBehaviour`** (part 2) — the no-op virtual base, reused by every piece.
3. **Add the seams to the generic `Enemy`** (parts 3–4) — `@export var archetype`, the seed+instance
   loop, the `has_method`-guarded delegation. Keep every built-in default as the no-archetype
   fallback so existing subclasses and the bare scene still work.
4. **Extract behaviour pieces from existing subclasses** — MOVE the logic, don't rewrite it. Each
   `extends EnemyBehaviour`, owns its `@export`s, does setup in `bind()`.
5. **Author archetypes** — mix stats + a behaviour list per `.tres`. A trait-mix is a new `.tres`.
6. **Spawn by archetype** — give the wave/spawner an `EnemyArchetype` slot; set `enemy.archetype`
   BEFORE `add_child` so `_ready()` seeds from it. Leave PackedScene spawn slots as a fallback.
7. **Headless-smoke the seams** (`godot-runtime-smoke`) — boot the generic scene with an archetype,
   assert `HealthComponent.max_health == archetype.max_health`, hits → `died` once, `score_value`
   matches; for a trait-mix assert the behaviour's observable. A smoke that can't fail proves nothing.

## Incremental migration (NO big-bang rewrite)

The archetype path is ADDITIVE — `@export var archetype` defaults null, and when null the enemy uses
its manually-set `@export` stats exactly as before. Migrate one type at a time:

1. Land the generic scene + archetype reading with `archetype == null` falling through to today's
   behaviour. Existing `extends Enemy` subclasses keep working untouched.
2. Migrate the **trivial stat-only variants first** (tank, runner = stats+tint, no behaviour).
3. **Extract** a complex subclass's logic into a behaviour piece (step 4) — but KEEP the standalone
   subclass working in parallel until its behaviour piece is proven in a smoke + a windowed run.
4. The spawner accepts archetype-or-PackedScene per slot, so both coexist in one wave.

## Verification checklist

- A grunt archetype with `behaviours = []` reproduces the plain enemy: walks, patrols, chases, takes
  hits, dies, emits `died` once, awards score.
- A NEW enemy is authored as a `.tres` ONLY (stat mix + behaviour list) with no script edit.
- A trait-mix proves composition: tank+magnet is tanky AND pulls bullets; tank+shooter is tanky AND
  fires — neither exists as a subclass.
- `HealthComponent.max_health` after spawn equals `archetype.max_health`; the
  `on_hit`/`apply_damage`/`died` contract is unchanged.
- An archetype-driven enemy and a legacy subclass enemy coexist in one wave with no errors.

## Error → Fix

| Symptom                                                                          | Fix                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Behaviour modelled as an `Effect` Resource — no `_physics_process`, state bleeds | Wrong flavour. Enemy behaviour is stateful/per-frame → a child `Node` (`extends EnemyBehaviour`), not a Resource. (See the base's stateless-vs-stateful decision.)                    |
| All enemies of a type flash/tint together, or share a counter                    | Behaviours are fresh node instances per enemy; `duplicate()` materials before mutating (`set_surface_override_material`).                                                             |
| `HealthComponent.max_health` stays at the component default                      | Child `_ready()` runs before the parent's (bottom-up). Seed `_health_comp.max_health = health` then `_health_comp.reset()` in the ENEMY's `_ready()`, after applying archetype stats. |
| `bind()` reads `global_position` and it's wrong / zero                           | `_ready()`/`bind()` fire before the spawner sets `global_position`. Defer position-dependent setup with `call_deferred`.                                                              |
| Adding a behaviour forces edits to `enemy.gd`                                    | The enemy must only loop `Abilities` + duck-check role methods; a new piece is a new scene + a `.tres`. Widen the contract once, not per piece.                                       |
| Tempted to reach for a behaviour tree                                            | Banned by `godot-enemy-ai`. The FSM stays; a behaviour plugs into `do_attack`/movement seams and runs its own tween/timer state internally.                                           |
| Two attack behaviours, only the first fires                                      | This contract resolves the FIRST `do_attack` child (single attack role). Multi-attack stacking is out of scope — park it until a combo needs it.                                      |

---

The stateful flavour of `godot-data-driven-composition`; stateless sibling `godot-effect-composition`. Composes `godot-enemy-ai` (FSM, no BTs), `godot-composition`, `godot-shooter-enemy-combat` — cross-referenced, not duplicated.
