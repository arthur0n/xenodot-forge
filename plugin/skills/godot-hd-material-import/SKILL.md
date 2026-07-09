---
name: godot-hd-material-import
agents: [asset-advisor, godot-assets]
domain: style-hd
description: The HD-PBR import delta for a SOURCED HD texture set in Godot 4.6 Forward+ — layered on the neutral godot-texture-import base (sidecar structure, texture_filter enum, tiling, Make-Unique). This skill sets the HD VALUES and wires a full-PBR StandardMaterial3D / ORMMaterial3D: LINEAR filter + mipmaps ON, sRGB albedo / non-color (linear) for every other map, normal-map invert-Y when DirectX-style, ORM channel-pack when occlusion/roughness/metallic ship packed, and a stylized-middle bias (roughness high, metal low, normals mild) so the muted-industrial palette stays dominant and combat stays readable. Use when a sourced HD texture (a wall/floor/surface or a prop's own maps) arrives in assets/textures/ and needs a real PBR material — "PBR material", "HD texture import", "wire albedo/normal/roughness/metallic/AO", "ORM packed texture", "tileable HD wall/floor texture", "uv1_scale tiling", "material shades inside-out / too glossy / shimmers at distance", "non-color vs sRGB map". NOT the shared mechanics themselves (godot-texture-import), NOT the pixel-art sibling delta (godot-texture-import-pixel-art, which owns the NEAREST/no-mipmap values and survives for gen_textures placeholder output), NOT .glb mesh/collider import (godot-mesh-import + godot-mesh-import-hd), NOT the greybox→asset replace flow (godot-greybox-to-asset).
---

# HD PBR material / texture import (godot-hd-material-import)

A first-person camera stands right next to walls at grazing angles, so HD surfaces import with
**LINEAR filter + mipmaps ON** (NEAREST aliases HD detail and crawls; missing mipmaps shimmer on
oblique/distant surfaces). Sourced assets ship real PBR maps — wiring a full `StandardMaterial3D`
(or `ORMMaterial3D` when packed) keeps lighting consistent across assets instead of discarding work.
The look is **stylized-middle**, NOT photoreal and NOT flat-toon: push roughness high, metallic low,
normals mild, and dial sourced albedo toward the nearest `ArtStyle` swatch, so the muted-industrial
palette reads over gloss and combat readability never loses to a shiny surface. This skill is the **HD
delta** on `godot-texture-import`: that base owns the shared mechanics (the `.import` sidecar structure,
the `texture_filter` enum, surface tiling, Make-Unique); here we set the HD values (LINEAR + mipmaps,
per-map colour space) and author the PBR material. Its **pixel-art sibling delta**,
`godot-texture-import-pixel-art`, owns the NEAREST/no-mipmap values + the UI/sprite path and survives for
`gen_textures` placeholder output — an equal sibling, not this skill's base.

## Requirements

- `godot-texture-import` — the mechanics base (sidecar structure, `texture_filter` enum, tiling, Make-Unique); this skill fills in the HD values + PBR authoring.
- `godot-code-rules` applied (strict typed GDScript; `tools/validate.sh` gate).
- The art-direction call in `design/art-direction.md` (stylized-PBR, linear/mipmaps, ORM, invert-Y).
- Engine: Godot 4.6, Forward+ renderer; `godot-pixel-lighting` rig (Filmic + fixed exposure) live.
- `tools/art_style.gd` (`ArtStyle`) palette swatches — sourced albedo maps to the nearest family.

## Project conventions

- Sourced textures live in `assets/textures/<name>.png` (`assets/` is gitignored). A model's own
  maps still go there. Shared example textures resolve at `res://x-shared-assets/textures/<name>.png`.
- Commit the per-texture `.import` sidecar; never `.godot/imported/`.
- One density family across surfaces — `TEXEL_DENSITY` (`ArtStyle`) is now a FLOOR, not a ceiling;
  match scales across walls/floors via `uv1_scale`.
- Material is **opaque** (surfaces, not glass). Author it as a saved `.tres` so it is reusable.
- Map sourced albedo to a swatch family: concrete → `CONCRETE_*`, steel → `STEEL_*`, rust →
  `RUST_*`, wood → `WOOD_*`, wall → `WALL_PLASTER_*`. Stay within `SATURATION_CEILING = 0.50`,
  value `[0.16, 0.90]`.

## Steps

### 1. Import each texture with the right color space + filter

Per-texture in the Import dock, then **Reimport**. The color space is the trap — a roughness/metal/
normal/AO map read as sRGB shades wrong; only albedo and emission are sRGB.

| Map                 | Compress Mode   | Mipmaps | Filter | Color space (sRGB vs non-color)                     |
| ------------------- | --------------- | ------- | ------ | --------------------------------------------------- |
| albedo (base color) | VRAM Compressed | On      | Linear | **sRGB**                                            |
| emission            | VRAM Compressed | On      | Linear | **sRGB**                                            |
| normal              | VRAM Compressed | On      | Linear | **non-color (linear)** — set "Normal Map" = Enabled |
| roughness           | VRAM Compressed | On      | Linear | **non-color (linear)**                              |
| metallic            | VRAM Compressed | On      | Linear | **non-color (linear)**                              |
| AO / ORM pack       | VRAM Compressed | On      | Linear | **non-color (linear)**                              |

If a map ships **DirectX-style** (green channel inverted — surfaces light "inside-out"), invert-Y on
import (Normal Map → Flip Y, or invert the green channel before import). A "smooth" map is inverted
roughness — invert it to roughness before import.

### 2. Build the PBR material in code, save as `.tres`

Author once, save, reuse. `ORMMaterial3D` when occlusion+roughness+metallic ship packed into one
texture (R=AO, G=roughness, B=metallic); plain `StandardMaterial3D` when they are separate maps.

```gdscript
# tools/gen_hd_material.gd — headless authoring helper (run via $GODOT --headless --script)
# Produces a saved .tres PBR material from a sourced HD texture set.
extends SceneTree

func _build_standard(albedo_path: String, normal_path: String, rough_path: String,
		metal_path: String, ao_path: String) -> StandardMaterial3D:
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_texture = load(albedo_path) as Texture2D
	mat.normal_enabled = true
	mat.normal_texture = load(normal_path) as Texture2D
	mat.normal_scale = 0.6                      # mild normals (stylized bias)
	mat.roughness_texture = load(rough_path) as Texture2D
	mat.metallic_texture = load(metal_path) as Texture2D
	mat.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	mat.ao_enabled = true
	mat.ao_texture = load(ao_path) as Texture2D
	mat.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	_apply_stylized_bias(mat)
	return mat

func _build_orm(albedo_path: String, normal_path: String, orm_path: String) -> ORMMaterial3D:
	var mat: ORMMaterial3D = ORMMaterial3D.new()
	mat.albedo_texture = load(albedo_path) as Texture2D
	mat.normal_enabled = true
	mat.normal_texture = load(normal_path) as Texture2D
	mat.normal_scale = 0.6
	mat.orm_texture = load(orm_path) as Texture2D    # R=AO, G=roughness, B=metallic
	_apply_stylized_bias(mat)
	return mat

func _apply_stylized_bias(mat: BaseMaterial3D) -> void:
	# Scalars MULTIPLY their textures: bias roughness up, metal down, opaque surface.
	mat.roughness = 1.0                              # high roughness — kill gloss
	mat.metallic = 0.0                               # low metal — let the map add it back sparingly
	mat.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	# Tiling on a large surface — match one density family across walls/floors:
	mat.uv1_scale = Vector3(4.0, 4.0, 1.0)           # tune per surface; keep scale consistent

func _init() -> void:
	var out: String = "res://assets/materials/wall_concrete.tres"
	var mat: StandardMaterial3D = _build_standard(
		"res://assets/textures/wall_concrete_albedo.png",
		"res://assets/textures/wall_concrete_normal.png",
		"res://assets/textures/wall_concrete_rough.png",
		"res://assets/textures/wall_concrete_metal.png",
		"res://assets/textures/wall_concrete_ao.png")
	var err: int = ResourceSaver.save(mat, out)
	assert(err == OK, "save failed: %d" % err)
	print("saved ", out)
	quit()
```

### 3. Assign the `.tres` and tune tiling

Assign the saved material to the surface mesh's `material_override` (or to a `MeshInstance3D` in the
level scene). For a large wall/floor, `uv1_scale` controls texel density — raise it until the texture
reads at the same density as neighbouring surfaces (one density family). For a per-instance tweak,
`.duplicate()` the material first so you don't mutate the shared `.tres`.

