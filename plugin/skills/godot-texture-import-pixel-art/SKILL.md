---
name: godot-texture-import-pixel-art
agents: [godot-assets, asset-advisor]
domain: style-pixel
description: Correctly import pixel-art textures in Godot 4 — NEAREST filter, no mipmaps, uncompressed. Use whenever a PNG/texture is added to assets/textures/ and bound to a material or shader uniform. Also covers the Make-Unique gotcha on imported mesh materials and the texture_filter enum trap.
---

Pixel-art textures must arrive at the GPU raw and unscaled. Godot's defaults (bilinear filter, mipmap generation, lossy compression) destroy crisp texels. The `.import` sidecar is the authoritative override — it takes effect on the next import and survives editor restarts. The shader uniform hint `filter_nearest` is a second layer that prevents the sampler from ignoring the material setting.

## Requirements

- `godot-3d-pixelation` — SubViewport rig must exist; texture filter bugs are invisible at full res but obvious at low res.
- The consuming shader (`shaders/material/<name>.gdshader`) must already declare the texture uniform before you wire it.
- `godot-verify` — run after wiring to confirm no visual regression.

## Project conventions

- Textures live at `assets/textures/<name>.png` (snake_case). Never place PNGs directly in `assets/` — the convention is `assets/textures/`.
- ShaderMaterial uniforms use the `filter_nearest` hint (see Step 2). StandardMaterial3D albedo_texture uses `texture_filter = 1` (see Step 3).
- `assets/` is gitignored — PNGs and `.import` sidecars are not versioned. Godot regenerates sidecars on first open. Do not add sidecar commit steps.

## Steps

**1. Write the `.import` sidecar**

For every `assets/textures/<name>.png`, create `assets/textures/<name>.png.import`:

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

Key lines:

- `mipmaps/generate=false` — no mip chain → no blurring at distance
- `compress/mode=0` — lossless (mode 0 = Lossless, not VRAM-compressed)
- `detect_3d/compress_to=0` — prevents auto-conversion to a 3D texture format

Godot fills in `uid` and `dest_files` on the first import. Leave them as shown; Godot will overwrite with real values.

**2. Add `filter_nearest` hint to shader uniforms**

In `shaders/material/<name>.gdshader`, declare every texture uniform with the hint:

```glsl
uniform sampler2D blade_texture : hint_default_transparent, filter_nearest;
```

Without `filter_nearest`, the sampler may still apply bilinear filtering regardless of the material's `texture_filter` property.

**3. Set `texture_filter = 1` on StandardMaterial3D nodes**

When binding a texture to a `StandardMaterial3D` (e.g. ground albedo), set `texture_filter` to `1` (NEAREST) in the `.tscn`. The trap: `texture_filter = 3` is `NEAREST_WITH_MIPMAPS` — looks similar to write but blurs/scratches at distance.

```
[sub_resource type="StandardMaterial3D" id="..."]
texture_filter = 1       # 1 = NEAREST (correct)
                         # 3 = NEAREST_WITH_MIPMAPS (wrong — still generates a mip chain)
albedo_texture = ExtResource("...")
```

**3b. Tiling a surface texture (walls, floors, large faces)**

Default `BoxMesh` / `PlaneMesh` UVs map one full 0–1 copy of the image onto _each_ face. A single non-tiling image is therefore stretched edge-to-edge across the whole face — a 3 m wall and a 0.7 m box show the same texels, and a small image smears. This is the "3D pixel art looks horrendous" failure when a sprite-sized PNG is wrapped on a primitive. For a surface that should _repeat_:

- Enable **Texture Repeat** (StandardMaterial3D → Sampling) — without it the texture clamps at the edge instead of tiling.
- Set **`uv1_scale`** proportional to the face size in metres so texel density is consistent across props (e.g. a 3 m wall at 1 tile/m → `uv1_scale = Vector3(3, 3, 1)`; Godot's own fix for a plain box's stretched default UVs is `uv1_scale = Vector3(3, 2, 1)`).
- The texture must be **seamless/tileable** and **opaque** — alpha on a surface texture makes the face render cut-out/transparent.

A 32×32 PNG is sprite-sized: correct on a billboard (`godot-foliage`) or as one tile, wrong wrapped over a whole prop. A discrete prop (furniture, item) is a **sourced `.glb` model**, not a texture on a box — see `godot-mesh-import-pixel-art`. (The pixel-art _look_ itself comes from the SubViewport downscale, not the texture or the camera — see `godot-3d-pixelation`.)

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

Then F5 and inspect at pixel scale (zoom in editor or use the SubViewport output): crisp texel edges with no blurring = correct. Any blur = filter or mipmap still active.

## Verification checklist

- [ ] `.import` sidecar exists on disk with `mipmaps/generate=false` and `compress/mode=0` (not committed — `assets/` is gitignored)
- [ ] Texture reloaded in editor (no import errors in Output panel)
- [ ] Shader uniform has `filter_nearest` hint
- [ ] StandardMaterial3D node has `texture_filter = 1` (not 3)
- [ ] F5 shows crisp pixel-art edges at SubViewport scale
- [ ] `tools/validate.sh` passes

## Error → Fix

| Symptom                                                              | Fix                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Texture looks blurry / smeared in scene                              | Check `texture_filter` in `.tscn` — must be `1`, not `3`                                                                                                     |
| Texture looks scratched / moire pattern                              | `mipmaps/generate=true` in `.import` — set to `false`, re-import                                                                                             |
| Image stretched / smeared across a whole face (wrong size, not blur) | Default box UVs put one 0–1 copy per face — enable Texture Repeat + set `uv1_scale` to tile (step 3b). A whole prop wants a `.glb` model, not a box texture. |
| Material greyed out in Inspector                                     | See Step 4: Make Unique on mesh, then on surface material                                                                                                    |
| Import sidecar has no `uid` / Godot re-imports every run             | Normal on first import; Godot fills in `uid` and `dest_files` automatically — no commit needed (`assets/` is gitignored)                                     |
| Shader still blurring despite `filter_nearest` hint                  | Check the `.import` sidecar: `compress/mode=0` required; some compress modes ignore sampler hints                                                            |
| Texture invisible after wiring                                       | Check `use_texture` boolean uniform is `true`; check the PNG path matches `res://assets/textures/<name>.png` exactly                                         |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
