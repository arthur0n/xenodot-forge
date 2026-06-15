# Basic Enemy Path AI (Godot) — transcript digest

**Source** — `godot-basic-enemy-path-ai.md` (raw now in `transcripts/archive/godot-basic-enemy-path-ai.md`). Short beginner tutorial: a NavigationAgent3D enemy that follows the player around baked walls.
**Why harvested** — more work on enemy AI (Track B3, `design/firing_yard_enemy.md`); cross-check vs adopted `godot-enemy-ai` skill + shipped `entities/enemy/`.

**Points**
| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | NavigationRegion3D child holds the floor; new NavigationMesh + bake (enable "bake navigation") for the walkable surface | holds | covered | skill Step 1; design prereq 1 | known |
| 2 | Enemy = CharacterBody3D + MeshInstance3D + CollisionShape3D + NavigationAgent3D (capsule) | holds | covered | skill scene tree; `enemy.tscn` | known |
| 3 | `_physics_process`: apply gravity if not on floor; `get_next_path_position()`; normalize direction; `move_toward` velocity; `move_and_slide()` | holds w/ caveat | covered (better) | skill `move_along_path` keeps `velocity.y` separate + routes X/Z through `_nav.velocity` → `velocity_computed` (RVO avoidance). Transcript mixes gravity into the move dir — skill's Error→Fix "floats/sinks" row warns against exactly this | known |
| 4 | Walls/barriers added as NavigationRegion children, then clear + re-bake → agent paths around them | holds | covered | skill Step 1 ("re-bake whenever floor changes"); design prereq 1 | known |
| 5 | Find target by group + main scene pushes player world position into the enemy each frame | holds w/ caveat | covered (better) | skill: enemy pulls `get_first_node_in_group("player")` itself, throttled re-path in ChaseState (`REPATH_INTERVAL` 0.25s) — NOT a per-frame push from main. Transcript's push-every-frame is the "chase stutters/CPU spike" pitfall the skill warns against | known |

**Nav-timing pitfall cross-check (the asked-about bug)** — transcript covers NONE of it. The real bug we fixed: `NavigationAgent3D.is_navigation_finished()` returns `true` on the SAME physics frame `target_position` is set (nav server needs one tick to compute the path), so the enemy reads "already arrived" and never moves. Skill is partial here: it has an Error→Fix row "Path is empty on the very first frame → set destinations from `enter()`/after `_ready`; the ChaseState throttle covers this," and ChaseState repaths on `enter()`. But it does NOT name the specific `is_navigation_finished()`-true-same-tick trap, nor tell PatrolState to guard the first-frame "finished" reading. PatrolState's `enter()` calls `_go_to_current()` then next frame checks `navigation_finished()` — vulnerable to the same one-tick race. Worth a skill learning.

**Recommended next**

- Teach `godot-enemy-ai` the explicit nav-timing pitfall: `is_navigation_finished()` returns true the same physics frame `target_position` is set (server needs one tick) → enemy never moves; guard with a "destination set this frame" flag or first-frame skip in PatrolState, not just the ChaseState throttle. → **skill-researcher** (skill-update; human approves the edit). This is the one genuine gap and it bit us in this build.

**Later** — none. Transcript adds nothing beyond what the skill already teaches better; it is a subset of our adopted skill.