### 4. Verify in a windowed run

Headless validate.sh confirms load/parse only — the look needs the editor. Launch the level (F6) and
check the surface under the live lighting rig.

## Verification checklist

- [ ] Surface reads in the muted-industrial palette under Filmic + fixed exposure — not glossy, not
      muddy. (If muddy, tune `ambient_light_energy` in `godot-pixel-lighting`, NOT the swatches.)
- [ ] Normal map lights correctly — bumps cast in the right direction, not "inside-out". (Inside-out
      ⇒ invert-Y the normal map on import.)
- [ ] No shimmer/crawl on the surface at a grazing angle or at distance (mipmaps + LINEAR working).
- [ ] Tiled wall/floor texel density matches neighbouring surfaces (consistent `uv1_scale` family).
- [ ] Roughness reads high / metal low — no unintended chrome; combat targets stay readable against it.
- [ ] Material is opaque (casts shadow, no transparency artefacts).
- [ ] `.import` sidecars committed; `.godot/imported/` gitignored.

## Error → Fix

| Symptom                                              | Fix                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Surface lights "inside-out" / bumps wrong direction  | Normal map is DirectX-style — invert-Y (Flip Y / invert green) on import + reimport                              |
| Roughness/metal map shades wrong (too bright/flat)   | Map imported as sRGB — set color space to **non-color (linear)** + reimport                                      |
| Surface shimmers/crawls at distance or grazing angle | Mipmaps OFF or filter NEAREST — set Mipmaps→On + Filter→Linear + reimport                                        |
| Surface too glossy / breaks the palette              | Stylized bias not applied — `roughness=1.0`, `metallic=0.0`, dial albedo toward the `ArtStyle` swatch            |
| Tiled texture too big/small vs neighbours            | Tune `uv1_scale` to the shared density family                                                                    |
| ORM map reads wrong channels                         | Use `ORMMaterial3D` (expects R=AO, G=roughness, B=metallic); don't wire an ORM pack into separate Standard slots |
| Editing one mesh's material changes others           | `.duplicate()` the material before per-instance mutation                                                         |
| Import settings lost after reclone                   | `.import` files weren't committed — commit them; only `.godot/` is gitignored                                    |

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
