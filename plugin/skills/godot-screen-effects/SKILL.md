---
name: godot-screen-effects
agents: [godot-visuals]
domain: godot-core
description: Build screen-space post-process effects in a Godot 4.x 3D project — the fullscreen-quad rig plus reading the screen/depth/normal buffers in a spatial shader, the foundation for outlines, edge detection, fog, and depth visualization. Use when adding a custom post-process effect, when a post-process shader only covers a small square, before sampling hint_depth_texture / hint_normal_roughness_texture / hint_screen_texture, or when depth reads all-white/all-black or normals look wrong.
---

# Godot Screen-Space Effects

Two layers, read in order. Layer 1 builds the quad that runs a spatial shader over every
screen pixel; layer 2 adds the uniforms and decode helpers for the screen/depth/normal
buffers. Every outline/edge/fog effect is a `fragment()` body written on top of these two.

## Prerequisites

- Godot **4.3+** (reversed-Z depth; both layers assume it — see each file's Error table for 4.0–4.2).
- An active `Camera3D`. With the SubViewport pixel-art setup (`godot-3d-pixelation`, load via the
  Skill tool), the camera and the quad live **inside the SubViewport**, so the effect runs before
  upscaling — the correct order for pixel-art outlines.
- `hint_normal_roughness_texture` exists **only in Forward+**. Any plan needing normals must state
  "Forward+ required," not write code that silently reads garbage.

## Layers (read one level deep, in order)

1. **Quad rig — [reference/postprocess-quad.md](reference/postprocess-quad.md)**: a `QuadMesh` on a
   `MeshInstance3D` child of the camera with a spatial shader that snaps to the full screen. Produces
   a working magenta stub. **Start here** — one fullscreen quad per camera, never stack them.
2. **Buffer access — [reference/screen-textures.md](reference/screen-textures.md)**: the canonical
   `screen_texture` / `depth_texture` / `normal_texture` uniforms and `get_linear_depth()` /
   `get_normal()` helpers (with per-renderer depth linearization and normal decoding). Edit only the
   shader's `fragment()` body; later effects replace that body.

## Non-negotiable rules

- One fullscreen quad per camera; stacking multiplies fragment cost and breaks depth reads.
- Post-process shaders live in `shaders/post/`; spatial/material shaders (grass, toon) do not.
- Use `filter_nearest` on screen-space samplers in the pixel-art pipeline — smoothing reintroduces
  the blur the SubViewport removed.
- Always linearize depth (per renderer) before using it; raw depth reads as uniform white/black.
