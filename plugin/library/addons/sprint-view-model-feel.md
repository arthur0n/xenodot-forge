# Sprint View-Model "Running Feel" — Digest

**Request** — Add a sprint running-feel to the FPS player: view-model lowers + swings to the
side with sine sway while sprinting (like the Jeh3no addon's run state). Hermes researched the
technique; this digest reconciles it against DiceOfFate's ACTUAL post-refactor code + local salvage.

**Status** — verified-against-stack, NOT yet built. Decision gate posted to user (extend-skill vs park).

**Verdict (recommendation)** — Park for now; build is a clean ~40–50 LOC procedural slice when
scheduled. When built, **extend `godot-first-person-controller`** (consistent with how flat
sprint/crouch + FOV-kick already landed there) rather than spawn a new skill.

---

## Corrections to Hermes findings (Hermes had NO filesystem access)

| Hermes claim                                                                | Reality (verified in live files)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprint pose belongs in `weapon.gd`                                          | View-models live under `WeaponController/Head/{Weapon,Rifle,Melee}`; BUT the **view-model Node3D transform is owned by `entities/weapon/weapon.gd`** (`_view_model`, the `_VM_REST_POS/_VM_DIP_POS/_VM_REST_ROT/_VM_DIP_ROT` tweens for swap/reload). `weapon_controller.gd` owns recoil/ADS/swap orchestration but does NOT hold a `_view_model` ref. So the sprint pose belongs in **`weapon.gd`** (owns the local transform), relayed through `weapon_controller.gd`. Hermes named the right _file class_ by luck but wrong reasoning. |
| Salvage = Jeh3no "Advanced State Machine FPC" (GitHub)                      | OUR salvage = **"Jeheno Simple FPS Weapon System"**, at `library/addons/jeh3no-salvage/`. Its sprint feel is **camera-holder tilt + FOV** (`player_camera_script.gd`: `rotation_degrees.z` roll lerp on side input, forward-tilt tween, per-state FOV dict Run=100), NOT a view-model swing. `run_state_script.gd` only swaps move speed/accel. So our salvage does NOT contain the view-model-swing technique — Hermes' technique is net-new to our codebase, valid but unsourced from salvage.                                          |
| Apply only to view-model Node3D local transform, after bob/recoil/ADS write | Correct in spirit, with a GOTCHA: `weapon.gd` already drives `_view_model.position`/`rotation_degrees` via **absolute** tweens (swap holster/draw, reload dip/restore). A continuous sprint sway that writes the SAME properties will FIGHT those tweens (last writer wins each frame → snapping). See "Key gotcha" below.                                                                                                                                                                                                                |

---

## Verified load-bearing claims

- **Local-transform-only (never Head/Camera3D)** — VALID. `Head` owns pitch (`_look_pitch + _recoil_pitch`), additive head-bob (`_bob_offset_y/x` on `_head.position`), and melee camera-kick (`_head.rotation.x` tween). Writing sprint sway to the view-model's own local transform keeps it off all of that.
- **Pure procedural over AnimationPlayer** — VALID for this POC. View-models are mesh-only Node3Ds (`PistolViewModel`/`RifleViewModel`), no AnimationPlayer present. ~40–50 LOC sine math is cheaper than authoring + wiring clips.
- **Composite gate + asymmetric lerp** — sound. Gate must include the SAME conditions the player already uses for `is_sprinting` PLUS weapon-side state: `is_sprinting AND NOT _aiming AND NOT firing AND NOT _reloading AND NOT _swapping`. `_aiming`, `_reloading`, `_swapping` already tracked in `weapon.gd`/`weapon_controller.gd`.
- **Head-bob double-apply risk** — CONFIRMED REAL. `player.gd._update_bob` amplifies bob while sprinting via `sprint_bob_mult=1.3` and `sprint_bob_freq_mult=1.4` on `_head.position`. Adding view-model sway on top is two sprint emphases stacked. **Decision when building: dial the existing sprint-bob multipliers back toward ~1.0–1.1** (or split: keep bob for footfall cadence, let view-model sway carry the "arm swing"), then tune together. Do not ship both at full strength.

---

## Correct wiring seam (relay chain)

`is_sprinting` is a LOCAL var in `player.gd._physics_process` (step 8, lines ~177–190; stamina-gated). It is NOT stored and NOT currently forwarded. Mirror the existing forward pattern:

- player already calls: `_weapon_controller.process_input(...)`, `.update_recoil(delta)`, `.set_active_weapon_crouch(bool)`, `.is_aiming()`.
- **Add** `WeaponController.update_sprint(active: bool, velocity_factor: float, delta: float)` called from `player.gd` each physics frame (next to `set_active_weapon_crouch`). `velocity_factor = clampf(flat_speed / (move_speed * sprint_mult), 0, 1)`.
- `WeaponController.update_sprint` relays to the active weapon: add `Weapon.update_sprint(active, velocity_factor, delta)` that advances the sine phase and writes the sprint pose onto `_view_model`.
- The composite gate is split: player supplies `is_sprinting` (movement truth); `weapon.gd` ANDs in its own `not _aiming/_reloading/_swapping` (already local there).

## Key gotcha (the one that bites)

`weapon.gd` swap/reload tweens set `_view_model.position`/`rotation_degrees` **absolutely**. Sprint sway on the same node = property contention. Two clean options:

1. **Separate sway node** — insert a `SprintSway` Node3D between the weapon and the mesh; tweens keep writing the weapon-level `_view_model`, sprint writes the child. No contention. (Adds one node per view-model; touches the scenes.)
2. **Single base + additive compose** — make the swap/reload "rest/dip" a stored base var (not written straight to `_view_model`); each frame set `_view_model.position = base_pos + sprint_offset`, `rotation = base_rot + sprint_rot`. Pure-script, no scene change, but requires reworking the existing tweens to target the base var. More invasive to existing code.

Recommend option 1 (scene-local SprintSway child) — leaves the proven swap/reload tweens untouched, isolates the new layer. Per-weapon calibration (pistol vs rifle vs melee origins) then lives on each SprintSway node's rest transform.

## Starting @export values (from Hermes, tune in-editor)

```
sprint_pose_pos   ≈ Vector3( 0.18, -0.15,  0.05)   # lower + to the side
sprint_pose_rot   ≈ Vector3(-12.0,  8.0, -18.0)    # degrees; roll (-Z) dominant
sway_roll_deg     ≈ 8.0    # dominant arm-swing term
sway_vert_freq    = 2x the roll freq
enter_lerp        = 8.0
exit_lerp         = 12.0
interrupt_lerp    = 20.0   # on fire / ADS
```

Sine phase advances ALWAYS; amplitude = weight × velocity_factor. Reset phase only on sprint ENTER. Per-weapon pose differs (pistol/rifle/melee origins) — calibrate each.

## Already-skilled check

`godot-first-person-controller` now covers flat sprint (speed mult) + crouch + sprint FOV-kick.
It explicitly PARKS "FOV kick on sprint" and does NOT cover view-model sprint pose/sway. No
existing skill covers this. Gap is real.

## Next step on approve

(Optionally extend `godot-first-person-controller` with a "Sprint view-model feel" section) →
game-designer scopes the ~40–50 LOC slice (SprintSway child + relay seam + head-bob reconciliation)
→ godot-dev implements in `weapon.gd` (+ `weapon_controller.gd` relay, `player.gd` forward) →
godot-verify.

---

Reconciled against: `entities/player/player.gd`, `entities/player/components/weapon_controller.gd`,
`entities/weapon/weapon.gd`, `library/addons/jeh3no-salvage/{run_state_script,player_camera_script}.gd`,
skill `godot-first-person-controller`. Verified 2026-06-18.
