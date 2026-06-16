---
name: godot-procedural-model
description: Generate local placeholder low-poly .glb MODELS procedurally by kitbashing primitives (box/cylinder/cone) and exporting via GLTFDocument, using the reusable headless tool tools/gen_models.gd. Use when the prototype needs discrete props (furniture, items) fast and locally — no web catalogues, no AI, no Blender — so a scene reads as a whole. Blocky low-poly programmer-art; real/final props still go through the asset-advisor sourcing loop (catalogues / AI is parked).
---

Fast, fully-local placeholder 3D props for the prototype: assemble simple primitives into a composite mesh and export `.glb` with Godot's built-in glTF exporter. No external service, no API key, no Python/Blender, reproducible. This is the _placeholder_ path; real props still flow through the asset-sourcing loop (`asset-advisor`, catalogue `library/sources/model-sources.md` — Poly Pizza / Kenney / Quaternius). Sibling of `godot-procedural-texture` (surfaces) — this one is discrete props.

## The tool

`tools/gen_models.gd` — a headless `@tool extends SceneTree` script. For each prop it builds a `Node3D` with one `MeshInstance3D` per part (flat `StandardMaterial3D` albedo via `material_override`), then exports `res://assets/models/<name>.glb` with `GLTFDocument.append_from_scene()` + `write_to_filesystem()`. Output dir is ensured via `DirAccess.make_dir_recursive_absolute` first.

## Run

```bash
$GODOT --headless --path . --script tools/gen_models.gd   # writes assets/models/<name>.glb
$GODOT --headless --path . --import                        # Godot auto-generates the .glb.import
```

`assets/` is gitignored — `.glb` files are not committed; re-run to regenerate. No hand-written import sidecar needed (unlike textures — Godot's default `.glb` import is fine).

## Add a prop (the reuse path)

- **Specs live in a sibling file (default structure).** Keep prop specs in `tools/gen_models_props.gd` (a `class_name GenModelsProps` with a static `get_props()` returning the `_props` array); `gen_models.gd` holds only the build/export logic and calls `GenModelsProps.get_props()`. Specs grow with every prop — separating them from the generator keeps `gen_models.gd` under the 500-line cap (skill `godot-code-rules`) by construction, instead of forcing a reactive split the moment one prop's spec pushes it over.

Append one entry to the `_props` array (in `gen_models_props.gd`) and re-run. Schema:

```gdscript
{ "name": String, "parts": Array[Dictionary] }
# each part:
{ "shape": String ("box"|"cylinder"|"cone"), "size": Vector3, "pos": Vector3, "color": Color }
```

- `size`: box → full extents; cylinder/cone → `x` = diameter, `y` = height, `z` ignored.
- `pos`: centre offset in metres from the prop origin (build the prop standing on `y=0`).
- Reuse the shared palette consts (`WOOD_DARK`/`WOOD_MID`/`WOOD_LIGHT`/`METAL_GREY`/`SHADE_CREAM`) or add your own.
- `_props` is a `var`, not a `const`: `Vector3()`/`Color()` aren't constant expressions in GDScript.
- New primitive kind = one `match` case in `_make_mesh` (returns a `Mesh`; unknown → `push_error` + null).

## Gotchas

- **Poly count**: `CylinderMesh` (used for both `cylinder` and `cone`) tessellates to far more verts than boxes — the lamp `.glb` is ~15× a box prop. Fine for placeholders; lower `radial_segments` on the cylinder/cone in `_make_mesh` if size matters.
- **Strict typed GDScript** (skill `godot-code-rules`): specs/parts hold heterogeneous Variants, so reads use `@warning_ignore("unsafe_cast")` + a `# SEAM:` note. Don't name a local `root` (shadows `SceneTree.root`) — use `scene_root`. Keep lines ≤100 chars.
- **Materials over glTF**: flat `albedo_color` round-trips; Godot-specific sampler settings (e.g. `texture_filter` NEAREST) do not — set those after import via Make-Unique (skill `godot-mesh-import-pixel-art`, Step 4) if you later texture a prop.

## Wire it in

A generated `.glb` is a discrete prop: instance it in place of the greybox `BoxMesh` node, per skill `godot-mesh-import-pixel-art`. Instance it under a `StaticBody3D` holder with a per-prop `BoxShape3D` collider sized to its mesh AABB — **props get collision by default** (skill `godot-gridmap-level` step 3), so the player can't walk through furniture. Don't wrap a surface texture on a whole prop (that's the surface path — `godot-procedural-texture` / `godot-texture-import-pixel-art`).

## Verify

```bash
tools/validate.sh
```

Then confirm `--import` reports no errors and each `.glb` loads (`load("res://assets/models/<name>.glb")` instantiates as a `PackedScene`).
