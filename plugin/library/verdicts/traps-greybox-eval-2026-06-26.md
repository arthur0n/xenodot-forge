# Verdict — Greybox FPS "traps" (Hermes findings, 2026-06-26)

## VERDICT (on top of buckets)

**REJECT a new `godot-traps` skill. REJECT the `TrapZone.tscn` enum component as a system.**
Recommendation: **convention-only + two one-line gotcha notes baked into existing skills.**
Our existing architecture already covers every trap type Hermes named, with code that matches
his "correct" pattern — including the velocity-zero step he flagged as critical-and-easily-missed,
which we already have.

Gap status: **NO gap.** A successful result = stop, don't author.

---

## Grounding (what already exists in THIS repo)

- **Fall trap (the headline pattern).** `FallZone` Area3D (`collision_layer=0`, `collision_mask=2`
  = player layer) is already the greybox convention (`godot-greybox` SKILL.md L42; emitted by
  `entities/arena/arena_builder.gd:_emit_fall_zones`). The level connects its `body_entered`.
- **The "critical, easily-missed" velocity-zero step is ALREADY in code.** `tools/lib/players.gd`
  → `Players.reset_to(player, pos, rot_y)` teleports AND zeros velocity:
  `(player as CharacterBody3D).velocity = Vector3.ZERO`. Exactly Hermes' fix. Not missing.
- **OOB / ceiling guard.** `tools/lib/oob_guard.gd` → `OobGuard.add_oob_guard()` returns an Area3D
  the level wires to the same fall/respawn handler. Covers "left the arena up top".
- **Hazard / kill / damage volume.** Cast/Effect system (`cast-system`, `godot-effect-composition`)
  - `HealthComponent` + `damage_type` already deliver typed damage to anything with the apply seam.
    A spike/lava/damage-floor = an Area3D `body_entered` → existing damage apply. No new system.
- **Deferred collision toggle.** Hermes' `set_deferred("disabled", true)` is sound — we already
  use the same idiom (`pickup.gd`: `set_deferred(&"monitoring", false)`). Available if a trapdoor
  is ever built; not needed now.

## Findings verified

- velocity-zero + collision_mask-includes-player: CORRECT, and already implemented here.
- `set_deferred` inside physics callback: CORRECT, matches our existing usage.
- Godot bug #66468 (Area3D misses newly-INSTANCED StaticBody3D): real, but applies ONLY to runtime
  node instancing — which we **ban** (levels are static hand-authored scenes). Irrelevant to us.
- `body_entered` one-frame latency, avoid ConcavePolygonShape3D in Area3D: true general gotchas.

---

## 6 buckets

1. **From the idea** — author "traps" (fall pit, spikes/lava kill, teleport pad, crusher) for the
   greybox FPS arena, data-driven and editor-authored.

2. **From the candidate** — a `TrapZone.tscn` (Area3D + CollisionShape3D + Marker3D) with
   `@export enum TrapType {FALL_RESPAWN, DAMAGE, KILL, TELEPORT}` + Marker3D refs + optional
   `TrapConfig` Resource, plus per-type patterns (hybrid fall pit, crusher via AnimatableBody3D,
   moving-platform gap, damage floor).

3. **No-brainers (bake regardless)** — TWO one-line gotcha notes, no new files:
   - `godot-greybox` FallZone section: add "respawn handler MUST zero player velocity — use
     `Players.reset_to()`; retained fall velocity = the launch-on-respawn bug. Area3D
     `collision_mask` must include the player layer (2), else `body_entered` never fires."
   - (optional) same skill: "`body_entered` fires once during the physics step (one-frame latency);
     avoid ConcavePolygonShape3D in an Area3D — use Box/primitive shapes."
     These are edits to an existing skill's Error→Fix / convention text, gated like any `.claude/` write.

4. **Improvements (adopt-but-rework)** — none worth taking. The `TrapType` enum + `Marker3D`
   teleport-dest is a thinner re-implementation of capabilities we already have via composition.
   Folding fall/teleport/damage into one enum-switched script CONFLICTS with composition-over-
   inheritance (one node, four behaviours by enum) and with our data-driven default (the payload
   already lives in CastData `.tres`, not a parallel `TrapConfig`). Rework = "use the systems we
   have," i.e. nothing to author.

5. **Not now — SYSTEM (framework) ideas to park** — IF a future game needs MOVING hazards
   (crusher / moving platform), the AnimatableBody3D (`sync_to_physics=true`, physics callback
   mode) + `platform_on_leave` + Area3D-kill-child pattern is a genuinely new capability not in
   any current skill, and would justify a `godot-moving-hazard` framework skill THEN. Park in the
   framework "Later" list; do NOT build for this POC (no moving traps in scope).

6. **Skip** — the new `godot-traps` skill; the `TrapZone` enum component; the `TrapConfig`
   Resource; the runtime-instancing bug workaround (#66468) — all skip (banned or redundant here).

---

## Proposed action if user wants the notes (foreground write — gated)

No new skill file. Two single-line edits to `godot-greybox` SKILL.md (plugin-owned skill; edit is
a framework change, not a game file): the velocity-zero / collision-mask gotcha (bucket 3). Path:
`xenodot-forge/plugin/skills/godot-greybox/SKILL.md`. No `CLAUDE.md` Skills-list change (no new skill).

## Next task for godot-dev (if/when a trap is requested)

"Build trap X as a static hand-authored Area3D in the level `.tscn`: fall → FallZone + connect
`body_entered` to `Players.reset_to`; damage/kill → Area3D `body_entered` → existing Cast/Effect
damage apply. No new TrapZone component, no runtime geometry."
