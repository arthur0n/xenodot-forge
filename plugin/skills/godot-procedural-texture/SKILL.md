---
name: godot-procedural-texture
description: Generate local placeholder pixel-art SURFACE textures procedurally with the Godot Image API, via the reusable headless tool tools/gen_textures.gd. Use when the prototype needs tileable wall/floor/fabric textures fast and locally (no web generators, no human upload) so a scene reads as a whole. These are programmer-art placeholders — real/final art still goes through the asset-advisor sourcing loop.
---

Fast, fully-local, seamless-by-construction placeholder textures for the prototype. No external service, no upload step, reproducible (same seed → byte-identical PNG). This is the _placeholder_ path; real art still flows through the asset-sourcing loop (`asset-advisor`, `library/sources/asset-sources.md`). The local-AI route (Pixel Art Diffusion XL) stays parked.

## The tool

`tools/gen_textures.gd` — a headless `@tool extends SceneTree` script. It draws each texture into an `Image` (`FORMAT_RGBA8`), saves a PNG to `assets/textures/<name>.png`, and writes the matching pixel-art `.import` sidecar (the `IMPORT_TEMPLATE` const = `compress/mode=0`, `mipmaps/generate=false`, `detect_3d/compress_to=0`; see skill `godot-texture-import-pixel-art`).

## Run

```bash
$GODOT --headless --path . --script tools/gen_textures.gd   # writes PNGs + .import sidecars
$GODOT --headless --path . --import                          # Godot bakes the .ctex (fills uid/dest_files)
```

`assets/` is gitignored — PNGs and sidecars are not committed; re-run to regenerate.

## Add a texture (the reuse path)

- **Specs live in a sibling file (default structure).** Keep texture specs in `tools/gen_textures_specs.gd` (a `class_name GenTexturesSpecs` with a static `get_specs()` returning the `_specs` array); `gen_textures.gd` holds only the draw/save/import logic and calls `GenTexturesSpecs.get_specs()`. Specs grow with every texture — separating them from the generator keeps `gen_textures.gd` under the 500-line cap (skill `godot-code-rules`) by construction, instead of forcing a reactive split the moment one spec pushes it over.

Append one entry to the `_specs` array (in `gen_textures_specs.gd`) and re-run. Schema:

```gdscript
{ "name": String, "size": int (32), "kind": String, "seed": int, "palette": PackedColorArray }
```

`_specs` is a `var`, not a `const`: `PackedColorArray()`/`Color()` are not constant expressions in GDScript, so a `const` of palettes won't compile.

**Kinds** (each is a `_draw_<kind>` function — add a `match` case + function to introduce a new one):

- `planks` — horizontal plank bands + 1px mortar lines + faint grain (wood floor)
- `plaster` — flat base + low-amplitude noise quantized to palette shades (walls)
- `fabric` — 2px warp/weft weave from thread parity (cloth)
- `tiles` — cell grid + 1px grout + per-cell tint (tile floor)

## Invariants (keep these or textures break)

- **Seamless**: all randomness goes through `_periodic_hash(x, y, size, seed)`, which wraps `x`/`y` mod `size` _before_ hashing, so the value at `x` equals the value at `x+size`. Any repeating period (band/thread/cell) must divide `size` evenly. Never sample raw noise that isn't periodic.
- **Opaque**: pass every pixel through `_opaque()` — surface textures with alpha render cut-out/transparent on a face.
- **Pixel-art look**: `_quantize()` snaps to the palette so you get crisp bands, not smooth gradients.
- Strict typed GDScript (skill `godot-code-rules`); the spec Dictionary holds heterogeneous Variants, so reads use `@warning_ignore("unsafe_cast")` with a `# SEAM:` note.

## Wire onto a surface

A generated texture is a tileable surface texture — bind it per skill `godot-texture-import-pixel-art` Step 3b: `StandardMaterial3D` with `texture_filter = 1` (NEAREST), Texture Repeat on, `uv1_scale` sized to the face in metres. Do **not** wrap one on a whole discrete prop (that wants a `.glb` — skill `godot-mesh-import-pixel-art`).

## Verify

```bash
tools/validate.sh
```

Then confirm `--import` reports no errors and the on-disk `.import` files carry `mipmaps/generate=false` + `compress/mode=0`.
