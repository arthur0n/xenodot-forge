---
name: godot-pixel-lighting
agents: [godot-visuals, art-director]
description: Pixel-readability-first lighting for the 3D pixel-art blockout — one DirectionalLight3D "sun" with hard shadows, Sky/Color ambient fill, Filmic tonemap + fixed exposure on the SubViewport Environment. Use when lighting or re-tuning a level, when a ground shadow or jump landing isn't readable, when the scene renders black or blows out highlights, when shadows show acne/peter-panning/distance pop, or before touching the WorldEnvironment tonemap/exposure. Deliberately hard shadows over soft, Filmic over ACES/AgX.
---

# Godot Pixel Lighting (sun + ambient + Filmic tonemap, hard shadows)

Light the graybox for **pixel readability first**, not photoreal mood. The SubViewport renders at a low resolution and is upscaled nearest-neighbor (AA off), so the image is a crisp pixel grid. Soft/filtered shadow penumbra and auto-exposure both fight that grid: a blurred shadow edge smears across the pixels, and a moving exposure makes the same surface change brightness frame to frame. So the rig is deliberately minimal and _fixed_ — one sun casting a hard-ish shadow that reads under the player, a sky/color ambient that fills the dark side without flattening the depth cue, and a Filmic tonemap with a pinned exposure so highlights never clip to white. That is the whole blockout rig; three-point lighting (key/fill/rim), point lights, and atmosphere are per-level theming for later, not part of this gate.

## Requirements

These must already be applied before this skill makes sense:

- **godot-3d-pixelation** — the 3D content, the `DirectionalLight3D`, and the `WorldEnvironment` all live _inside_ the SubViewport rig. The Environment you tune here is the SubViewport's Environment; tonemap/exposure set anywhere else does not affect the pixelated image. AA stays off and the upscale stays nearest-neighbor.
- **godot-verify** — every `.tscn`/`.gd` change is proven with the 3-layer checks (`tools/verify_scene.gd` + `tools/verify_render.gd`). In particular an `Environment` with `background_mode = 2` (Sky) MUST reference a real `Sky` resource, or the property is silently dropped and the scene renders black (see godot-verify "Hand-authoring .tscn rules").

## Project conventions

- **Renderer**: Forward+, reversed-Z, Godot 4.3+ (see CLAUDE.md). GDScript-only — no C#.
- **Where lighting lives**: inside the level scene, `levels/<name>.tscn`. The rig this skill tunes is three nodes:
  - `DirectionalLight3D` at `rotation_degrees = Vector3(-45, -30, 0)`, `shadow_enabled = true` — the sun, fixed angle for a long readable shadow.
  - `WorldEnvironment` holding an `Environment` with `background_mode = 2` (Sky), a `ProceduralSkyMaterial` Sky, and `ambient_light_source = 3` (Sky). That `ambient_light_source = 3` is the Sky-ambient fill this skill explains.
- **Shadows are HARD by deliberate choice.** Do not enable `shadow_blur` / soft-shadow filtering — penumbra smears across the nearest-neighbor pixel grid and the crisp look is lost. Tune readability with bias, not blur.
- **Tonemap is Filmic with a fixed exposure.** ACES, AgX, auto-exposure, and SSAO are **out of scope for pixel readability**: auto-exposure makes the same surface change brightness frame to frame (fighting the fixed pixel grid), and ACES/AgX are photoreal tonemappers whose extra machinery buys nothing at low resolution — AgX is also 4.6-only while we target 4.3+. Filmic is the deliberate choice for "no blown highlights" without that machinery.
- **You (this skill) do not edit the scene.** Adopting this skill produces guidance; the actual `.tscn`/property edits are godot-dev's job, verified by godot-verify.

## Steps

One canonical path. All values can be authored as `.tscn` properties on the SubViewport's Environment / the DirectionalLight3D, or set from GDScript in the level's `_ready()`. The `.tscn` form is preferred (author the rig once into the level scene); the GDScript form is shown for clarity and for runtime day/night swaps.

### 1. The sun — one DirectionalLight3D

A single directional light is the whole key light for a graybox. Fixed angle gives a long, directional shadow that reads as a depth cue.

```gdscript
sun.rotation_degrees = Vector3(-45, -30, 0)  # fixed angle, long shadow
sun.light_color = Color(1.0, 0.95, 0.9)      # faintly warm sun
sun.light_energy = 1.0
sun.shadow_enabled = true
```

`.tscn` equivalent on the `DirectionalLight3D` node: `rotation_degrees = Vector3(-45, -30, 0)`, `shadow_enabled = true`.

### 2. Hard, readable shadow — tune bias, never blur

