---
name: godot-texture-import
agents: [asset-advisor]
domain: godot-core
description: The aesthetic-NEUTRAL mechanics of importing a texture and binding it in Godot 4 — the `.import` sidecar structure (which keys are art-dependent vs fixed), the `texture_filter` enum trap (1 NEAREST / 3 NEAREST_WITH_MIPMAPS / 5 LINEAR_WITH_MIPMAPS), tiling a surface (Texture Repeat + `uv1_scale` sized to the face in metres), and the Make-Unique gotcha on imported mesh materials. This is the base BOTH art styles layer on: it does NOT pick the filter/mipmap/compression VALUES or wire a PBR material — that delta belongs to the style skill (godot-texture-import-pixel-art for NEAREST/no-mipmap pixel-art, godot-hd-material-import for LINEAR+mipmaps PBR). Use whenever a PNG lands in assets/textures/ and must be imported and bound, a surface stretches/smears a single image, or an imported mesh material is greyed-out. NOT for the filter/compression choice itself (style delta), NOT for .glb mesh import (godot-mesh-import).
---

# godot-texture-import — texture import mechanics (art-neutral base)

Importing a texture and wiring it onto a surface has a shared, aesthetic-neutral mechanism: the `.import` sidecar overrides Godot's defaults, the `texture_filter` enum has a look-alike trap, box UVs stretch a single image across a whole face unless you tile, and an imported mesh's materials are shared resources until Made Unique. This skill owns those mechanics. It does **not** choose the filter/mipmap/compression **values** or author a material — the **style delta** does: `godot-texture-import-pixel-art` (NEAREST, no mipmaps, lossless, `filter_nearest` shader hint) or `godot-hd-material-import` (LINEAR + mipmaps, sRGB/non-color colour space, full PBR). Neither style owns the other; both import this base.

## Requirements

- The consuming shader (`shaders/material/<name>.gdshader`) or material must already declare the texture uniform/slot before you wire it.
- `godot-verify` — run after wiring to confirm no visual regression.
- The **style delta** the game uses (`godot-texture-import-pixel-art` or `godot-hd-material-import`) for the concrete filter/mipmap/compression values.

## Project conventions

- Textures live at `assets/textures/<name>.png` (snake_case). Never place PNGs directly in `assets/` — the convention is `assets/textures/`.
- `assets/` is gitignored — PNGs and `.import` sidecars are not versioned. Godot regenerates sidecars on first open. (An HD game commits per-texture `.import` sidecars for its sourced finals — see `godot-hd-material-import`.)

## Steps

**1. Write the `.import` sidecar (structure)**

For every `assets/textures/<name>.png`, a `assets/textures/<name>.png.import` sidecar is the authoritative override — it takes effect on the next import and survives editor restarts. The sidecar's shape is fixed; the art style sets a handful of key **values**:

- **Art-dependent (the style delta sets these):** `compress/mode` (0 lossless for pixel-art vs VRAM-compressed for HD), `mipmaps/generate` (false for pixel-art vs true for HD), and the sampler `filter` — see Step 2.
- **Fixed regardless of style:** `detect_3d/compress_to=0` (prevents auto-conversion to a 3D texture format), and the `process/*` block.

Godot fills in `uid` and `dest_files` on the first import — leave them blank; Godot overwrites with real values. For the concrete pixel-art sidecar block, see `godot-texture-import-pixel-art`; for the HD import table (per-map colour space + compression), see `godot-hd-material-import`.

**2. The `texture_filter` enum trap**

`texture_filter` on a `StandardMaterial3D` (or the shader sampler hint) selects the filter. The trap is the look-alike middle value:

```
texture_filter = 1   # NEAREST                — crisp, no mip chain
texture_filter = 3   # NEAREST_WITH_MIPMAPS   — LOOKS like NEAREST to write, but blurs/scratches at distance
texture_filter = 5   # LINEAR_WITH_MIPMAPS    — smooth + mipmapped
```

Which value is correct is the **style delta's** call (pixel-art → 1; HD → 5). This base only names the enum and its trap; never default it here.

**3. Tiling a surface texture (walls, floors, large faces)**

Default `BoxMesh` / `PlaneMesh` UVs map one full 0–1 copy of the image onto _each_ face. A single non-tiling image is therefore stretched edge-to-edge across the whole face — a 3 m wall and a 0.7 m box show the same texels, and a small image smears. This is the "3D texture looks stretched" failure. For a surface that should _repeat_:

- Enable **Texture Repeat** (StandardMaterial3D → Sampling) — without it the texture clamps at the edge instead of tiling.
- Set **`uv1_scale`** proportional to the face size in metres so texel density is consistent across props (e.g. a 3 m wall at 1 tile/m → `uv1_scale = Vector3(3, 3, 1)`).
- The texture must be **seamless/tileable** and **opaque** — alpha on a surface texture makes the face render cut-out/transparent.

A sprite-sized PNG is correct on a billboard or as one tile, wrong wrapped over a whole prop. A discrete prop (furniture, item) is a **sourced `.glb` model**, not a texture on a box — see `godot-mesh-import`.

**4. Make-Unique on imported mesh materials**

When a mesh is imported (e.g. a `.glb` tree), its surface materials are shared resources. Clicking a material in the editor shows it greyed out — you cannot edit it. Fix:

1. Select the `MeshInstance3D` in the editor.
2. In the Inspector → Mesh → right-click → **Make Unique**.
3. Then expand Surface 0 → Material → right-click → **Make Unique**.

After this, `texture_filter` and other properties are editable and owned by the scene.

**5. Verify**

```bash
tools/validate.sh
```

Then F5 and inspect the surface in the game's own rig. Whether "correct" means crisp texels (pixel-art) or clean grazing-angle detail (HD) is the style delta's checklist.

## Verification checklist

- [ ] `.import` sidecar exists on disk with the fixed keys (`detect_3d/compress_to=0`); style-dependent keys set per the game's delta
- [ ] Texture reloaded in editor (no import errors in Output panel)
- [ ] `texture_filter` set to the value the style delta specifies (1 pixel / 5 HD — never 3 by accident)
- [ ] A tiling surface uses Texture Repeat + `uv1_scale` sized to the face; texture is seamless + opaque
- [ ] Imported mesh material Made Unique before editing
- [ ] `tools/validate.sh` passes

## Error → Fix

| Symptom                                                              | Fix                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Texture blurry when the style wanted crisp                           | `texture_filter = 3` (NEAREST_WITH_MIPMAPS) written by mistake — set the value the style delta specifies (Step 2)                                             |
| Image stretched / smeared across a whole face (wrong size, not blur) | Default box UVs put one 0–1 copy per face — enable Texture Repeat + set `uv1_scale` to tile (Step 3). A whole prop wants a `.glb` model (`godot-mesh-import`) |
| Material greyed out in Inspector                                     | Step 4 — Make Unique on mesh, then on surface material                                                                                                        |
| Surface renders cut-out / transparent                                | Alpha on an opaque surface texture — flatten to opaque (Step 3)                                                                                               |
| Import sidecar has no `uid` / Godot re-imports every run             | Normal on first import; Godot fills in `uid` and `dest_files` automatically                                                                                   |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
