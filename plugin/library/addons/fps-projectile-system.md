# FPS Projectile & Weapon Firing System

**Request** — Before building A3 (projectile spawn → move → despawn, Area3D hit detection, fire-rate Timer) from scratch, evaluate whether a free Godot 4 addon already covers it and can be adopted.
**Verdict** — rejected — build it ourselves (skill-researcher: `godot-projectile`)

**Candidates**
| Addon | Source | License | Godot | Language | Last activity | Notes |
|---|---|---|---|---|---|---|
| Godot Simple FPS Weapon System | https://github.com/Jeh3no/Godot-simple-FPS-weapon-system | MIT | 4.4–4.6 explicit | GDScript | 2026-05-26 | Hitscan + projectile + fire rate + ammo + reload + recoil. Large integrated framework. |
| GodotParadise ProjectileComponent | https://github.com/BananaHolograma/ProjectileComponent | MIT | 4.1 | GDScript | 2023-10-31 | 2D only (`extends Node2D`, `Vector2`). Eliminated immediately. |

**Why** — The Jeh3no addon is MIT, GDScript, and actively maintained on Godot 4.6, but it is a tightly coupled game template, not a composable component. Its `shoot_managers_script.gd` queries `get_window().content_scale_mode` to resolve viewport size for the aim raycast — this mismatches a game's SubViewport render resolution whenever one is in use. Its `viewport_camera_script.gd` inserts a second Viewport to render weapon models separately, conflicting with a SubViewport pixelation rig if the game has one. Type annotations are partial (e.g. `var type = types.NULL`, untyped `Array`, `Dictionary` missing typed value parameter), which fails `validate.sh` strict-typed GDScript. Adoption cost (ripping out the weapon/ammo/animation/HUD managers, rewriting the viewport size query, fixing all type annotations) exceeds writing a clean 50-line component. The fps-survivor-arena-gdquest transcript (points 5–6) already documents the exact pattern we need: `preload` bullet scene, `instantiate()` at a `Marker3D` muzzle, copy `global_transform`, set `top_level = true`, move with `-transform.basis.z * speed * delta`, `queue_free()` past max range, and a one-shot `Timer.is_stopped()` fire-rate gate. This is a skill, not an addon.

**Install** — n/a

**Later** — Jeh3no repo is worth revisiting if we ever need ammo economy, weapon switching, or recoil; the architecture is well-commented and the fire-rate + hitscan patterns are reusable as reference code even without adopting the addon.
