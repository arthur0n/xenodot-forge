---
name: godot-stealth-perception
agents: [godot-enemy]
description: >-
  The "find player" / aggro-trigger stack for a stealth enemy in Godot 4.6 — a
  `VisionCone3D` (tattomoosa addon, Area3D, an FOV cone with a LOS test) + a custom
  `HearingArea` (Area3D radius) + a thin `emit_noise()` seam, all feeding a node-FSM
  with Patrol → Aggro → Alert → Search states and a recorded `last_known_position`.
  "Find player" is TWO channels (see OR hear), both gated on the body being in group
  `"player"` (a silent no-op otherwise), both routed to `fsm.trigger_aggro()`. Spells
  out the contrast with `godot-enemy-ai`'s cheaper distance + single `RayCast3D` LOS
  so a game picks deliberately, and names the #1 trap: hearing fires NOTHING until
  something calls `emit_noise` (player movement/ability is the first emitter). Use
  when "enemy can't find / see the player", "guard never aggroes", "vision cone",
  "FOV / line-of-sight cone", "hearing / noise detection", "make noise alert the
  guard", "emit_noise", "patrol → chase → search FSM", "last known position",
  "stealth AI", or "alert / deaggro / search states". NOT pathfinding / navmesh / how
  the agent MOVES (that is `godot-navmesh-pathing-4-6` + `godot-enemy-ai`), NOT the
  archetype data model (`godot-enemy-archetype`), NOT headless testing
  (`godot-enemy-ai-headless-smoke`). Composes with all of those.
---

# Godot stealth perception (vision cone + hearing + see-or-hear aggro FSM)

"Find the player" is a perception problem separate from pathing. `godot-enemy-ai` ships the
CHEAP perception — a distance check + one `RayCast3D` line-of-sight that flips patrol→chase. A
stealth game wants a real FOV **cone** (you can sneak behind a guard), **hearing** (noise gives
you away), and a graceful give-up (**alert** → **search** the last-known spot → **patrol**).
This skill is that perception layer: two `Area3D` channels collapse into one
`fsm.trigger_aggro()`, plus the Alert/Search tail. Every snippet is the shape proven on
mercenary's `Guard` (`entities/enemy/guard.gd`) + `EnemyFSM` + `VisionCone3D` v0.3.0; the system
shape is settled in `design/stealth_enemy_ai.md`.

## Requirements

- `godot-enemy-ai` — the node-FSM + movement substrate the stealth states extend; Aggro chases
  through its nav layer.
- `godot-navmesh-pathing-4-6` — the 4.6 nav substrate Aggro/Alert/Search move on (runtime bake,
  snap, velocity ordering). Perception without a working nav layer = a guard that aggroes and
  then stands still.
- `godot-enemy-archetype` — `fov_angle`, `vision_range`, `hearing_radius`, `deaggro_timer`,
  `search_duration` live in the archetype `.tres`, READ in `_ready` (no literals in logic).
- `VisionCone3D` (tattomoosa, tag v0.3.0, MIT) installed under `addons/`, plugin enabled,
  verified loading + signalling on Godot 4.6.
- **The player node in group `"player"`** (`add_to_group("player")` in its `_ready`) — both
  channels silently no-op otherwise. Group names are case-sensitive string contracts
  (`"Player"` ≠ `"player"`).

## Project conventions

- Perception nodes are CHILDREN of the guard: `VisionCone3D`, `HearingArea` (Area3D). The FSM is
  a child node (`EnemyFSM`) owning `PatrolState · AlertState · AggroState · SearchState`.
- **Cone convention:** `VisionCone3D` looks along its LOCAL `-Z` (addon convention). Rotate the
  cone (or make the guard face `-Z`) so it points FORWARD. Configure from the archetype.
- **`HearingArea`** is a ~30-line `Area3D` with a settable radius (`set_radius`) that emits
  `noise_heard(origin: Vector3)` when a noise event lands inside the radius.
- **`last_known_position`** is a `Vector3` on the guard, written on every sight/hear; it drives
  Alert and Search.

## Steps

1. **Configure cone + hearing from the archetype in `_ready`** (real `guard.gd`):

   ```gdscript
   _vision.range = archetype.vision_range
   _vision.angle = archetype.fov_angle
   _vision.vision_test_ignore_bodies = [self]   # don't detect your own collision body
   _hearing.set_radius(archetype.hearing_radius)
   ```

2. **Wire both channels to the FSM** (real `guard.gd`):

   ```gdscript
   _vision.body_sighted.connect(_on_body_sighted)
   _vision.body_hidden.connect(_on_body_hidden)
   _hearing.noise_heard.connect(_on_noise_heard)
   ```

3. **Gate on group `"player"`, record last-known, trigger aggro** (real `guard.gd`):

   ```gdscript
   func _on_body_sighted(body: Node3D) -> void:
   	if not body.is_in_group("player"):   # SILENT no-op if the player isn't grouped
   		return
   	last_known_position = body.global_position
   	_fsm.trigger_aggro()

   func _on_body_hidden(body: Node3D) -> void:
   	if not body.is_in_group("player"):
   		return
   	_fsm.trigger_lost()

   func _on_noise_heard(origin: Vector3) -> void:
   	last_known_position = origin
   	_fsm.trigger_aggro()                 # see OR hear → the SAME aggro entry
   ```

