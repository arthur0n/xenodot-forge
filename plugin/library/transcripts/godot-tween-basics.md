# Godot Tween basics (2D) — transcript digest

**Source** — `transcripts/godot-tween-basics.md` (now in `transcripts/archive/godot-tween-basics.md`). Beginner YouTube tutorial, "how to use tweens in Godot 4.4", 2D `Sprite2D` demo.
**Why harvested** — about to build "simple, nice animated movements" in this iso 3D game.
**Stack** — verified vs Godot **4.6**, **GL Compatibility**, Jolt, typed GDScript-only, composition-over-autoloads.

## Points

| #   | Point (technique/claim)                                                                                                 | Valid for our stack? | Already learned?                                   | Where / gap                                                                                                                                          | Verdict                        |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `var t = create_tween()` makes a SceneTreeTween; runs automatically off the tree, no `_process` needed                  | holds                | **covered**                                        | live use `ui/player_hud.gd:103,172`                                                                                                                  | already ship it                |
| 2   | `tween_property(obj, "prop", final_value, duration)` interpolates any property over time                                | holds                | **covered**                                        | `player_hud.gd:106,175` (`"color:a"`, `"modulate"`)                                                                                                  | already ship it                |
| 3   | Sub-property path via `"modulate:a"` / `"color:a"` colon syntax to tween one channel                                    | holds                | **covered**                                        | `player_hud.gd:106` `"color:a"`                                                                                                                      | already ship it                |
| 4   | Sequential-by-default: stacked `tween_property` steps run one after another                                             | holds                | **partial → GAP (see reassessment)**               | `player_hud.gd` only chains ONE callback after ONE prop step; no multi-step sequence anywhere                                                        | now load-bearing (shake)       |
| 5   | `set_parallel(true)` (all subsequent) or `.parallel()` (per-step) run steps together                                    | holds                | **GAP**                                            | not used anywhere in game                                                                                                                            | now load-bearing (flash+shake) |
| 6   | `set_trans(Tween.TRANS_*)` — LINEAR default; ELASTIC/BOUNCE/QUAD/etc change curve shape                                 | holds                | **covered**                                        | `player_hud.gd:108,177` `TRANS_QUAD`                                                                                                                 | already ship it                |
| 7   | `set_ease(Tween.EASE_IN/OUT/IN_OUT)` slows start/end/both                                                               | holds                | **covered**                                        | `player_hud.gd:107,176` `EASE_OUT`                                                                                                                   | already ship it                |
| 8   | `tween_callback(some_func)` fires a fn after the prior steps; good for chain/loop                                       | holds                | **covered (single) / partial (as sequenced swap)** | `player_hud.gd:110` one hide callback; no fade-out→swap→fade-in await order authored                                                                 | now load-bearing (transitions) |
| 9   | Self-recalling callback fn = looping/bounce tween                                                                       | holds w/ caveat      | **gap**                                            | prefer `set_loops()` / `tween_method` over manual re-call recursion; recursion risks a dangling tween on freed node                                  | gap (rarely needed)            |
| 10  | Tween 2D `position` / `scale` as `Vector2`                                                                              | out of scope (2D)    | n/a                                                | our game is 3D — tween `Vector3` `position`/`scale`, or drive a `CharacterBody3D` via velocity, not a raw `position` tween that bypasses physics/nav | translate, not adopt           |
| 11  | Tween vs AnimationPlayer: tween = code/on-the-fly; AnimationPlayer = authored/long set pieces                           | holds                | **partial**                                        | true; also `godot-animation-libraries` (skeletal). A velocity-reactive procedural bob is a THIRD thing: `_process`, not Tween, not AnimationPlayer   | note only                      |
| 12  | `tween_method(callable, from, to, t)` drives a fn each step (not shown in video, but the natural shake/decay primitive) | holds                | **GAP**                                            | zero uses in codebase; needed for HP-bar shake with a decaying offset                                                                                | gap (ui_feedback)              |

