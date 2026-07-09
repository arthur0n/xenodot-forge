---
name: godot-3d-pixelation
agents: [godot-visuals, art-director]
domain: style-pixel
description: SubViewport-based low-resolution crisp rendering of a 3D scene in Godot 4.x — the foundation of the "3D pixel art" style. Use for pixelated/retro/PSX/low-res 3D, setting SubViewport render resolution, "crisp pixels", restructuring a scene tree so 3D renders below window resolution, or when a downscaled viewport looks blurry.
---

# Godot 3D Pixelation (SubViewport technique)

Render the 3D scene into a low-resolution `SubViewport`, then display that texture upscaled with nearest-neighbor filtering. The result is a 3D scene that looks like pixel art. This skill targets **Godot 4.x** (verified against 4.4). Do not apply Godot 3 advice (`ViewportContainer`, `usage` flags) — the node names and properties differ.

## Scene structure

The pixelated content must live _inside_ the SubViewport. Anything outside it renders at native resolution.

```
Root (Node or Node2D/Control)
└── SubViewportContainer
    └── SubViewport
        ├── Camera3D          ← the camera MUST be inside the SubViewport
        ├── DirectionalLight3D / WorldEnvironment
        └── ...all 3D content to be pixelated
```

Keep UI (HUD, menus) **outside** the SubViewport unless it should also be pixelated. Mixing crisp UI with pixelated 3D is a deliberate style choice — ask the user if it's ambiguous.

## Required settings

1. **SubViewportContainer**
   - Anchors: Full Rect (`set_anchors_preset(Control.PRESET_FULL_RECT)`), so it fills the window.
   - `stretch = true` — without this, the SubViewport keeps its own size and is not scaled by the container.
   - `stretch_shrink = N` — integer divisor of the window resolution. `4` on a 1920×1080 window gives a 480×270 internal render. This is the main "pixel size" knob.
   - **Texture filter** (CanvasItem → Texture → Filter): set to **Nearest**. This is the step people miss — with the default (inherited/linear) filtering the upscale is blurry, not pixelated.

2. **SubViewport** — defaults are fine when `stretch` is on; the container drives its size. For a _fixed_ internal resolution independent of window size (e.g. always 640×360), instead set the SubViewport's `size` explicitly and handle scaling yourself — but prefer `stretch_shrink` unless the user asks for resolution-independence.

3. **Disable anti-aliasing** for this viewport: MSAA, FXAA/screen-space AA, and TAA all blur pixel edges and defeat the effect. Check both project settings and per-viewport overrides.

## Verification checklist

After setup, confirm:

- Lowering `stretch_shrink` to 1 restores full resolution (proves the pipeline is wired through the SubViewport).
- Edges are hard-stepped, not smoothed (filter is actually Nearest — verify on the _container_, not the viewport).
- The camera renders at all — if the screen is black, the Camera3D was left outside the SubViewport.

## Known gotchas (not covered in most tutorials)

- **Input/picking**: `SubViewportContainer` forwards GUI input to the SubViewport, but 3D physics picking requires `physics_object_picking = true` on the SubViewport. Raycast-from-camera code must use the SubViewport's camera and the SubViewport-local mouse position, not the root viewport's.
- **stretch_shrink is integer-only.** Non-integer scale factors require the fixed-size-SubViewport approach.
- **Pixel crawl/shimmer** when the camera moves or rotates is inherent to this technique. Mitigations (snapping camera translation to texel grid for orthographic cameras) are an advanced topic — flag it, don't silently implement it.
- **Window scaling**: for clean results the window size should be an integer multiple of the internal resolution; otherwise uneven pixel sizes appear. Consider Project Settings → Display → Window → Stretch (mode `viewport`/`canvas_items`) for the outer scaling policy.
- **`get_viewport()` inside the SubViewport returns the SubViewport**, not the window. Code that assumed window dimensions (e.g. UI math, screen-space effects) will see the low-res size after this refactor.

## Scope boundary

This skill stops at pixelation. Edge-detection outlines (depth/normal post-process shader on a fullscreen quad) are a separate, more complex technique — a different skill. Do not bolt the outline shader onto this setup unless the user asks for it.
