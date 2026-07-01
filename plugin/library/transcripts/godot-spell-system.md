# Godot data-driven spell & effect system — transcript digest

**Source** — `godot-spell-system.md` (raw now in `transcripts/archive/godot-spell-system.md`). Dev-vlog: a data-driven spell/effect system in Godot, inspired by World of Warcraft target rules + Vampire Survivors examples (chain lightning, blizzard).
**Why harvested** — about to build a **Cast system for combat projectiles** (DiceOfFate FPS, Godot 4.6, strict-typed GDScript; combat = travelling projectiles).

## System the video presents

Spells as **data, not script**. Pieces:

- `SpellData` Resource = metadata (name/icon/cast requirements: mana, class, item) + a list of **execution entries**.
- Execution entry = pair of (`Effect`, `TargetResolver`) — "what to do" + "on whom".
- `CastManager` node/component on a character: validates cast requirements, builds a **GameContext** (instigator/target/trigger + extra data other components can inject), then runs each entry's effect against its resolved target.
- `TargetResolver` Resource answers "who" — simplest fetches a key (instigator/target/trigger) from GameContext; advanced resolves all entities in a radius.
- `Effect` Resource base, intentionally tiny. e.g. `DamageEffect` holds base+variance, at runtime duck-types the target's health component and applies (no health → no-op).
- **Spawned-object problem**: effects triggered by a dynamically spawned projectile/missile must live INSIDE the spawned entity, NOT in the CastManager. CastManager only fires the spawn; the projectile owns its own hit→effect logic. Rejected an intermediate `SpellInstance` layer (heavy, leaky).
- Entity-side wiring (blizzard/chain-lightning examples): components expose named events (`on_body_enter`, `on_tick`, `on_duration`, `on_first_bounce`...). An **EffectMapComponent** + **FeedbackComponent** each hold a map `event_key → [effects]`; on event fire, apply all effects under that key. Event keys are editor-defined (an `@export`/tool-scanned list), not hardcoded.

## Points

| #   | Point (technique/claim)                                                                                    | Valid for our stack? | Already learned? | Where / gap                                                                                                                                                            | Verdict                                                  |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Model spells/abilities as **data Resources** (`SpellData`), not per-spell scripts                          | holds                | gap              | no spell/cast Resource exists; we have only per-weapon `gun.gd` + `projectile.gd`                                                                                      | Build candidate                                          |
| 2   | Split into `Effect` + `TargetResolver` execution entries ("what" × "whom")                                 | holds                | gap              | nothing equiv; this is the core Cast-system shape                                                                                                                      | Build candidate                                          |
| 3   | `CastManager` component validates + builds a `GameContext`, runs effects                                   | holds with caveat    | partial          | composition (godot-composition) gives the component shape; "calls down / signals up" already our rule — but no cast/context object                                     | Build candidate                                          |
| 4   | `Effect.apply()` duck-types the target's health/component (no component → no-op)                           | holds                | covered          | exactly our `on_hit()` duck-typed seam — godot-shooter-enemy-combat + projectile.gd L94-99                                                                             | Reuse                                                    |
| 5   | **Effect logic for a spawned projectile lives inside the projectile**, not the manager                     | holds                | covered          | our `projectile.gd` already owns hit→`hit`signal + `on_hit()` call; godot-travelling-projectile-3d firing component is host-agnostic                                   | Reuse (validates our design)                             |
| 6   | EffectMapComponent: named events (`on_tick`/`on_duration`/`on_bounce`) → effect lists, editor-defined keys | holds with caveat    | partial          | godot-oneshot-vfx router already maps seams (`fired`/`hit`/`died`)→effect scenes — same pattern, but generic event→effect-resource map + editor key-scan tool is new   | Build candidate (likely overkill for projectile Cast v1) |
| 7   | Cast **requirements** gate (mana / class / has-item) in metadata                                           | holds                | gap              | no resource cost/class system; not needed for projectile Cast                                                                                                          | Later                                                    |
| 8   | Radius `TargetResolver` (all entities in range)                                                            | holds                | partial          | we have group-query patterns (magnet `get_nodes_in_group`); AoE-resolver-as-resource is new                                                                            | Later (AoE spell)                                        |
| 9   | Use JSON plain-text config like studios                                                                    | holds with caveat    | conflicts-ish    | Godot-native `.tres` Resources preferred over JSON here; CLAUDE.md/godot-code-rules favor typed Resources + strict GDScript. Video itself lands on Resources, not JSON | Use `.tres`, not JSON                                    |
| 10  | A `SpellInstance` linking layer is bad (leaky floating nodes) — avoid                                      | holds                | covered          | matches our "no autoload, components own lifecycle, queue_free discipline" (godot-composition, projectile self-frees)                                                  | Reuse (anti-pattern noted)                               |

**Coverage tally** — covered 3 (#4,#5,#10), partial 3 (#3,#6,#8), gap 3 (#1,#2,#7), caveat-only 1 (#9). No hard CLAUDE.md **conflict** — #9 (JSON) is a soft one: our convention favors typed `.tres` Resources + strict GDScript over plain JSON config; the video lands on Resources too, so adopt the Resource path.

**Recommended next** (for the projectile Cast build)

- Design the Cast system shape for OUR FPS: `SpellData`/`CastData` Resource = `Effect[]` × `TargetResolver`, fired through a `CastManager` component on the weapon, projectile keeps owning its own hit→effect (points #1,#2,#3 the gaps; #4,#5 reuse) → **game-designer**.
- After design, if no existing skill covers "data-driven ability/effect Resource graph in Godot 4.x" → **skill-researcher** (the Resource-as-effect + target-resolver pattern is the genuine reusable gap; godot-travelling-projectile-3d + godot-shooter-enemy-combat cover firing/damage but NOT the data-driven effect composition).

**Later** (valid, not this build)

- Cast requirement gate (mana/class/item) — #7.
- Radius/AoE TargetResolver as a Resource — #8.
- Generic editor-key EffectMapComponent (`on_tick`/`on_bounce` event maps) — #6; only if multi-event entities (blizzard-zone, chain-bounce) get built. For a projectile Cast v1, the projectile's existing `hit` seam suffices.
