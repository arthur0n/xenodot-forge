# FPS Sprint + Crouch — implementation digest (verified vs DiceOfFate stack)

Source: Hermes research run `run_fd5d77ad99d54e958ffd776c436fcdae`, verified 2026-06-18
against the live `entities/player/player.gd` + `player.tscn` (Godot 4.6).

Goal: add hold-to-sprint (run) and hold-to-crouch to the existing FIRST-PERSON
controller without a state machine. Both are **scalar modifiers + gating bools**
layered onto the flat `_physics_process`, ~60–80 LOC, zero new scripts/scenes/nodes.

## Why flat, not FSM

Our `player.gd` is already a flat `_physics_process` CharacterBody3D with the exact
shape sprint/crouch want: a single `effective_speed = move_speed * factor` expression
feeding a whole-vector XZ lerp (`flat_vel.lerp(target_vel, move_accel*delta)`), and
ADS already proves the pattern (`ads_move_scale` multiplier + separate FOV tween +
`_aiming` gate). Sprint/crouch are MORE factors in that one `effective_speed` expr
and MORE gate bools — not new states.

The jeh3no addon in `library/addons/jeh3no-salvage/` does it the FSM way
(RunState/CrouchState/WalkState/IdleState/InairState/JumpState, each mutating
`move_speed`/`move_accel`/hitbox on `enter()`). That is the anti-pattern for our
controller — do NOT port it. #1 self-inflicted mistake is reintroducing an FSM.

## Verified load-bearing claims

- **`test_move()` ceiling check** — `CharacterBody3D` inherits `PhysicsBody3D.test_move(from, motion, ...)`
  in 4.6; returns true if the body's ACTUAL shape would collide moving `motion`.
  Correct way to test "is there headroom to stand": `test_move(global_transform, Vector3.UP * stand_delta)`.
  Use this, NOT a RayCast3D — a ray misses geometry the capsule's width would hit.
- **CapsuleShape3D constraint `height >= 2*radius`** — true. Below it the capsule
  degenerates (hemispheres overlap). Our capsule `radius = 0.4` ⇒ min height **0.8**
  (Hermes assumed radius 0.5 / min 1.0 — WRONG radius for our rig, but crouch height
  1.2 is still safely above the real 0.8 floor).
- **FOV kick won't fight recoil** — recoil is a spring on `rotation` (body yaw +
  head pitch), never touches `fov`. Sprint FOV kick writes `_camera.fov`. No conflict
  with recoil. BUT it DOES share `_camera.fov` with the ADS FOV tween
  (`_set_aiming` `create_tween().tween_property(_camera,"fov",...)`). See gotcha below.
- **Multiplier-on-lerp fits** — confirmed; `effective_speed` (player.gd line ~139)
  is the single insertion point.

## Our actual rig numbers (from player.tscn)

- Capsule: `radius = 0.4`, `height = 1.8`. `CollisionShape3D` at `position = (0, 0.9, 0)`
  (centre at half-height; capsule BOTTOM = position.y − height/2 = 0).
- `Head` at `position = (0, 1.6, 0)` (eye height).
- Stand height 1.8 → crouch 1.2 ⇒ `delta_h = 0.6`.

## Crouch capsule anchoring — the #1 popping bug (CORRECTED sign)

When you shrink `height`, the capsule centre stays put, so the BOTTOM rises by
`delta_h/2` and the player pops off the floor. Re-anchor the bottom by moving the
shape down.

For OUR centre-anchored rig (CollisionShape3D.position is the capsule centre):
bottom = `position.y − height/2`. To keep bottom = 0 at crouch height 1.2:
`position.y = 1.2/2 = 0.6` (was 0.9). So **position.y DECREASES by delta_h/2 = 0.3**.

Hermes said "shift position.y UP by delta_h/2" — that sign is for a rig anchored at
the capsule's bottom origin, NOT ours. For our centre-origin capsule the offset is
DOWN. The robust formula independent of convention: keep
`shape_center_y = current_height/2` (so bottom stays at local 0). Lower the Head the
same way (e.g. `head.position.y = lerp(stand_eye, crouch_eye, crouch_amount)` with
crouch_eye ≈ 1.6 − 0.3·(per-taste) ).

## Design (no FSM, no Tween-for-transitions, no AnimationPlayer)

SPRINT:

- Hold-to-sprint input action (new: `sprint`).
- `is_sprinting` = COMPUTED each frame, not stored:
  `sprint_pressed and is_on_floor() and not _aiming and crouch_amount < 0.5 and input_dir != ZERO and input_dir.y < 0` (only when moving, typically forward).
- Apply as `effective_speed *= sprint_mult` (×1.6) — the existing accel/decel lerp
  chases it; no separate ramp.
- Optional FOV kick (+~6°) via a SEPARATE straight per-frame lerp toward a sprint FOV
  target. Skip stamina for POC.

CROUCH:

- Hold-to-crouch input action (new: `crouch`).
- Single `crouch_amount: float` (0..1), lerped in `_physics_process` (`lerp speed ~12`)
  toward 1 while held (and stay 1 if blocked overhead), else toward 0.
- Drives capsule height (1.8↔1.2) + shape.position.y (anchored, see above) + Head Y.
- `effective_speed *= lerp(1.0, crouch_speed_mult, crouch_amount)` (crouch ×0.5).
- Stand-up gated by `test_move()` headroom check; stay crouched while blocked.

LAYERING in one expr (illustrative):

```gdscript
var effective_speed := move_speed
if _aiming: effective_speed *= ads_move_scale
if is_sprinting: effective_speed *= sprint_mult
effective_speed *= lerpf(1.0, crouch_speed_mult, crouch_amount)
```

## Gotchas (verified + added)

- **FOV ownership clash**: ADS uses a one-shot `create_tween()` on `_camera.fov`;
  a per-frame sprint FOV lerp writing the same property will fight a live ADS tween.
  Mitigation: sprint is gated OFF while `_aiming`, so they're mutually exclusive in
  steady state — but on the aim↔sprint transition frame, kill/let-settle one before
  the other drives fov. Simplest: compute ONE target fov per frame
  (`ads_fov` if aiming else sprint-or-hip) and drive it with a single per-frame lerp,
  retiring the ADS `create_tween()` — OR keep ADS as-is and only run the sprint FOV
  lerp when `not _aiming`. Decide at build time.
- Capsule resize without re-anchor ⇒ player pops (the #1 bug). Use centre = height/2.
- RayCast instead of test_move for ceiling ⇒ clips through thin/edge geometry.
- `sprint_decel > move_decel` feels grabby — keep one decel.
- Reintroducing an FSM (the jeh3no path) — don't.

## New input actions needed

`sprint`, `crouch` — NOT in project.godot yet (current: move\_\*, jump, shoot, aim,
reload, equip_weapon, melee). Adding them is part of the build slice.

## Scope note

Sprint/crouch are NET-NEW scope, not part of prior planning.
Scope addition is a game-designer call before build.
