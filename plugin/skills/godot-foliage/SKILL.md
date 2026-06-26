---
name: godot-foliage
agents: [godot-visuals]
description: Build animated billboard foliage (grass, vegetation) for a TOP-DOWN / ORTHOGRAPHIC 3D pixel-art Godot 4.x project — dense MultiMeshInstance3D blades that face the orthographic camera via camera-BASIS billboard, optional noise-driven wind sway, and an optional low-framerate "handdrawn" TIME-quantized look. Use when adding grass/foliage to an orthographic/top-down game, when blades render flat or edge-on under an orthographic camera, when grass casts unwanted ground shadows, when all blades sway or snap in unison, or when choosing alpha-scissor vs alpha-blend. NOT for first-person/third-person PERSPECTIVE games — the camera-BASIS billboard + fake-perspective UV assume an orthographic camera (no vanishing point); a perspective camera needs real look_at-style billboarding this skill does not cover.
---

# Godot Pixel-Art Foliage

Billboard grass/foliage for the **orthographic / top-down** 3D pixel-art SubViewport pipeline,
built in up to three layers that stack on the same shader. Read the reference file for the
layer you need — they build on each other in order.

> **Scope: orthographic / top-down only.** The billboard technique (camera-BASIS, fake-perspective
> UV) assumes an orthographic camera with no vanishing point. In a first-person/third-person
> **perspective** game it renders wrong (edge-on / mis-scaled) — that needs real look_at-style
> perspective billboarding, which this skill does NOT cover. (Sibling paradigm split, like
> `godot-orthographic-follow-camera` vs `godot-first-person-controller`.)

## Prerequisites (flat skills — load via the Skill tool)

- `godot-3d-pixelation` — foliage renders inside the SubViewport (nearest filter, AA off).
- `godot-pixel-lighting` — blades are `unshaded` by design; they do not receive sun shadows.
- `godot-code-rules` — strict typed GDScript, load before writing the GrassField script.
- `godot-verify` — run after any `.tscn`/`.gd` change.

## Layers (read one level deep, in order)

1. **Base rig — [reference/billboard.md](reference/billboard.md)**: dense `MultiMeshInstance3D`
   QuadMesh blades, camera-BASIS billboard (orthographic-safe), alpha-scissor, shadow casting
   off, fake-perspective UV. **Start here.**
2. **Wind sway — [reference/wind.md](reference/wind.md)**: noise-driven vertex sway layered onto
   the base shader's `vertex()`; per-instance phase so blades sway independently.
3. **Handdrawn look — [reference/quantization.md](reference/quantization.md)**: quantize `TIME`
   so animation snaps to a low framerate (the choppy pixel-art look). Also applies to any
   TIME-driven shader (water, cloth, outline wobble).

## Non-negotiable rules (every layer)

- **Billboard via camera BASIS**, never `look_at` — orthographic cameras have no vanishing point.
- **Always alpha-scissor**, never alpha-blend, for foliage in the pixel-art SubViewport.
- **Disable shadow casting** on the `MultiMeshInstance3D`.
- **Per-instance phase** (from world XZ) on any animation, or the whole field moves in unison.
- Foliage shaders live in `shaders/material/`, not `shaders/post/` (that folder is screen-space only).
