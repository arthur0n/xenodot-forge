# Aim Assist (controller) — transcript digest

**Source** — `godot-aim-assist.md` (now in `transcripts/archive/godot-aim-assist.md`). YouTube-style "how to add aim assist" tutorial, 2D demo, claimed 2D/3D parity.
**Why harvested** — about to build a "shoulder weapon": back-mounted auto-turret on the player that auto-AIMS + auto-FIRES at enemies in a ~45° rear arc. Question: reusable technique? SYSTEM and/or SKILL?

**Verdict up front** — video is THIN and aimed at the WRONG problem. It teaches _human-assisted_ aiming (slow the player's controller stick when a ray overlaps a target). The shoulder weapon is _fully autonomous_ aim+fire — no player stick to slow. The technique that maps (target acquisition + smooth rotate-to-aim + fire gating) is ALREADY built in `enemy_shooter.gd` / `shooter_attack.gd`, which the turret is a near-exact mirror of. Net: almost nothing new from THIS video; the build is a known-pattern mirror, not a learning gap.

**Points**

| #   | Point (technique/claim)                                                                                             | Valid for our stack?                                                                | Already learned?        | Where / gap                                                                                                                                                                  | Verdict   |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Detect a target with a dedicated RayCast aimed at screen-centre; act when `is_colliding()` and collider is a target | holds with caveat — turret needs _nearest-in-arc_ selection, not a single fixed ray | covered                 | `enemy.gd can_see_target()` = RayCast3D LOS gate; `radar_minimap.gd _world_to_radar()` already does yaw-relative rear-arc math                                               | known     |
| 2   | Toggle assist on/off via an exported `enabled` flag (controller present / setting)                                  | holds                                                                               | partial                 | exported tunables are convention everywhere (`gun.gd`, archetypes); no auto-aim toggle yet, trivial                                                                          | known     |
| 3   | When ray overlaps target, slow the player's aim sensitivity (tween rotation slower, multiply by a `slowdown`)       | out of scope                                                                        | n/a                     | this is human-stick aim-assist; turret has NO player input to slow                                                                                                           | drop      |
| 4   | Smoothly rotate toward target via `create_tween()` on rotation, not instant snap                                    | holds                                                                               | covered                 | `shooter_attack.gd` telegraph tween + `Basis.looking_at(-forward, UP)` already does smooth/snap aim at a target                                                              | known     |
| 5   | Lock-on / auto-aim is "a completely separate, quicker system" (toggle, snap fast) — video does NOT implement it     | holds — this IS what the turret needs                                               | covered (as the mirror) | `enemy_shooter.gd` \_fire_at_player() = acquire `target()` → orient `Basis.looking_at` → spawn projectile → LOS-gated telegraph. Turret = mirror: nearest _enemy_ not player | known     |
| 6   | (implicit) No lead/prediction, no nearest-of-many selection, no aim cone — video omits all                          | n/a                                                                                 | gap-ish                 | nearest-of-many in arc = NEW selection helper; enemy side only ever targets the single player. Lead/prediction: NOT built, NOT needed (projectile speed 30 m/s, arena scale) | minor gap |

**Already-have inventory (grounding)**

- Target set: enemies in `enemies` group (`enemy.gd:99 add_to_group("enemies")`).
- Acquire single target: `enemy.gd target()` = `get_first_node_in_group("player")`.
- Rear-arc / yaw-relative selection math: `radar_minimap.gd _world_to_radar()` (rotate by `-yaw`, dz<0 = forward) — directly reusable to pick nearest enemy within 45° rear.
- LOS gate: `enemy.gd can_see_target()` (RayCast3D `force_raycast_update`).
- Aim + smooth/telegraph + fire: `enemy_shooter.gd` / `shooter_attack.gd` (`Basis.looking_at(-forward, UP)`, telegraph Tween, `_fire_at_player`).
- Firing seam (friendly side): `gun.gd` (`try_fire()` → spawn Projectile + stamp `cast_data`, fire-rate `Cooldown` Timer, `fired`/`hit_confirmed`/`kill_confirmed`).
- Payload: `cast-system` skill + `tools/lib/cast/` (CastData `.tres` per bullet).
- No `godot-auto-aim` / target-acquisition skill exists in `.claude/skills/` or plugin skill list.

**Recommended next** (for the shoulder-weapon build)

- **game-designer** — new weapon ENTITY + behaviour: define the shoulder-turret slice (rear 45° arc, acquisition cadence, fire rate, which CastData it fires, telegraph vs instant, does it share player ammo). This is a real design decision, needed now.
- **No skill-researcher dispatch.** The technique is already in-repo (enemy shooter mirror); searching external collections would re-find what we have.
- **No addon-researcher.** Auto-aim here is ~30 lines reusing existing seams, not a subsystem worth an addon.

**SYSTEM vs SKILL verdict**

- **SYSTEM: yes — build a small reusable `TargetAcquisition` component** (data-driven via a `.tres`: target group, arc half-angle, max range, LOS-required, selection = nearest/most-centred, optional re-acquire interval). Justification: there are now TWO auto-aimers — `enemy_shooter`/`shooter_attack` (aim at player) and the new turret (aim at nearest enemy). That is the 2nd-duplication trigger in CLAUDE.md ("extract on the 2nd duplication", `tools/lib/`). The selection differs (single player vs nearest-of-many in arc) but acquire→LOS→orient is shared. Build the turret on this component; opportunistically migrate `shooter_attack` later (not required for the slice). Mirrors `godot-enemy-archetype` philosophy (behaviour as a bound component).
- **SKILL: no (not now).** A framework `godot-target-acquisition` skill is a _candidate_ but premature — the pattern isn't proven across enough call sites yet, and the existing `godot-enemy-ai` + `cast-system` + `godot-travelling-projectile-3d` skills already cover the constituent seams. Promote to a skill ONLY after the component is built and reused (turret + migrated enemy shooter). Park as a future promotion, decided by human, via skill-researcher then.

**Later** (valid, not needed this slice)

- Lead/target prediction for the turret (only if projectile feels too slow vs fast enemies).
- Migrate `shooter_attack.gd` onto the shared `TargetAcquisition` component once it exists.
- Human stick aim-assist (point 3) — only relevant if/when controller support is added to the player; out of POC scope now.
