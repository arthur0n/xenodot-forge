# Health / Damage Component

**Request** — Replace fragmented copy-paste `apply_damage`/`_health` in `enemy.gd`, `target.gd`, `npc.gd` with a shared component; unify enemy + player health handling. Raised by orchestrator / Hermes research pass.

**Verdict** — rejected — build it ourselves (`tools/lib/health_component.gd`)

---

## Candidates

| Addon                                      | Source                                                                           | License | Godot | Language       | Last activity        | Notes                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ------- | ----- | -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BananaHolograma/HealthComponent            | [Asset Library #2039](https://godotengine.org/asset-library/asset/2039) / GitHub | MIT     | 4.0+  | GDScript 100%  | Active / stable      | API: `damage(int)`/`health(int)`; signals `died`, `health_changed(amount,type)`, `invulnerability_changed`; regen, invuln frames, overflow/shield, `get_health_percent()`                                                               |
| ZauraGS/HealthComponent (Godot Barn)       | GitHub (hobby)                                                                   | MIT     | 4.3   | GDScript 100%  | Stable, small        | API: `take_damage`/`take_healing`/`resurrect`/`force_damage`/`force_heal`; signals `died(overkill)`, `damaged`, `healed`, `health_changed(current,max)`; god_mode, resurrection. No regen/armor/DoT/auto-free. Cleanest signal surface. |
| cluttered-code/godot-health-hitbox-hurtbox | GitHub / Asset Lib                                                               | MIT     | 4.4+  | GDScript 85.5% | Active, v5.0.3, 158★ | Four-node Health←HurtBox←HitBox/HitScan; v5 adds typed damage + modifier pipelines. Richer than needed — we own Cast targeting. Future ref if typed damage lands.                                                                       |

Tier-2/3 (not adoptable): EnhancedStat (dormant), godot_gameplay_attributes (C++ GDExtension, sunset), LiGameAcademy GAS clone (29 commits), gdquest-open-rpg (reference only).

---

## Why build-our-own

**Fit gap is too wide.** Every candidate above exposes its own primary call (`damage()`/`take_damage()`). Our Cast system's `DamageEffect` calls `target.apply_damage(amount)` — a duck-typed seam shared by three entity classes and documented in `godot-shooter-enemy-combat`. Adopting any external component forces one of:

- a shim wrapper on every entity (`func apply_damage(n): _health_comp.damage(n)`) — negates the point of adopting,
- or a breaking rename of the Cast seam across Cast, projectile `on_hit()`, and all entity scripts.

BananaHolograma is the closest (MIT, GDScript, active, 4.0+), but it bundles regen + invuln frames + overflow/shield that we don't use, and its `damage()` name still requires a shim. The component's value is ~50 lines of well-tested logic we can replicate trivially.

**Player–lives mismatch.** Player has no HP — it has a `_lives` int in `WaveManager` (`lose_life()`/`add_life()`). Adding a `HealthComponent` to the player would be a **design change** (lives model → HP model), not a drop-in. Integration cost: new `player.gd` signals, `WaveManager` must subscribe to `player_health_comp.died` instead of `touched_player`, health pickups reroute. This is non-trivial and orthogonal to the enemy dedup problem. Keep player on lives model until the design says otherwise.

**Composition fit.** A `tools/lib/health_component.gd` node (child component, signals up) matches our conventions exactly: enemy/target/npc parents keep `apply_damage(amount)` as a thin forwarder, the component owns `_health`, emits `died` and `health_changed`, parent connects. No autoloads, no inheritance, no framework.

**Extraction scope is small.** `enemy.gd`'s `apply_damage` + `_health` + `died` is ~8 lines of logic. One extract gives us a tested, reusable component with our exact API surface in `tools/lib/`.

---

## Recommended build spec (`tools/lib/health_component.gd`)

```
class_name HealthComponent extends Node

signal died
signal health_changed(current: int, max_health: int)

@export var max_health: int = 2

var _current: int

func _ready() -> void:
    _current = max_health

func apply_damage(amount: int) -> void:
    _current = max_i(_current - amount, 0)
    health_changed.emit(_current, max_health)
    if _current == 0:
        died.emit()

func get_health_percent() -> float:
    return float(_current) / float(max_health)
```

Parent (e.g. `Enemy`) child-has `HealthComponent`, connects `_health_comp.died` → `_on_died()`, delegates `apply_damage` → `_health_comp.apply_damage(amount)`. Enemy keeps its own `signal died(enemy: Enemy)` re-emission so external listeners (`WaveManager`) are unchanged.

---

## Open questions for the user

1. **Overflow-as-shield**: BananaHolograma supports shield HP that absorbs overflow damage. Do we want this for a tank/boss variant? Affects whether the component needs a shield layer.
2. **Typed damage near-term?** If damage types (fire/physical/poison) land before next milestone, re-evaluate `cluttered-code/godot-health-hitbox-hurtbox` v5 — its modifier pipeline would be worth the name-seam cost. Build our own component in a way that makes typed dispatch easy to add (pass a `type: int = 0` param, ignore for now).
3. **Player lives vs HP**: Keep `WaveManager._lives` model for player, or migrate player to HP-based health with lives as a separate counter? Determines whether `HealthComponent` applies to player at all.

---

## Install

N/A — build it. Task for godot-dev: create `tools/lib/health_component.gd` per spec above; refactor `enemy.gd`, `target.gd`, `npc.gd` to delegate `apply_damage` to it; keep all external signals unchanged.

## Later

- **BananaHolograma/HealthComponent** — revisit if we add regen, invuln frames, or boss shield bars; seam shim cost becomes acceptable at that feature scope.
- **cluttered-code/godot-health-hitbox-hurtbox v5** — revisit if typed damage + modifier pipeline lands as a near-term design requirement.
