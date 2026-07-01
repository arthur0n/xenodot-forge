# FPS Weapon System

**Request** — Evaluate Jeh3no "Godot Simple FPS Weapon System" as adopt/fix-in-place vs reject/build-custom for an FPS POC (Godot 4.6). Verdict revisited after an integration experiment on a throwaway branch.

**Verdict** — rejected — build it ourselves

**Candidates**
| Addon | Source | License | Godot | Language | Last activity | Notes |
|---|---|---|---|---|---|---|
| Godot Simple FPS Weapon System | [GitHub](https://github.com/Jeh3no/Godot-simple-FPS-weapon-system) / [Asset Library #4105](https://godotengine.org/asset-library/asset/4105) | MIT (Jeh3no 2024) | 4.4–4.6 explicit | 98% GDScript | ~2026-05 | Maintainer: "demo for a possible future asset." 86★/16 forks, no triage. |

**Why** — Three compounding problems make fix-in-place more expensive than build:

1. **Legacy viewmodel arch.** Addon uses SubViewport + layer-20 cull mask for weapon-clip prevention. Godot 4.6 `BaseMaterial3D.use_z_clip_scale` is the native solution (~0 LOC). Adopting the addon's SubViewport viewmodel rig means carrying that dead architecture indefinitely — and in a game that already runs its own SubViewport pixelation rig, wiring the addon's second viewport is a hack (`viewport_camera_script.gd` collapses to a transform-proxy).

2. **Unbridged projectile seam.** Hitscan path bridges to `on_hit()` via `hitscan_hit()` on the enemy body (working). Projectile path calls `body.projectile_hit()` — no bridge exists, not compatible with the framework's `on_hit()`/`died` enemy contract (`godot-fps-enemy-combat`). Fixing requires either modifying addon internals or polluting the enemy script with a second hit method.

3. **Bundled player SM conflicts with conventions.** Addon ships `player_character_script.gd` + `InputManagementComponent` (full state machine, 14 input actions). The framework's `godot-first-person-controller` skill owns the player controller. Stripping the player layer from the addon is effectively a rewrite.

Build cost is low: hitscan ~40–80 LOC (`PhysicsDirectSpaceState3D.intersect_ray`), recoil/bob/sway ~50 LOC, `WeaponResource` + `WeaponManager` ammo/reload/fire-gate ~100 LOC. Existing skills `godot-travelling-projectile-3d` and `godot-fps-enemy-combat` cover projectile strategy and hit contract. `use_z_clip_scale` eliminates the viewmodel-clip problem entirely.

**Input assertion note** — `assert(false)` in `input_management_component_script.gd:131` fires only if an exported `StringName` action is `""` (not a missing action). Missing actions are auto-added to InputMap at runtime with defaults. Not a hard crash risk.

**Salvage from experiment branch**

- `pistol_weapon_resource.tres` — field shape template for custom `WeaponResource`
- Bullet decal asset (`Weapons/Scenes/bullet_decal_scene.tscn` + texture) — reuse as-is
- Recoil impulse+tween pattern (`camera_recoil_holder_script.gd`) — extractable ~30 LOC
- Drop: addon controller, InputManagementComponent, ViewportCamera, player state machine

**Build task** — route to game-designer: scope minimal custom weapon system (~150–250 LOC total):
`WeaponResource` (typed resource) → `WeaponViewModel` (use_z_clip_scale) → `FiringStrategy` (hitscan + projectile via existing skills) → `WeaponManager` (ammo/reload/swap/fire-gate). Keep `pistol_weapon_resource.tres` as structural template. Drop addon code/controller/input layer.

**Later**

- If a more mature FPS weapon addon appears (maintained, no bundled player SM, Godot 4.6+ native clip), revisit. Candidates to watch: none identified at evaluation time.
- `godot-fps-weapon` skill should be created to document the custom build contract (WeaponResource fields, FiringStrategy interface, seam with godot-fps-enemy-combat).
