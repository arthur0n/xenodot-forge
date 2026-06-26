# Stats System in Godot (Stats Resource + level curves + buffs) — transcript digest

**Source** — `godot-stat-system.md` (raw now in `transcripts/archive/godot-stat-system.md`). Tutorial: a `Stats` Resource attached to any entity (RPG-style stats + XP/level curve scaling + add/multiply buff resources). Author's own use: project "Evore".
**Why harvested** — we are ABOUT TO BUILD a stat system supporting buffs/debuffs, additive+multiplicative modifiers, resistances, stacking, derived stats for enemy/player/weapon. Build-imminent, need-driven.

**Points**
| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Author stats as a `Resource` subclass (`class_name Stats`) with `@export` per-stat, attach to any entity | holds | covered (pattern) | mirrors EnemyArchetype/BossData/CastData (typed Resource = data) + godot-effect-composition | match |
| 2 | Separate `max_health` (cap) from live `health` (current); init `health = max_health` | holds | covered (better) | HealthComponent already owns `max_health` + `_current`, `reset()`, clamp | match (ours is a Node component, not on the Resource) |
| 3 | Health setter clamps 0..max, emits `health_depleted` + `health_changed(cur,max)` | holds | covered | HealthComponent: `health_changed(current,max)` + `died` once via `_dead` guard | match |
| 4 | Resource `_init()` runs BEFORE `@export` overrides → defer live-value setup with `call_deferred` | holds w/ caveat | partial | real Godot init-order gotcha. We dodge it: HealthComponent is a Node, seeds `_current` in `_ready()` + explicit `reset()` from parent. If a future Stats Resource caches derived values it must defer | note |
| 5 | base*X vs current_X split: `@export` base = level-1 value, cached `current_X` = recomputed | holds | GAP | core of buff/derived-stat layering. We have flat single values (archetype `max_health`, `move_speed`), no base/current split, no recompute | gap |
| 6 | XP `@export` + computed `level` (getter: `floor(max(1, sqrt(xp/100)))`); level drives stat scaling | out of scope | n/a | no XP/leveling in arena-survival FPS POC; roadmap has no progression. Skip the level/curve half wholesale | drop |
| 7 | Per-stat `Curve` resource sampled at `level/100` → multiply base → current (RPG stat curves) | out of scope | n/a | tied to #6 leveling. Not our model | drop |
| 8 | `enum BuffableStats { MAX_HEALTH, DEFENSE, ATTACK }` names MUST match `base*`/`current*`property suffixes; dynamic`set("current*"+name, ...)`| holds w/ caveat | GAP | the buffable-stat registry pattern is valid + reusable. Caveat: stringly-typed dynamic get/set is UNSAFE_* → violates godot-code-rules strict typing; would need`@warning_ignore`or a typed dict-of-stats instead | gap (re-engineer for strict typing) |
| 9 |`StatBuff`Resource:`{ stat, amount, buff_type: ADD\|MULTIPLY }`, `add_buff/remove_buff`hold refs | holds | GAP | THE thing we're building. No buff/modifier resource or container exists anywhere in tools/lib | gap |
| 10 | Recompute: condense all MULTIPLY buffs into one summed multiplier (1.5+1.5→3×, NOT 1.5×1.5) before applying; ADD buffs separate; clamp mult ≥0 | holds | GAP | the modifier-math contract (add bucket + mult bucket, order, no sequential compounding). Genuinely missing + the subtle part worth capturing | gap |
| 11 | Caller holds the`StatBuff`ref to remove later; timing/duration handled EXTERNALLY (not in Stats) | holds | partial | our StatusReceiver already owns timed status (burn/slow/shock, refresh-not-stack). Buff *duration* could route through it; buff *math* is the gap | partial |
| 12 | Set resource`local_to_scene`(or duplicate) so instances don't share one Stats object | holds | covered | we sidestep entirely: stats live on per-instance Node components (HealthComponent) + archetype`.tres`is read-only data stamped at spawn, never mutated shared | match |
| 13 |`recalculate.call_deferred()` after add/remove to coalesce multi-buff-same-frame | holds | n/a | impl detail; valid if we adopt a recompute step. Note for builder | note |

**Map to our stack — overlap / conflict**

- HealthComponent (Node, signal-driven, shield+typed dmg) ALREADY covers the live-health half (#2,#3,#12) better than the video (Node not Resource, parent-owned free, once-only died). KEEP. Do not replace with a Stats Resource.
- Archetype/Boss resistances `Dictionary{DamageType.Kind→mult}` ALREADY cover resist-as-multiplier. The user's "resistances" ask is DONE; the buff system should reuse this dict shape, not duplicate it.
- StatusReceiver ALREADY owns timed status (refresh-not-stack). Buff DURATION belongs here; buff VALUE-MATH (#10) is the new piece.
- Effect/CastData (godot-effect-composition) = the authoring + apply seam. A `BuffEffect` (new Effect subclass) is the natural way a bullet/cast applies a buff/debuff — matches existing pattern.
- CONFLICT: video's stringly dynamic `set("current_"+name)` (#8) breaks strict-typed GDScript (godot-code-rules UNSAFE\_\*). Must re-engineer as a typed `Dictionary[StatId→float]` stat block, not per-named-property reflection.
- NOT covered anywhere: base/current split (#5), StatBuff resource (#9), add-bucket/mult-bucket modifier math (#10). These three = the real build.

**Recommended next** (gaps for the current build, one line each)

- Modifier/buff value-math + stat-block model (base + add-bucket + summed-mult-bucket → derived, strict-typed dict not reflection) — reusable pattern, no skill covers it → **skill-researcher** (search for a typed Godot stat/modifier skill; this video is a weak seed — leveling/curves out of scope, dynamic-set conflicts our rules).
- How buffs/debuffs RELATE to HealthComponent + archetype resistances + StatusReceiver (layer, don't replace): the design decision of where derived stats live (component vs resource) and which stats are buffable (move_speed, damage, resist, fire-rate?) → **game-designer**.

**Adopt/build verdict** — BUILD, do not adopt this video's design as-is. Take ONLY: the StatBuff resource shape (#9), the add-vs-multiply bucket math (#10), the explicit base→current recompute step (#5,#13). DROP the XP/level/Curve half (#6,#7 — no progression in this POC) and the stringly dynamic set (#8 — breaks strict typing).

- Relate to existing: **LAYER, never replace.** HealthComponent stays the live-HP owner; archetype `resistances` dict stays the resist source; StatusReceiver stays the timed-status owner. New = a `StatBlock`/modifier component (typed dict of base + active `StatBuff[]`) that recomputes derived values and feeds them to those existing systems (e.g. a buffed `move_speed`, a debuffed `resistance` mult). Buff _application_ enters via a new `BuffEffect` Effect subclass (Cast seam); buff _expiry_ routes through StatusReceiver timers.

**Later** (valid, not for this build)

- XP / leveling / stat-curve scaling (#6,#7) — only if a progression meta is ever added. Currently out of POC scope.
- Resource `local_to_scene` discipline (#12) — already moot; revisit only if stats ever move onto a shared `.tres`.