The shadow under the player must be a crisp dark patch, not a soft smear and not striped/detached. Prefer `shadow_normal_bias` over `shadow_bias`; keep `directional_shadow_max_distance` small so the shadow stays sharp at the player.

```gdscript
sun.shadow_normal_bias = 1.0   # primary acne knob; raise if stripes appear
sun.shadow_bias = 0.05         # keep low; high values cause peter-panning
sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
sun.directional_shadow_max_distance = 50.0  # lower = sharper near the player
# Do NOT set shadow_blur — soft penumbra fights the pixel grid.
```

Tuning order: start at `shadow_normal_bias = 1.0`. Stripes (acne) on lit surfaces → raise `shadow_normal_bias`. Shadow detached from the player's feet (peter-panning) → lower `shadow_bias` (and rely on normal bias). Shadow fades/pops as you walk → lower `directional_shadow_max_distance` toward 50m.

### 3. Ambient fill — Sky (or Color) as the depth cue

Ambient light fills the shadowed side so it stays readable, without washing the scene flat. `ambient_light_source = Sky` (`= 3`) reuses the procedural sky as cheap real-time fill. Balance it: enough fill to read the dark side of a box, not so much that the sun's shadow disappears.

```gdscript
var env: Environment = world_environment.environment
env.background_mode = Environment.BG_SKY        # = 2; REQUIRES a real Sky resource
env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY  # = 3
env.ambient_light_energy = 1.0   # lower toward ~0.5 if shadows look flat/washed out
```

If a level has no sky, use `AMBIENT_SOURCE_COLOR` with a mid `ambient_light_color` instead — same balance rule.

### 4. Filmic tonemap + fixed exposure — no blown highlights

On the **same** SubViewport Environment, set a Filmic tonemap and pin the exposure so bright surfaces (lit floor, light-colored boxes) don't clip to pure white.

```gdscript
env.tonemap_mode = Environment.TONE_MAPPER_FILMIC  # = 3
env.tonemap_exposure = 1.0   # fixed; lower (~0.8) if highlights still blow out
# Out of scope for pixel readability: TONE_MAPPER_ACES, TONE_MAPPER_AGX, auto-exposure, SSAO.
```

`.tscn` equivalent on the `Environment` sub-resource: `tonemap_mode = 3` (Filmic), `tonemap_exposure = 1.0`. Note: AgX is 4.6-only; we target 4.3+, so Filmic is the deliberate choice, not a fallback we are forced into.

## Verification checklist

Run via F5 (full game through `main.tscn`) or F6 (the level scene directly), and through godot-verify's `tools/verify_render.gd` (the scene's own camera/lights — the editor viewport is NOT verification):

- The scene renders (not black): sky visible, geometry lit.
- A **sun shadow is visible under the player capsule** — a distinct dark patch on the floor, cast by the capsule.
- The shadow edge is **crisp/hard**, aligned to the pixel grid — no soft penumbra smear.
- **The jump landing is readable**: as the player jumps and lands, the ground shadow moves and contracts so you can tell where it touches down.
- **No white blowout**: lit floor and light-colored boxes keep visible surface tone; no flat pure-white regions.
- The shadowed (dark) side of boxes is still readable (ambient fill working), but the sun's shadow has not vanished into the ambient (fill not overdone).

## Error → Fix

| Symptom                                                | Fix                                                                                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scene is completely black                              | No light, no camera in the SubViewport, or `background_mode = 2` (Sky) without a real `Sky` resource (silently dropped). Add the `DirectionalLight3D` + a Sky resource; confirm camera is inside the SubViewport. |
| Geometry dark despite the sun                          | Ambient missing. Set `ambient_light_source = Sky` (=3) or `Color`; raise `ambient_light_energy` toward 1.0.                                                                                                       |
| Shadow acne — stripes on lit surfaces                  | `shadow_normal_bias` too low. Raise it (start 1.0, increase). Prefer it over `shadow_bias`.                                                                                                                       |
| Peter-panning — shadow detached from the player's feet | `shadow_bias` too high. Lower it (~0.05) and rely on `shadow_normal_bias`.                                                                                                                                        |
| Shadow pops in/out or fades as you walk                | `directional_shadow_max_distance` too high. Lower toward 50m; sharpness improves as range shrinks.                                                                                                                |
| Highlights blown to pure white                         | Exposure/tonemap. Set `tonemap_mode = Filmic`; lower `tonemap_exposure` (~0.8). Do NOT reach for ACES/AgX/auto-exposure (out of scope).                                                                           |
| Shadow looks soft/smeared, pixels blurred at its edge  | `shadow_blur` is set (or soft-shadow filtering enabled). Remove it — hard shadows only in this pipeline.                                                                                                          |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