## Caveats for OUR stack (load-bearing)

- 3D not 2D: tween `Vector3`, and **never** raw-`position`-tween a `CharacterBody3D`/nav agent — it fights physics + the 4.6 navmesh path loop (`godot-navmesh-pathing-4-6`). Tween is fine for **UI**, **modulate/color**, **camera zoom/FOV**, **scale pops**, **props** — motion that isn't physics-simulated.
- Data-driven convention: any tween duration/curve/trans/ease must be a `.tres` field or `@export` assigned on the live node — not a literal. `player_hud.gd` already does this (`overdraw_flash_duration`, `perfect_flash_duration`). A new tweened feature inherits that rule.
- Composition: tweens live on the component that owns the node, no autoload.

---

## REASSESSMENT — 2026-07-01 (scope expanded: single ask → game-wide animation/juice initiative)

**Trigger** — original verdict was scoped to ONE small ask ("simple animated movements"). Scope has since grown into THREE systems all built on the same Tween foundation: `design/scene_transitions.md`, `design/motion_feel.md`, `design/ui_feedback.md` — written by game-designer WITHOUT looping the transcript findings first.

**Does the original verdict still hold? NO — verdict REVISED.**

"Covered subset, direct-apply, no skill" was right for one HUD flash. WRONG for three systems that each need Tween patterns the codebase does NOT yet demonstrate. Codebase reality (grep): only 2 tween sites (`player_hud.gd:103,172`), both **single-step** `create_tween().tween_property().set_ease().set_trans()` + one `tween_callback`. ZERO parallel steps, ZERO multi-step sequence, ZERO callback-chained swap order, ZERO `tween_method`/shake anywhere. So the transcript's parallel/sequencing/`tween_method`/callback-chain techniques (points 4, 5, 8-as-order, 12) are "covered" only ON PAPER — not shipped. Three slices re-deriving the same Tween mechanics per-doc = exactly the repeated pattern a skill should capture.

### Per-doc: does the proposed impl reflect the transcript, or under-use it?

**`scene_transitions.md` — CORRECT target, UNDER-specifies easing + callback order.**

- Tweens a `ColorRect` alpha (points 2/3, colon `color:a`) — right (UI Control, not a body); cites the position-vs-`move_and_slide` caution. Good.
- GAP: says "alpha tweened per the config" + `await Tween.finished` but names NO trans/ease, and `TransitionConfig` has NO `fade_trans`/`fade_ease` field. Points 6/7 are the whole reason a fade feels smooth vs linear-cheap; a fade wants `EASE_IN_OUT` + `TRANS_SINE`/`TRANS_QUAD`, authored as DATA (data-driven rule DEMANDS it, since bare-linear is still a hidden choice).
- GAP: point 8 order is implicit — the level swap must happen in the **callback AFTER fade-out `finished`**, then fade-in; the doc must state `await fade_out()` → free+instantiate+wire → `await fade_in()` is the callback sequence, not a race.
- **Fix (game-designer):** add `fade_trans`/`fade_ease` `.tres` fields; spell out the fade-out→swap-callback→fade-in await order.

**`motion_feel.md` — CORRECT, and correctly OUTSIDE the transcript.**

- Key nuance: tilt+bob is a PER-FRAME procedural drive (`sin(time*bob_speed)`, velocity-smoothed lean) on a visual child — a `_process` transform write, NOT a Tween. The transcript is a Tween tutorial; a continuous velocity-reactive bob is the third category the transcript flags at point 11 (neither Tween nor AnimationPlayer). motion_feel lands OUTSIDE the transcript rightly. The nav-body caution it cites comes from OUR digest caveats, not the transcript's 2D content — good reuse. The one place a Tween belongs in this domain — a squash-and-stretch _pop_ on shove-impact — is correctly parked as Later.
- **Fix (minor):** one-line clarification that tilt+bob is frame-driven procedural, NOT Tween — so a builder doesn't reach for `tween_property` on a per-frame bob. No transcript technique is missing.