4. **Emit noise from the world/player — the channel everyone forgets.** Hearing fires NOTHING
   until something calls the `emit_noise` seam; a guard that "only ever sees, never hears" almost
   always has an un-wired emitter. The player's movement / ability is the first emitter (e.g. a
   push emits a noise at the impact point). A thin signal seam, NOT an autoload bus:

   ```gdscript
   # emitter side (player / ability): announce a noise event at a point + radius.
   emit_noise(global_position, noise_radius)   # HearingArea inside radius → noise_heard(origin)
   ```

5. **FSM transitions (Patrol / Alert / Aggro / Search), all archetype-timed** (see
   `design/stealth_enemy_ai.md`):
   - **Patrol** → Aggro on `body_sighted` OR `noise_heard` (sentry: idle-scan, no move).
   - **Aggro/Chase** → Alert on `body_hidden` (lost LOS); records `last_known_position` each
     frame and chases at `chase_speed` via the nav layer.
   - **Alert** → moves to last-known, counts down `deaggro_timer`; re-sight → Aggro; expire →
     Search.
   - **Search** → dwell/scan at last-known for `search_duration`; re-perceive → Aggro; expire →
     Patrol. Any state seeing/hearing the player re-acquires to Aggro.

6. **Choose cone+hearing vs cheap LOS — deliberately, don't run both.** Use THIS skill (cone +
   hearing) when stealth matters: sneaking behind a guard or trading noise for speed is core.
   Use `godot-enemy-ai`'s distance + single `RayCast3D` `_eye` (diceofate) when the enemy just
   needs to notice a nearby visible player (FPS aggro) — cheaper, no addon, all-or-nothing LOS.

## Verification checklist

- [ ] Player in cone + range + LOS → Patrol→Aggro within ~5 frames (`current_state.name ==
    "AggroState"`).
- [ ] Player OUT of the cone but a `noise_heard` lands within `hearing_radius` → also Aggro
      (see-OR-hear proven).
- [ ] Player NOT in group `"player"` → neither channel triggers. (That's the bug, not a feature
      — confirm the player is grouped.)
- [ ] `body_hidden` → Alert; after `deaggro_timer` with no re-perceive → Search; after
      `search_duration` → Patrol (full state sequence).
- [ ] A `sentry.tres` guard (no `PatrolPath`, `is_sentry=true`) never moves in Patrol but still
      aggroes on perceive.
- [ ] Swapping the archetype `.tres` (different FOV / range / timers) changes behaviour with zero
      `.gd` edits.
- [ ] The cone gizmo points along the guard's forward (`-Z`); rotating the guard aims it.

## Error → Fix

| Symptom                                                             | Fix                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guard never aggroes, no error in the log                            | Player not in group `"player"` → `_on_body_sighted` silently returns. `add_to_group("player")` in the player `_ready`; group literals are case-sensitive (`"Player"` ≠ `"player"`). |
| Guard SEES the player but never HEARS anything                      | Nothing calls `emit_noise`. Wire player movement / ability to the `emit_noise` seam; confirm `HearingArea` radius is set from the archetype.                                        |
| Cone never fires, or only fires when the player is BEHIND the guard | `VisionCone3D` looks along local `-Z`. Rotate the cone / guard so it faces forward. Also set `vision_test_ignore_bodies = [self]` (else it detects its own body and self-aggroes).  |
| Guard aggroes through solid walls                                   | The cone's LOS test mask is wrong / occluders aren't on the tested layer. Put walls on the layer the cone raycasts so they block sight; keep the player off that layer.             |
| Hearing triggers for everything / from too far                      | `hearing_radius` (or the emitter's `noise_radius`) too large. Tune in the archetype / at the emitter.                                                                               |
| Guard flickers aggro→patrol at the cone edge                        | `body_hidden` fires every frame at the boundary. Don't return to Patrol on the first `body_hidden` — go to Alert and let `deaggro_timer` debounce it.                               |
| Want a smarter "where to search next"                               | Don't touch the FSM — swap the `PatrolPlanner` seam node (parked). The hook is already built.                                                                                       |

## Parked (intentionally not built)

- Gradual detection/alarm METER (fill-to-aggro) instead of binary see→aggro.
- Squad comms / shared last-known across guards.
- Footstep-noise volume scaling with crouch/speed; a player-facing render of the guard's cone.
- An AI `PatrolPlanner` that picks search rooms by last-seen/weighting. (All new data/nodes on
  existing seams — zero FSM change.)

Composes with `godot-enemy-ai` (FSM/movement), `godot-navmesh-pathing-4-6` (the 4.6 nav the
chase rides on), `godot-enemy-archetype` (the tuning), and `godot-enemy-ai-headless-smoke` (what
of this is testable headless — the FSM transitions, NOT the cone/hearing physics). Verified on
mercenary `Guard` + `VisionCone3D` v0.3.0 on Godot 4.6.
