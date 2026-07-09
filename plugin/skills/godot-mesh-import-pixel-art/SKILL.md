---
name: godot-mesh-import-pixel-art
agents: [godot-assets, asset-advisor]
domain: style-pixel
description: The PIXEL-ART surface delta for a sourced low-poly .glb prop in Godot 4 — layered on the neutral godot-mesh-import base, which owns place/import, scale, nested-instance, greybox swap, auto-collision and Make-Unique. This skill adds ONLY the pixel look: NEAREST texture filter on the model's material (and only if it carries a texture — flat/vertex-coloured props skip it), judged through the SubViewport downscale. Use whenever a low-poly / pixel-art .glb replaces a greybox box in a pixel-art game, or an imported pixel prop renders blurry. For the structural import mechanics see godot-mesh-import; for the HD/PBR surface see godot-mesh-import-hd; for tiling a wall texture see godot-texture-import-pixel-art.
---

Discrete pixel-art prop = **sourced low-poly `.glb` instanced in place of a greybox box** (per `godot-mesh-import`). The pixel look comes from the SubViewport downscale + orthographic camera — a clean low-poly mesh reads as pixel art at low res. Judge the result in F5, not the editor viewport. This skill is the **pixel-art delta**: it changes only the base's Step-2 surface material to NEAREST; every other structural step comes from `godot-mesh-import` unchanged.

## Requirements

- `godot-mesh-import` — the structural base. Follow ALL of its Steps (place/import, Advanced-Import, Make-Unique, near-uniform scale, nested-instance, 1:1 greybox swap + auto-collision, verify) unchanged. This skill overrides only the surface material applied at its **Step 2**.
- `godot-3d-pixelation` — the SubViewport rig must exist; filter bugs are invisible at full res, obvious at low res.
- `godot-texture-import-pixel-art` — authority on the NEAREST `.import` sidecar + the `texture_filter` enum trap; extracted textures import under it.
- `godot-verify` — mandatory 3-layer check after wiring.

## Step 2 delta — NEAREST filter (replaces the base's Step-2 material seam)

Run `godot-mesh-import` Step 2 to Make the mesh + surface material Unique, then apply the pixel filter:

- **Only if the model has a pixel/painted texture.** Flat / vertex-coloured models have no texture — skip this entirely, the base's structural steps are all they need.
- If the textured model renders blurry: set `texture_filter = 1` (NEAREST). The `= 3` (`NEAREST_WITH_MIPMAPS`) trap applies here too — see `godot-texture-import` Step 2.

Everything else — scale, nesting, greybox swap, collision, the nested-GLB `set_surface_override_material` gotcha, verify — is `godot-mesh-import` verbatim.

## Verification checklist

- [ ] Structural steps followed from `godot-mesh-import` (scale near-uniform, base on floor, name+position kept, nested instance, collider Made Unique)
- [ ] If textured: surface material Made Unique, `texture_filter = 1` (not 3); if flat/vertex-coloured: no texture step
- [ ] F5: prop is crisp/blocky at SubViewport scale (not blurry, not a flat box)
- [ ] `tools/validate.sh` passes; `verify_scene.gd` prints `VERIFY: OK`

## Error → Fix

| Symptom                          | Fix                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Texture blurry                   | Make Unique surface material, `texture_filter = 1` (not 3)                   |
| Prop giant/speck/floats/crushed  | Structural — `godot-mesh-import` Step 3 (near-uniform scale, base to y 0)    |
| Editing one collider changed all | Structural — Make Unique the shape (`godot-mesh-import` Step 5)              |
| Re-import doesn't change prop    | Made-local — must be nested instance (`godot-mesh-import` Step 4)            |
| Model black / unlit              | No albedo — Make Unique, set albedo, confirm scene sun (`godot-mesh-import`) |

---

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
