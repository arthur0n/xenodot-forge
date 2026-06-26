---
name: godot-effect-composition
agents: [godot-ranged-combat]
description: The STATELESS flavour of data-driven composition (Godot 4.x) — a `.tres` ability/cast Resource holds an ordered list of fire-once `Effect` Resources (WHAT) + a `TargetResolver` (WHOM); runtime values ride a `Context` DTO; the apply loop lives in the entity that owns the trigger. New ability = a new `.tres`, no code. Use for spells, abilities, casts, melee swings, trap/pickup/projectile payloads, and status effects — buffs/debuffs/dots — anything "apply some effect to some target(s)". Builds on `godot-data-driven-composition`; the stateful sibling is `godot-enemy-archetype`. Includes a worked MELEE transfer + reference lineage (OctoD, MachiTwo, kibble-cabal, willnationsdev). A game applies this concretely as a game-local skill (e.g. a cast-system).
---

# Effect composition — the stateless flavour

Builds on **`godot-data-driven-composition`** (read it first: carrier + ordered-parts + guarded
seam + `.tres`-over-JSON + the `.tres`-sharing caveat + manager-earns-its-place). This flavour
fixes the part-shape to **stateless, fire-once `Effect` Resources** and adds the one piece the
base leaves open: a clean **two-axis split** — WHAT to do (`Effect`) is independent of WHOM to do
it to (`TargetResolver`). That split is why most engines/addons get abilities wrong: they bury
targeting inside the ability's activation method. Keep them apart and the same `DamageEffect`
works on an enemy, a destructible, or the player unchanged.

> Specialized variants slot UNDER this skill as their own searchable skills (e.g. `godot-buff`,
> `godot-debuff`, `godot-dot`) — each a named `Effect` taxonomy on this same stateless base.

## Requirements

- `godot-data-driven-composition` — the shared core. This skill assumes it.
- `godot-code-rules` — Resources need `class_name`, typed `@export`s/returns; the duck-typed target
  seam goes through `has_method` + `@warning_ignore("unsafe_method_access")`.
- `godot-composition` — `Effect` / `TargetResolver` / the ability Resource are sub-resources; the
  apply loop lives in the owning entity, never a god-object manager.

## The pieces — the WHAT × WHOM split

1. **Ability = a typed `Resource`** (`.tres`). Holds metadata + `@export var effects: Array[Effect]`
   (ordered) + `@export var resolver: TargetResolver`.
2. **`Effect` Resource = WHAT.** Tiny base with one virtual; concrete effects `@export` tunables
   and reach the target via a guarded duck-typed seam (so one `DamageEffect` fits any host):

   ```gdscript
   class_name Effect
   extends Resource

   func apply(_target: Node, _ctx: AbilityContext) -> void:
       pass  # no-op base; override per concrete effect


   class_name DamageEffect
   extends Effect

   @export var amount: int = 1

   func apply(target: Node, _ctx: AbilityContext) -> void:
       if not target.has_method("apply_damage"):
           return  # no seam -> no-op, never a crash
       @warning_ignore("unsafe_method_access")
       target.apply_damage(amount)
   ```

3. **`TargetResolver` Resource = WHOM.** Answers "who receives the effects" independently of what
   they are. Simplest returns the single hit body (`[ctx.target]`); richer ones do a radius query,
   a raycast, a shapecast, or return the instigator (self-buff). Swapping the resolver changes
   targeting with zero change to the effects.

   ```gdscript
   class_name TargetResolver
   extends Resource

   func resolve(_ctx: AbilityContext) -> Array[Node]:
       return []  # base; concrete returns hit body / radius query / instigator
   ```

4. **Context DTO** carries runtime state from the trigger to the effects — a plain `RefCounted`,
   never a node:

   ```gdscript
   class_name AbilityContext
   extends RefCounted

   var instigator: Node       # who caused it
   var target: Node           # the primary hit (if any)
   var origin: Vector3        # where it happened
   var normal: Vector3        # surface normal at hit
   ```

**Application lives in the owning entity** (the spawned projectile on `body_entered`, the melee
hitbox on overlap, the trap) — not a manager:

```gdscript
var ctx := AbilityContext.new()
ctx.instigator = self
ctx.target = body
# ... fill origin/normal ...
for t: Node in ability.resolver.resolve(ctx):
    for eff: Effect in ability.effects:
        eff.apply(t, ctx)
```

## Steps (apply the pattern to a new system)

1. **Name the ability Resource** for the domain (`SpellData`, `CastData`, `AbilityData`,
   `TrapData`). `class_name`, `extends Resource`, the two `@export`s above (+ metadata).
2. **Write the `Effect` + `TargetResolver` bases** once per project; reuse across every system.
3. **Author concrete `Effect`s** (`DamageEffect`, `HealEffect`, `KnockbackEffect`, `SlowEffect`).
   Each duck-types ONE seam method on the target.