**`ui_feedback.md` — Tween-heavy; the transcript is genuinely UNDER-USED. Two concrete technique gaps:**

1. **HP-bar "shake" — transcript shows no shake primitive; doc hand-waves "tween the bar's `position`/`modulate`".** A real shake is EITHER `tween_method` feeding a decaying random offset (point 12, never shown in video) OR a multi-step **sequential** offset chain (left/right/left/settle — point 4). Doc names neither. **Fix: specify shake as a sequenced offset chain OR `tween_method` with decay, settling to rest, timed by `shake_time`.**
2. **Flash + shake on the SAME damage event must run in PARALLEL — point 5 (`set_parallel(true)`/`.parallel()`), and the doc does not say so.** Sequential would make the shake wait for the flash (visibly wrong). **Fix: put the two on ONE tween with `set_parallel(true)` (or two independent tweens) — call it out; it is the exact technique the codebase has NEVER used.**
3. Cooldown sweep (full→empty over cooldown) = plain single-step `tween_property` on `ProgressBar.value` + ease (points 2/7) — fine; config already has `sweep_ease`. Good.

### Verdict (on top of the 6 buckets) — parallel/sequencing/`tween_method`/callback-order are now LOAD-BEARING and un-captured

- **Bucket 1 (source idea):** Tween chaining, parallel vs sequential steps, easing/transition curve choice, callback sequencing — the video's actual content.
- **Bucket 2 (candidate offers):** all of the above, in 2D — the exact mechanics all three docs need but two (transitions, ui_feedback) leave implicit or wrong.
- **Bucket 3 (no-brainers → Recommended next):** amend `scene_transitions.md` (`fade_trans`/`fade_ease` fields + explicit fade-out→swap-callback→fade-in await order) and `ui_feedback.md` (shake primitive = sequenced/`tween_method`; flash+shake = PARALLEL; name `sweep_ease`). Precise doc corrections, not new research.
- **Bucket 4 (improve/rework → Recommended next):** a reusable **`godot-tween-juice`** skill IS now warranted — three slices on one Tween foundation, and the parallel/sequence/`tween_method`-shake/callback-order patterns are NOT in the codebase to copy. Capture once (with OUR-stack caveats) beats three per-slice re-derivations. Route to skill-researcher to find/evaluate — human approves adoption.
- **Bucket 5 (system/framework park → Later):** framework note "Tween = on-the-fly UI/visual motion; velocity-reactive per-frame feel (bob) is `_process`, not Tween; never raw-`position`-tween a physics/nav body" — fold into the eventual `godot-tween-juice` skill's boundaries, not a loose aside.
- **Bucket 6 (skip):** point 10 (2D `Vector2` position tween on a body) still skip. `motion_feel` does NOT need a Tween skill — leave it out; do not force-fit Tween onto a frame-driven bob. Point 9 recursion — skip in favour of `set_loops()`.

### Recommended next (explicitly routed this time)

1. **`xenodot:skill-researcher`** — find/evaluate a reusable **`godot-tween-juice`** skill: sequential-vs-parallel (`set_parallel`/`.parallel()`), `set_trans`/`set_ease` curve choice, `tween_callback` chaining/await-order, `tween_method` for shake/decay — with OUR-stack caveats baked in (3D; never raw-`position`-tween a nav/physics body; all durations/curves/trans/ease as `.tres`/`@export` DATA). Justification: three slices (transitions + ui_feedback shake/flash + future squash) share this foundation; codebase has only single-step examples. Human approves adoption per charter.
2. **`xenodot:game-designer`** — amend `scene_transitions.md` + `ui_feedback.md` with the specific technique refs above. `motion_feel.md` needs only the one-line "frame-driven procedural, NOT Tween" clarification — no technique missing.

- **NOT addon-researcher:** hand-rolled native Tween is the right tool (per the transcript); no addon does fade/shake/sweep better than a `.tres`-tuned Tween. Skip.
