---
name: godot-texture-import-pixel-art
agents: [godot-assets, asset-advisor]
domain: style-pixel
description: The PIXEL-ART import delta for a texture in Godot 4 — layered on the neutral godot-texture-import base, which owns the `.import` sidecar structure, the `texture_filter` enum trap, surface tiling and the Make-Unique gotcha. This skill sets ONLY the pixel VALUES: NEAREST filter, no mipmaps, uncompressed (lossless), plus the `filter_nearest` shader-uniform hint that stops a sampler ignoring the material setting. Use whenever a pixel-art PNG is added to assets/textures/ and bound to a material or shader uniform, or a pixel texture renders blurry/scratched. For the shared import mechanics see godot-texture-import; for the HD/PBR surface see godot-hd-material-import.
---

Pixel-art textures must arrive at the GPU raw and unscaled. Godot's defaults (bilinear filter, mipmap generation, lossy compression) destroy crisp texels. This skill is the **pixel-art delta** on `godot-texture-import`: the sidecar structure, the `texture_filter` enum trap, tiling, and Make-Unique all live in that base — here we set the concrete pixel **values** (NEAREST, no mipmaps, lossless) and the shader hint.

## Requirements

- `godot-texture-import` — the mechanics base (sidecar structure, `texture_filter` enum, tiling, Make-Unique). This skill only fills in the pixel values.
- `godot-3d-pixelation` — SubViewport rig must exist; texture filter bugs are invisible at full res but obvious at low res.
- The consuming shader (`shaders/material/<name>.gdshader`) must already declare the texture uniform before you wire it.
- `godot-verify` — run after wiring to confirm no visual regression.

## Pixel values

**1. The `.import` sidecar (pixel values)**

Following `godot-texture-import` Step 1, write `assets/textures/<name>.png.import` with the pixel key-values (`compress/mode=0`, `mipmaps/generate=false`):

```ini
[remap]
importer="texture"
type="CompressedTexture2D"
uid="uid://GODOT_WILL_FILL_THIS_IN"

[deps]
source_file="res://assets/textures/<name>.png"
dest_files=["res://.godot/imported/<name>.png-<hash>.ctex"]

[params]
compress/mode=0
compress/high_quality=false
compress/lossy_quality=0.7
compress/normal_map=0
compress/channel_pack=0
mipmaps/generate=false
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/fix_alpha_border=true
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
svg/scale=1.0
editor/scale_with_editor_scale=false
editor/convert_colors_with_editor_theme=false
```

The pixel key lines:

- `mipmaps/generate=false` — no mip chain → no blurring at distance
- `compress/mode=0` — lossless (mode 0 = Lossless, not VRAM-compressed)
- `detect_3d/compress_to=0` — the base's fixed key; prevents auto-conversion to a 3D texture format

**2. `filter_nearest` shader hint (pixel-only)**

In `shaders/material/<name>.gdshader`, declare every texture uniform with the hint:

```glsl
uniform sampler2D blade_texture : hint_default_transparent, filter_nearest;
```

Without `filter_nearest`, the sampler may still apply bilinear filtering regardless of the material's `texture_filter` property.

**3. `texture_filter = 1` (NEAREST) on StandardMaterial3D nodes**

Per the `godot-texture-import` Step-2 enum, the pixel value is **`1` (NEAREST)** — never `3` (`NEAREST_WITH_MIPMAPS`), which blurs/scratches at distance:

```
[sub_resource type="StandardMaterial3D" id="..."]
texture_filter = 1       # 1 = NEAREST (correct)
                         # 3 = NEAREST_WITH_MIPMAPS (wrong — still generates a mip chain)
albedo_texture = ExtResource("...")
```

**Tiling a pixel surface** uses the base's tiling mechanics (`godot-texture-import` Step 3: Texture Repeat + `uv1_scale` sized to the face, seamless + opaque). A 32×32 PNG is sprite-sized: correct on a billboard (`godot-foliage`) or as one tile, wrong wrapped over a whole prop. A discrete prop is a **sourced `.glb`** — see `godot-mesh-import`. (The pixel-art _look_ itself comes from the SubViewport downscale, not the texture or camera — see `godot-3d-pixelation`.)

## Verification checklist

- [ ] `.import` sidecar on disk with `mipmaps/generate=false` and `compress/mode=0` (not committed — `assets/` is gitignored)
- [ ] Texture reloaded in editor (no import errors in Output panel)
- [ ] Shader uniform has `filter_nearest` hint
- [ ] StandardMaterial3D node has `texture_filter = 1` (not 3)
- [ ] Imported mesh material Made Unique before editing (`godot-texture-import` Step 4)
- [ ] F5 shows crisp pixel-art edges at SubViewport scale
- [ ] `tools/validate.sh` passes

## Error → Fix

| Symptom                                             | Fix                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Texture looks blurry / smeared in scene             | Check `texture_filter` — must be `1`, not `3` (`godot-texture-import` Step 2)                                |
| Texture looks scratched / moire pattern             | `mipmaps/generate=true` in `.import` — set to `false`, re-import                                             |
| Material greyed out in Inspector                    | Make Unique on mesh, then surface material (`godot-texture-import` Step 4)                                   |
| Image stretched across a whole face                 | Default box UVs — tile it (`godot-texture-import` Step 3). A whole prop wants a `.glb` (`godot-mesh-import`) |
| Shader still blurring despite `filter_nearest` hint | Check the `.import`: `compress/mode=0` required; some compress modes ignore sampler hints                    |
| Texture invisible after wiring                      | Check `use_texture` uniform is `true`; check the PNG path matches `res://assets/textures/<name>.png` exactly |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
