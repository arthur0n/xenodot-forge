# FPS Juice / Weapon Recoil (curve-driven) — transcript digest

**Source** — `godot-fps-shooet-recoil.md` (raw now in `transcripts/archive/godot-fps-shooet-recoil.md`). Generic Indie-FPS "juice" tutorial (Godot 4): camera tilt, weapon sway, weapon bob, curve-driven recoil, camera shake.
**Why harvested** — about to build better weapon recoil; decide reusable SYSTEM (data-driven recoil profile resource) and/or framework SKILL.

**Build context grounding (our actual files):**

- `weapon_controller.gd` — owns recoil SPRING: two-stage lerp (`update_recoil`), accumulate per shot, decay to 0, `recoil_max` clamp, additive offset read by player (never overwrites look). Per-shot impulse `_on_gun_fired` reads `gun.recoil_pitch` + random `±recoil_yaw`.
- `gun.gd` — per-weapon exports `recoil_pitch`, `recoil_yaw`, `spread_hip/ads`, `crouch_spread_mult`; spread cone perturbs muzzle basis pre-launch (`_fire`); view-model dip/draw tweens (swap).
- `sprint_sway.gd` — procedural view-model pose + sine sway (roll/lateral/vert/fwd), walk-vs-sprint weights, busy-suppress (fire/ADS/reload/swap), interrupt lerp. = video's sway+bob, already richer.
- `design/weapon_ads_recoil.md`, `design/player_feel_port.md` — recoil design captured: spring adopted, accumulate+decay+clamp, additive-on-head, spread per-state. "Later": recoil PATTERN CURVES (not just up).
- a planned game-feel/polish skill (not yet built) would list "recoil applied on fire + recovers" as a checked L3 criterion.

**Points**

| #   | Point (technique/claim)                                                                                                                           | Valid for our stack? | Already learned? | Where / gap                                                                                                                                             | Verdict                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Recoil w/o hand-anim: drive weapon pos/rot from `Curve` resources scanned by `current_time`, scaled by a `Vector3` amplitude (redraw-free tuning) | holds                | partial          | We use a SPRING (lerp accumulate/decay), NOT curves. Curves = authorable per-shot SHAPE/pattern. `weapon_ads_recoil.md` "Later: recoil pattern curves". | partial — genuine new technique (curve-profile), but already PARKED |
| 2   | Random ±multiplier on recoil axis per shot for natural variation (50% flip Z-roll)                                                                | holds                | covered          | `weapon_controller.gd` `randf_range(-gun.recoil_yaw, gun.recoil_yaw)` already randomizes yaw per shot                                                   | covered                                                             |
| 3   | Amplitude `Vector3` decouples impact from curve shape (tune without redraw)                                                                       | holds                | partial          | Mirrors our per-weapon `recoil_pitch/yaw` exports; would pair w/ #1 curve to keep data-driven tuning                                                    | partial — only relevant if #1 adopted                               |
| 4   | Camera shake on fire (separate class, `add_trauma`) to "hit home the shot"                                                                        | holds with caveat    | gap              | No camera-shake system. Caveat: must ADD to head like recoil, never overwrite mouse-look (our I2 rule); feeds game-feel ≥2-channels                     | gap (small)                                                         |
| 5   | Weapon sway: lerp view-model rot toward mouse-input delta (decays to 0); optional invert                                                          | holds                | covered          | `sprint_sway.gd` does richer procedural pose+sine sway; ADS/fire suppress                                                                               | covered                                                             |
| 6   | Weapon bob via sin(time*freq)*amp on view-model pos to fake footsteps                                                                             | holds                | covered          | `sprint_sway.gd` sine sway (roll/vert/lateral/fwd, walk weights) supersedes                                                                             | covered                                                             |
| 7   | Camera tilt (roll Z) on strafe input via lerp                                                                                                     | holds                | gap              | No move-tilt. `player_feel_port.md` "Later: move-tilt (forward punch / side lean)" — PARKED, not recoil                                                 | gap — parked, out of current build                                  |
| 8   | Basic FPS rig: CamHolder+WeaponHolder, mouse-look pitch/yaw, clamp, capture mouse                                                                 | holds                | covered          | `godot-first-person-controller` skill + `player.gd`                                                                                                     | covered                                                             |

**Already-learned tally:** covered 4 (#2,5,6,8), partial 2 (#1,3), gap 2 (#4 small, #7 parked). No CONFLICT with conventions — video's recoil OVERWRITES weapon rotation; our convention (I2, additive-on-head, never overwrite look) is stricter. Any adoption must keep additive layering.

**Recommended next** — for the current "better recoil" build:

- Recoil PATTERN as data-driven SYSTEM (#1+#3): author a `RecoilProfile` `.tres` (per-axis `Curve` + `Vector3` amplitude) consumed by the EXISTING spring path in `weapon_controller.gd`/`gun.gd` — new weapon feel = new `.tres`, no firing-path change. Mirrors our `CastData` data-driven pattern (`godot-effect-composition`). → **game-designer** (decide: is per-shot PATTERN/climb shape wanted now, or is the current spring "enough"? this is a feel/design call, not a code gap).
- Curve-profile recoil as a reusable godot-\* technique → **skill-researcher** ONLY IF game-designer says pattern recoil is in-scope AND we want it engine-agnostic. See SYSTEM-vs-SKILL answer below.

**SYSTEM vs SKILL (user's question):**

- **SYSTEM: yes, IF pattern recoil wanted.** Build a data-driven `RecoilProfile` Resource (typed `.tres`: per-axis `Curve` + amplitude `Vector3`) the existing spring path consumes. Justified: matches our systems+data-driven default and the `CastData` precedent; lets each weapon define a climb SHAPE without code. Smallest change = add profile, keep spring as fallback.
- **SKILL: not yet.** Recoil is ALREADY covered by code (spring) + 2 design docs, and a planned game-feel/polish skill (not yet built) would additionally audit "recoil reads on fire". A dedicated `godot-fps-recoil` skill would duplicate that planned game-feel sweep + first-person-controller. Promote to a skill only if the curve `RecoilProfile` proves reusable across weapons/engines AND the team wants the gotchas (additive-not-overwrite, curve scan, amplitude decouple) captured once. Until then = a game design slice, not a framework skill.

**Later** (valid, not needed for recoil build):

- #4 camera shake — small feel add; route to game-feel/oneshot path, additive-only.
- #7 move-tilt / strafe roll — already parked in `player_feel_port.md`.
