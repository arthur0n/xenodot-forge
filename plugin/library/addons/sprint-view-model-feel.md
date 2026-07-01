# Sprint View-Model "Running Feel" — Digest

**Request** — Add a sprint running-feel to an FPS view-model: the weapon lowers + swings to the
side with sine sway while sprinting. Hermes researched the technique; this digest is the reusable
method plus the caveats that bite when wiring it into a first-person-controller stack.

**Status** — technique verified against a real FPC stack, NOT yet built. Decision gate: extend-skill
vs park.

**Verdict (recommendation)** — Park until scheduled; the build is a clean ~40–50 LOC procedural
slice. When built, **extend the first-person-controller skill** (where flat sprint/crouch + FOV-kick
already live) rather than spawn a new skill.

---

## Verified load-bearing claims

- **Local-transform-only (never Head/Camera3D)** — write sprint sway to the view-model's OWN local
  transform. The Head/Camera typically owns pitch (look + recoil), additive head-bob, and any
  melee/impact camera-kick; keeping sway on the view-model's local transform keeps it clear of all
  of that.
- **Pure procedural over AnimationPlayer** — valid for a POC when the view-models are mesh-only
  Node3Ds with no AnimationPlayer. ~40–50 LOC of sine math is cheaper than authoring + wiring clips.
- **Composite gate + asymmetric lerp** — the gate must AND the movement condition with weapon-side
  state: `is_sprinting AND NOT aiming AND NOT firing AND NOT reloading AND NOT swapping`. Enter,
  exit, and interrupt use different lerp speeds (interrupt fastest, on fire / ADS).
- **Head-bob double-apply risk** — if the controller already amplifies head-bob while sprinting,
  adding view-model sway on top stacks two sprint emphases. Dial the sprint-bob multipliers back
  toward ~1.0–1.1 (or split roles: bob carries footfall cadence, view-model sway carries the arm
  swing), then tune together. Do not ship both at full strength.

## Where the sprint pose lives (ownership)

The view-model's local transform is usually owned by the **weapon script** — the node that runs the
swap/reload/ADS tweens on the view-model — NOT the weapon-controller, which orchestrates
recoil/ADS/swap but need not hold a view-model reference. Put the sprint pose where the local
transform is owned, and relay the movement truth in.

## Correct wiring seam (relay chain)

`is_sprinting` is typically a local, stamina-gated var in the player controller's physics step —
not stored, not forwarded. Mirror the forward pattern the controller already uses for other
per-frame relays (e.g. `process_input`, `update_recoil`, `set_active_weapon_crouch`):

- **Add** `WeaponController.update_sprint(active, velocity_factor, delta)`, called from the player
  each physics frame. `velocity_factor = clampf(flat_speed / max_sprint_speed, 0, 1)`.
- `WeaponController.update_sprint` relays to the active weapon: `Weapon.update_sprint(active,
velocity_factor, delta)` advances the sine phase and writes the sprint pose onto the view-model.
- Split the composite gate: the player supplies `is_sprinting` (movement truth); the weapon ANDs in
  its own `not aiming / not reloading / not swapping` (already local there).

## Key gotcha (the one that bites)

Swap/reload tweens usually set the view-model's `position` / `rotation_degrees` **absolutely**. A
continuous sprint sway writing the SAME properties fights those tweens (last writer wins each frame
→ snapping). Two clean options:

1. **Separate sway node** — insert a `SprintSway` Node3D between the weapon and the mesh; the tweens
   keep writing the weapon-level view-model, sprint writes the child. No contention. (Adds one node
   per view-model; touches the scenes.)
2. **Single base + additive compose** — make the swap/reload "rest/dip" a stored base var (not
   written straight to the view-model); each frame set `view_model.position = base_pos +
sprint_offset`, `rotation = base_rot + sprint_rot`. Pure-script, no scene change, but requires
   reworking the existing tweens to target the base var. More invasive to existing code.

Recommend option 1 (scene-local `SprintSway` child) — leaves the proven swap/reload tweens
untouched and isolates the new layer. Per-weapon calibration then lives on each `SprintSway` node's
rest transform.

## Starting @export values (tune in-editor)

```
sprint_pose_pos   ≈ Vector3( 0.18, -0.15,  0.05)   # lower + to the side
sprint_pose_rot   ≈ Vector3(-12.0,  8.0, -18.0)    # degrees; roll (-Z) dominant
sway_roll_deg     ≈ 8.0    # dominant arm-swing term
sway_vert_freq    = 2x the roll freq
enter_lerp        = 8.0
exit_lerp         = 12.0
interrupt_lerp    = 20.0   # on fire / ADS
```

Sine phase advances ALWAYS; amplitude = weight × velocity_factor. Reset phase only on sprint ENTER.
Per-weapon pose differs (pistol / rifle / melee origins) — calibrate each.

## Alternative sprint feel (from salvage)

A lighter approach some FPS kits use: **camera-holder tilt + FOV** — a roll lerp on the camera
holder from side input plus a per-state FOV bump (e.g. a higher Run FOV) — rather than a view-model
swing. It is not a view-model technique; note it as the cheaper alternative when a full view-model
swing is more than the game needs.

## Already-skilled check

Confirm whether an existing first-person-controller skill already covers view-model sprint pose/sway
before building. Flat sprint (speed mult), crouch, and sprint FOV-kick commonly live there already,
while view-model sprint pose/sway is often the real gap.

## Next step on approve

(Optionally extend the first-person-controller skill with a "Sprint view-model feel" section) →
game-designer scopes the ~40–50 LOC slice (SprintSway child + relay seam + head-bob reconciliation)
→ godot-dev implements in the weapon script (+ controller relay, player forward) → godot-verify.
