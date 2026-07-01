# Modular Health System (The Ragged Games, pt.4) — transcript digest

**Source** — `godot-health-system.md` (raw now in `transcripts/archive/godot-health-system.md`). "The Ragged Games" modular-systems series part 4 — 2D HealthComponent + feedback architecture.
**Why harvested** — VALIDATE/improve our already-shipped `HealthComponent` (player+enemy HP), not design from scratch.

**Points**
| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Build entity from single-purpose component nodes (health, hurtbox, feedback) not one giant script | holds | covered | godot-composition; our `tools/lib/health_component.gd` child Node | match |
| 2 | Decouple via signals: HealthComponent emits, visual/audio components listen — never poll HP per frame | holds | covered | our `signal died` + `health_changed(current,max)`; enemy/target/npc/player listen | match |
| 3 | HealthComponent stores max+current, does damage calc + optional heal, NO visual/audio itself | holds | covered | shipped `apply_damage`/`heal`/`get_health_percent`; visuals in `_flash_hit`/HUD | match |
| 4 | clamp current health 0..max | holds | covered | shipped `max(_current-amount,0)` / `min(_current+amount,max)` | match |
| 5 | Emit `health_changed` + `died`; HP→0 emits died then `queue_free()` if valid | holds w/ caveat | covered (better) | we emit died ONCE via `_dead` guard; we do NOT self-free (parent owns free → reparent-before-free death SFX, godot-shooter-enemy-combat). Video frees inside component = would cut death SFX tail | match (ours safer) |
| 6 | Separate `damaged(amount)` signal distinct from `health_changed` | holds | partial | we fold non-fatal hit-flash onto `health_changed`; no dedicated `damaged(amount)` carrying the delta | minor gap (cosmetic) |
| 7 | `class_name` on components → appears in Add-Node menu, typed @export, no preload | holds | covered | shipped `class_name HealthComponent` | match |
| 8 | Wire deps as `@export` node refs in inspector, not hardcoded paths | holds | covered | our parents bind `max_health` + connect in scene/`_ready` | match |
| 9 | Reusable: drag health+hurtbox onto a crate → destructible, no new code | holds | covered | same component used by enemy/target/npc/player | match |
| 10 | `@export` `@warning` reminders to assign vars; AI-gen anim states (Ziva); 2D nodes/hitbox-for-1-frame | out of scope | n/a | 2D-specific / tooling pitch / no architectural content | drop |

**Verdict — our shipped HealthComponent MATCHES OR EXCEEDS the video.** Video is intro/architecture (part 4, "brain only"); juice deferred to its part 5. We already ship the architecture (composition + signal-decoupled) AND safer death (once-only `_dead` guard, parent-owned free, reparent-before-free SFX) the video lacks. Nothing the video does better.

**Things video raises that we DON'T have — but are NOT the video's, already parked by us:**

- regen, invuln/i-frames, armor/shield, damage types, overflow → these came from our own addon verdict (`library/addons/health-component.md`, BananaHolograma/cluttered-code), already parked in `design/health_component.md` slice 3 (Shield+typed) + Later (regen/invuln/DoT). Video teaches NONE of these.

**Recommended next** — nothing to act on now. Video fully covered by shipped slice 1/2 + godot-composition + godot-shooter-enemy-combat. No new gap surfaced for the current build.

**Later** (valid, not from this video — already on our roadmap, do NOT re-dispatch from here):

- Dedicated `damaged(amount)` signal carrying the hit delta (point #6) — cosmetic; fold into slice 3 floating-damage-text if/when that lands. → game-designer only if damage numbers wanted.
- Shield/typed damage = slice 3 (already specced). Regen/invuln/DoT = Later (already parked).