4. **Author concrete `TargetResolver`s** (`HitTargetResolver`, `RadiusTargetResolver`,
   `RaycastTargetResolver`, `SelfTargetResolver` → `[ctx.instigator]`).
5. **Pick the owning entity** for each trigger; put the resolve→apply loop in its event handler;
   build the Context there.
6. **Author `.tres` per ability** — mix effects + pick a resolver. New ability = new `.tres`.
7. **Headless-smoke the data path** (`godot-runtime-smoke`): load the `.tres`, build a Context, run
   the resolve+apply loop against a stub/real target, assert the observable. Mirror the entity's
   exact loop lines so the test tracks the real path.

## Worked transfer: a melee swing (illustrative, not a build task)

Delivery-agnostic — swap only the resolver and the owning entity, REUSE the effects:

- Owning entity: a melee `Area3D` hitbox on the weapon, enabled for the swing's active frames.
- New resolver `MeleeContactResolver` — returns `area.get_overlapping_bodies()` filtered to a
  group, so one swing hits everything in the arc:

  ```gdscript
  class_name MeleeContactResolver
  extends TargetResolver

  func resolve(ctx: AbilityContext) -> Array[Node]:
      var out: Array[Node] = []
      if ctx.instigator is Area3D:  # instigator carries the active hitbox Area3D
          for b: Node3D in (ctx.instigator as Area3D).get_overlapping_bodies():
              if b.is_in_group("enemies"):
                  out.append(b)
      return out
  ```

- **Same `DamageEffect` + `KnockbackEffect`, same Context, same loop** — only the resolver and the
  trigger node differ. A `melee_swing.tres` with `[DamageEffect(5), KnockbackEffect]` +
  `MeleeContactResolver` is a melee ability with zero new effect code. That reuse IS the payoff of
  splitting WHAT from WHOM.

## Where to look when extending (reference lineage — study, do NOT depend on)

Reading sources, not dependencies; each is a C#/C++/migrating addon not adoptable into strict-typed
GDScript, but the design ideas transfer:

| Extending toward…                                                    | Reference                                               | What to lift                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Prereq / cost / cooldown gate before an ability fires                | OctoD `godot-gameplay-systems` (MIT)                    | Tag-based gating: `tags_activation_required`, `tags_block`, `grant_tags_required`                              |
| Delivery taxonomy / AoE & radius / projectile / trap resolvers       | MachiTwo `AbilitySystem` — ASDelivery + ASPackage (MIT) | `AreaTargetResolver`, `RaycastTargetResolver`, `ShapeCastTargetResolver`, `ProjectileTargetResolver`           |
| Multi-event / sequenced / repeating effects (`on_tick`, `on_bounce`) | kibble-cabal `ability-system` (MIT)                     | `Effect` subclass taxonomy + a `LoopEffect` for sequenced/repeating; an `EffectMap` of `event_key → [effects]` |
| The core split itself (closest ancestor)                             | willnationsdev — `godot-ideas` discussion #29           | Targeter / Effect / Skill triad — read before any structural extension                                         |

## Verification checklist (effect-specific)

- A new ability is authored as a `.tres` ONLY (new effect mix / resolver swap) with no call-site
  edit, and it works.
- Swapping the `resolver` on an existing `.tres` (Hit → Radius) changes who is affected without
  touching any `Effect`.
- The same `Effect` subclass is reused across at least two delivery systems (e.g. projectile +
  melee) — confirming WHAT is decoupled from WHOM.
- (Generic checks — strict gate, guarded-seam no-op, headless smoke — live in
  `godot-data-driven-composition`.)

## Error → Fix (effect-specific)

| Symptom                                                            | Fix                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Targeting logic duplicated across abilities                        | It belongs in a `TargetResolver` Resource, not in each effect/ability — extract it.                                                                  |
| Adding a new resolver forces edits to every effect                 | They're coupled — the effect must read only the resolved `target` + `ctx`, never query targets itself.                                               |
| Context is a Node and leaks / needs freeing                        | Make it a plain `RefCounted` DTO — no node lifecycle, no `queue_free`.                                                                               |
| Spawned carrier's effects live in a manager → leaking linker nodes | Put hit→effect inside the spawned entity; reject an intermediate "instance" linking layer.                                                           |
| A stateful `Effect` bleeds across casts                            | Effects must be stateless. If one needs per-cast state, it is the wrong flavour (see the `.tres`-sharing caveat in the base) or must be made unique. |

---

The stateless flavour of `godot-data-driven-composition`; stateful sibling `godot-enemy-archetype`. A game applies it concretely as a game-local skill (e.g. a cast-system). Reference lineage above is MIT-licensed study material, not a dependency.
