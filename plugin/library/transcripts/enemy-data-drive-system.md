# Reusable Enemy System (composition + FSM + scene inheritance) — transcript digest

**Source** — `godot-enemy-data-drive-system.md` (raw now in `transcripts/archive/`). The Ragou Games, "reusable enemy system in Godot" (Godot 4.6).
**Why harvested** — about to build COMPLEX ENEMIES via a data-driven enemy system in the DiceOfFate FPS.
**Mapped against** — our actual impl: `entities/enemy/enemy.gd` (CharacterBody3D), node-FSM `state_machine/` (`EnemyStateMachine`+`EnemyState`), `HealthComponent` child, Cast Resource graph (`tools/lib/cast/`), `wave_manager.gd`, 6 variants (`extends Enemy` + scene).

> Caveat: video is a **2D platformer** (CharacterBody2D, raycast ledge/wall, gravity-platformer). We are 3D FPS w/ NavigationAgent3D. Behaviour _patterns_ map; node types / movement do not.

**Points**
| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Thin base enemy body (physics/move/refs only), brain elsewhere | holds | covered | `enemy.gd` is exactly this (nav+perception+move seams; FSM decides). godot-composition, godot-enemy-ai | already done |
| 2 | Node-based FSM (patrol/chase/attack states) drives behaviour | holds | covered | `EnemyStateMachine`/`EnemyState` w/ patrol/chase/attack states. godot-enemy-ai | already done |
| 3 | Composition: behaviours as modular child "ability" nodes under an `Abilities` container; add/remove per enemy | holds w/ caveat | **partial** | We compose (HealthComponent child, FSM child) but enemy _behaviours_ (dive, ranged-fire, magnet-pull) are `extends Enemy` script overrides, NOT swappable child component nodes. godot-composition covers the pattern; no enemy-behaviour-component convention | **gap (partial)** |
| 4 | Variants via scene inheritance + `@export` tweaks, not from scratch | holds | covered | All 6 variants = `extends Enemy` + `.tscn` + `@export` overrides (`enemy_flying.gd` etc.) | already done |
| 5 | `@export` important values (speed/health/fire-rate) for inspector tuning | holds | covered | `enemy.gd` exports move_speed/health/score_value/ranges; variants override | already done |
| 6 | Self-contained: react to detection-area + `player` group, never hardcode player path | holds | covered | `target()` = `get_first_node_in_group("player")`; LoS via EyeRay. godot-enemy-ai | already done |
| 7 | Ranged/shoot ability: telegraph + burst + cooldown timers for fair/readable attacks | holds | covered | `enemy_shooter.gd` (LOS-gated telegraph tween → fire, cooldown via AttackTimer) | already done |
| 8 | Copy enemy folder + deps to reuse across projects (encapsulation) | out of scope | n/a | Single-game POC; cross-project portability not a goal. Framework portability = skills, not folder-copy | out of scope |
| 9 | States vs behaviour trees (open question, no recommendation) | n/a | n/a | We use node-FSM (godot-enemy-ai explicitly bans BTs); no decision needed | out of scope |

**Verdict** — 6 covered, 1 partial-gap, 2 out-of-scope. **Zero conflicts.** Video validates our architecture; it teaches the SAME composition+FSM+inheritance approach we already shipped, in 2D. It is BEHIND us on data-drivenness: it proposes NO enemy-stats/archetype Resource, NO behaviour-as-Resource, NO spawn-table Resource — variants are scene-inheritance + `@export`, exactly what we already do. Our Cast Resource×Resolver graph + HealthComponent are MORE data-driven than the video.

**Gap that matters for COMPLEX ENEMIES (#3 only)** — video's "swappable ability child nodes" is the one idea we have partial. Today a new behaviour = a new `extends Enemy` subclass. For _complex, mixable_ enemies (e.g. flyer+shooter, tank+magnet) inheritance forces re-implementation; a composed behaviour-component model (FSM states/abilities as data-selectable child nodes, or behaviour Resources the FSM reads) would let traits combine. This is the real "data-driven enemy" extension the build wants — and the video does NOT actually show it (it stops at inheritance).

**Recommended next**

- Enemy-archetype Resource + behaviour-component design decision → **game-designer**: should complex enemies be authored as a `.tres` archetype (stats + an ordered behaviour/ability list, mirroring CastData) instead of one `extends Enemy` subclass per type? Decide BEFORE building, since it dictates the slice shape. (Video gives no guidance here — out of its scope.)
- IF that decision = yes (data-driven behaviour-as-Resource): new framework skill `godot-enemy-archetype` → **skill-researcher** — composes godot-enemy-ai (FSM) + godot-composition + godot-effect-composition (archetype/behaviour as `.tres`) into the "complex enemy from data" pattern. Currently NO skill covers enemy stats/behaviour as a Resource; the three existing skills each cover a piece, none the whole.

**Later** (valid, not needed this iteration)

- #3 generic ability-component container (`Abilities` node) — only if game-designer rejects the Resource route and wants node-composition instead.
- Spawn-table-as-Resource: `wave_manager.gd` already does data-driven type mix via `@export` ratio fields (`runner_ratio` … `flyer_ratio`); promoting that to a wave/spawn `.tres` is a nicety, not blocking complex-enemy build. Park.
