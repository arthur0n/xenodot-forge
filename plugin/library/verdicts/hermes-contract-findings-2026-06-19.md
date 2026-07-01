# Verdict — Hermes "reusable-systems contract" findings (2026-06-19)

Scope: Hermes recommendations on contract/data/typing patterns for DiceOfFate (Godot 4.6,
Forward+, composition-dominant FPS POC). Researcher = skill-researcher. NOT a library skill
adoption — these are framework-convention recommendations; no GodotPrompter skill copied. Verdict
is per-recommendation: existing skill / CLAUDE.md / new skill / nothing. Decision gated on user
(board question filed).

## Grounding (verified from repo)

- project.godot: `config/features=("4.6","Forward Plus")`, `config_version=5`.
- Composition-dominant. Player(CharacterBody3D) -> WeaponController(Node3D) routes input, owns
  recoil, swaps weapon/melee nodes, wires HUD. Signals up / calls down.
- Duck-typed seams in active use: `body.has_method("on_hit")`; one-shot `died` subscribe;
  `apply_knockback(Vector3)`; HUD `set_crosshair()`/`set_ammo_hud()` untyped; WaveManager via
  `find_child("WaveManager")` + `has_method("add_life")`.
- Variant DATA today: weapon stats = `@export` vars on weapon.gd; rifle.tscn = scene-inherited
  override. Enemy variants = `extends Enemy` subclasses overriding tint/health/score/one method.

## @abstract availability — VERIFIED

`@abstract` annotation + abstract `class_name` landed in **GDScript 4.4** (godotengine PR #67777,
shipped 4.4 stable). Project pinned to **4.6** -> feature present. Parse-time enforcement of
unimplemented `@abstract func` fits warnings-as-errors validate.sh gate. Feature is REAL and
usable here. (No local Godot binary on PATH to smoke-test; confirmed by version math + stable
docs, not faith.)

## Conflict with existing conventions — CENTRAL FINDING

Three loaded skills DELIBERATELY mandate duck-typing at the gameplay boundary; Hermes rec #1
contradicts all three:

- godot-composition rule 6: "Depend on signals and duck typing, not concrete types ...
  `if body.has_method("take_damage")` — not `if body is Player`."
- godot-code-rules (SEAM section): "Do NOT fix with `is Player`/`as Player` — coupling entities
  to concrete types is the violation."
- godot-shooter-enemy-combat: whole hit/kill contract is `has_method("on_hit")` + `has_signal("died")`.

These are intentional (engine-portability across Godot/Redot/Blazium; loose coupling). So rec #1
is not a free win — it would reverse a stated principle. Weigh against project rule "modularize /
formalize ON DEMAND only" (premature-abstraction guard).

## Per-recommendation verdict

### 1. `@abstract class_name` contract (Damagable/HitReceiver) replacing has_method seams

**REJECT (for now). Recommendation: reject.**

- Conflicts with godot-composition r6 + godot-code-rules SEAM policy + the entire
  godot-shooter-enemy-combat contract.
- Current seam count is small and works; no parse-time bug has bitten. "On demand" not met:
  one shootable type (enemy) today.
- The imminent NPC (StaticBody3D, entities/npc/npc.gd) becomes a SECOND shootable. Still only
  two — a shared `on_hit()` duck-typed seam (already specified by godot-shooter-enemy-combat) covers
  it with zero new abstraction. Make NPC implement `on_hit()`; do NOT introduce an abstract base.
- IF a third+ shootable arrives AND silent typo-on-method-name bugs appear, revisit: at that point
  an `@abstract class_name HitReceiver` is a legitimate hardening and would be a NEW skill
  (godot-hit-contract) or an addition to godot-shooter-enemy-combat — not a CLAUDE.md line.
- Park: pattern is valid 4.6, documented here for later.

### 2. WaveManager: replace find_child+has_method with @export injection or autoload

**PARTIAL — recommend the @export-injection half, reject autoload.**

- `find_child("WaveManager")` + `has_method("add_life")` is exactly the godot-composition
  anti-pattern ("Component calling get_parent()/reaching into tree" + repeated group/child lookup).
  Replacing with `@export var wave_manager: Node` injected by the level root is squarely IN our
  conventions (composition rule 5, dependency injection) — not new doctrine, just applying it.
- Autoload is explicitly discouraged (godot-composition: "Autoload used to share behavior ->
  a component scene"; CLAUDE.md "composition over autoloads"). Reject the autoload option.
- Home: no new skill. This is a godot-composition application — fix when WaveManager wiring is next
  touched. Optionally a one-line reinforcement in godot-composition anti-pattern table already
  covers it ("Repeated get_tree().get_first_node_in_group(...)"). Nothing to author.

### 3. Migrate variant DATA to Resources (WeaponData, EnemyStats extends Resource)

**DEFER. Recommendation: reject now, park.**

- godot-composition rule 7 already says "Data-only variants are `@export`, not subclasses" — which
  the WEAPON side already follows (export vars + scene-inherited rifle.tscn). Resource is an
  upgrade of that, not a correction; "do when it hurts" — Hermes agrees it's not urgent.
- Enemy variants are `extends Enemy` subclasses, several of which override only a constant (tint).
  Per composition r7 the pure-data ones should already collapse to `@export`; that cleanup is a
  composition application, independent of Resources. Resources only pay off at many `.tres`
  variants authored by non-coders — not current scale.
- No skill change. Revisit when weapon/enemy variant count grows or a designer authors stats.

### 4. Keep groups for spatial QUERIES (magnet, nearby enemies)

**ACCEPT — already our practice; nothing to change.**

- Aligns with current magnet usage. No conflict. Documenting the query-vs-contract distinction is a
  nice-to-have but not load-bearing; do not author.

### 5. DEFER died-one-shot + untyped HUD seams until a 3rd consumer

**ACCEPT (= no action).** Matches "modularize on demand". Nothing to write.

### 6. Typed arrays/dictionaries + style-guide member ordering

**ALREADY ENFORCED — nothing to add.**

- godot-code-rules already mandates full typing (`Array[String]` in its anatomy example),
  `untyped_declaration=2`, and gdlint `class-definitions-order` (member ordering). `Dictionary[K,V]`
  typed-dict is the only sliver not explicitly called out; it's covered by the blanket
  "every var typed" rule. No change needed; if desired, a one-word mention of `Dictionary[K,V]` in
  code-rules anatomy — trivial, optional, not gating.

## Net

- Author NOTHING new now. Zero skill files, zero CLAUDE.md lines required by these findings.
- Two items are real cleanups that fall under EXISTING skills (composition), to do when that code
  is next touched: (#2) inject WaveManager via `@export`; (#3/enemy) collapse data-only enemy
  subclasses to `@export`.
- The headline ask (#1 abstract contract) is rejected as premature and convention-conflicting.
  NPC shootability = implement the existing duck-typed `on_hit()` seam (godot-shooter-enemy-combat),
  no abstract base.
- Parked for later (revisit triggers noted): `@abstract HitReceiver` if 3rd shootable + typo bugs;
  WeaponData/EnemyStats Resources if variant count/designer-authoring grows.

## Immediate unblock for the NPC task (t215)

Decide shootability BEFORE building npc.gd: NPC implements `func on_hit() -> void` (duck-typed seam
per godot-shooter-enemy-combat) — no new contract type. That is the recommended path pending user
confirmation below.
