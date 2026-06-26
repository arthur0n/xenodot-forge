---
name: godot-mesh-import-pixel-art
agents: [godot-assets, asset-advisor]
description: Import, scale and wire a SOURCED low-poly / pixel-art .glb model in Godot 4 as a discrete prop — the primary path for furniture/items, instanced in place of a greybox box (NOT a texture wrapped on a primitive). Use whenever a .glb arrives in assets/models/ from the asset-sourcing loop, when a prop must stop being a flat greybox box, when an imported model renders blurry / wrong-sized / black, or when deciding how to swap a greybox node for a real model. Also use for the glTF Advanced-Import workflow (skip a node, override vs extract a material, embedded textures, normal-map invert-Y), when deciding inherited-scene vs nested-instance vs make-local for an imported model, or when adding a collider to an imported mesh (auto-generate + Make-Unique). NOT for authoring a model (that is parked/Blender) and NOT for tiling a texture on a wall (that is godot-texture-import-pixel-art).
---

Discrete prop (furniture, item, set dressing) = **sourced low-poly `.glb` instanced in place of greybox box**. Pixel look comes from SubViewport downscale + orthographic camera — clean low-poly mesh reads as pixel art at low res. Judge the result in F5, not the editor viewport.

## Requirements

- `godot-3d-pixelation` — SubViewport rig must exist.
- `godot-texture-import-pixel-art` — authority on NEAREST filtering + Make-Unique gotcha; this skill reuses it.
- `godot-verify` — mandatory 3-layer check after wiring.
- Greybox node at a **computed** position (keep its name and transform).

## Project conventions

- Source at `assets/models/<name>.glb` (snake_case, glTF-binary, self-contained). `.gltf` not supported — convert to `.glb` first.
- `.glb` imports as **PackedScene**; instance it. Don't flatten by hand.
- **One build path:** if greybox was placed by a builder (`tools/build_*.gd`), extend that builder — don't fork a second importer.

## Steps

**1. Place + import**

Drop `assets/models/<name>.glb`. Confirm no import errors in Output panel.

**1a. Advanced Import (only when default import is wrong)**

Double-click `.glb` in FileSystem → Advanced Import Settings. Open only for concrete defects:

- **Skip a node** — skip imported lights/cameras (we own lighting/framing); use **Skip Import** or `-noimp` suffix.
- **Material override vs extract** — `Storage = Built-In` keeps embedded (fine for one-off); `Storage = Files` extracts to editable `.tres` in `resources/` (extract when sharing or setting `texture_filter`).
- **Embedded textures** — extract to `assets/textures/<name>.png` if NEAREST-filter needed; imports under pixel-art rules.
- **Normal map invert-Y** — if normals look inverted (bumps read as dents): set **Normal Map = Flip Y**. Rarely needed at SubViewport scale.

**2. Filtering (only if model has a pixel/painted texture)**

Flat/vertex-coloured models have no texture — skip to step 3. If blurry:

1. Instance model → select `MeshInstance3D` → Mesh → **Make Unique** → Surface 0 → Material → **Make Unique** (gotcha: shared `.glb` resource).
2. Set `texture_filter = 1` (NEAREST — `= 3` mipmap trap applies here too).

**3. Scale near-uniformly**

Sourced models arrive at arbitrary units. Scale to real-world size **near-uniformly** (one scalar all axes):

- Don't stretch per-axis to fill greybox cell footprint. A bed is ~0.5 m tall regardless of cell height. Per-axis stretching crushes/bloats props.
- Read model AABB → pick dominant dimension with known real size (e.g. single bed ≈ 1.9 m long) → apply that one factor via **glTF import Root Scale** or node `scale`. ±5% tolerance to seat against wall is fine.
- Re-seat: floor top ≈ y 0; model's lowest point sits at y 0.

**4. Scene structure — nested instance (canonical)**

Three options:

- **Make-local** — loses link to source; re-import won't reach it. **Avoid.**
- **Inherited scene** — couples logic to art file; breaks on re-import if node structure changes. **Avoid for props with behavior.**
- **Nested instance (canonical)** — instance `.glb` PackedScene as child of a node you own. Behavior + colliders on your node. Re-import flows through; re-sourcing = one-child swap.

The greybox node you own = parent; model PackedScene = child. Never make-local a sourced prop.

> **Recolouring a nested GLB's mesh from a PARENT (inherited or instanced) scene is NOT reliable by hand-authored `surface_material_override`** — the mesh node sits inside a nested instance, so Godot silently drops the override and emits "node was modified but has vanished" (fails the godot-verify smoke gate). Apply it from a small `_ready()` script via `set_surface_override_material(0, ...)` on the GLB mesh node(s). A design doc must NOT assume "no script" for tinting a nested-GLB entity.

**5. Swap greybox 1:1**

Keep node **name** (the greybox placeholder's) and **position** (computed transform). Make the named node the owner (`Node3D` or `StaticBody3D`). Nest the `.glb` instance at local origin scaled per step 3.

Collision — **props get a collider BY DEFAULT** (pipeline default, not parked):

- **Headless build-time** — make prop holder `StaticBody3D` + `CollisionShape3D` + unique `BoxShape3D` sized to AABB. Get AABB: instance model, walk `MeshInstance3D`s accumulating `Transform3D` from holder origin, enclose 8 corners. One unique shape per prop; centre box on `aabb.position + aabb.size/2`. Box, never trimesh.
- **Source suffix** — `-col` (static trimesh), `-convcol` (convex), `-colonly` (collider only, no mesh). Cheapest when model ships a collision proxy.
- **In-engine auto-generate** — select `MeshInstance3D` → **Mesh → Create Collision Shape** → **right-click shape resource → Make Unique** (gotcha: shared resource edits all copies). Prefer `BoxShape3D`/`CapsuleShape3D` over trimesh for player-collision props.

**6. Verify**

```bash
tools/validate.sh
$GODOT --headless --path . --script tools/verify_scene.gd -- levels/<level>.tscn main.tscn
```

F5: prop renders as model (not flat box), right size, sits on floor, crisp/blocky at SubViewport scale.

## Verification checklist

- [ ] `assets/models/<name>.glb` imported, no Output errors
- [ ] Scaled near-uniformly to real-world size (not per-axis to cell; not giant/tiny); base on floor
- [ ] Replaced node keeps original **name** and **position**
- [ ] If textured: surface material Made Unique, `texture_filter = 1`; if flat/vertex-coloured: no texture step
- [ ] Imported Light/Camera skipped (Advanced Import → Skip or `-noimp`)
- [ ] Model is **nested instance** under owned node — not made-local, not inherited scene
- [ ] If material/texture extracted: material → `resources/`, texture → `assets/textures/`
- [ ] If collision added: shape resource Made Unique; simple primitive for player-hit props
- [ ] One build path (builder extended, not forked)
- [ ] `tools/validate.sh` passes; `verify_scene.gd` prints `VERIFY: OK`
- [ ] F5: crisp at SubViewport scale

## Error → Fix

| Symptom                                                             | Fix                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prop giant / speck                                                  | Step 3 — near-uniform Root Scale from dominant dimension                                                                                                                                                                       |
| Prop floats / sinks                                                 | Step 3 — align model AABB lowest point to y 0                                                                                                                                                                                  |
| Prop crushed / bloated                                              | Step 3 — per-axis scale used; re-scale near-uniformly                                                                                                                                                                          |
| Texture blurry                                                      | Step 2 — Make Unique surface material, `texture_filter = 1`                                                                                                                                                                    |
| Model black / unlit                                                 | No material or unshaded no albedo — Make Unique, set albedo, confirm scene sun                                                                                                                                                 |
| Half model invisible / inside-out                                   | Inverted normals — material cull mode Disabled, or re-export double-sided                                                                                                                                                      |
| `.gltf` rejected                                                    | Convert to `.glb` (self-contained binary)                                                                                                                                                                                      |
| Box AND model visible                                               | Greybox `MeshInstance3D` not replaced — swap content, keep name/position                                                                                                                                                       |
| Stray light / camera / mesh from model                              | Step 1a — Advanced Import → Skip (or `-noimp`)                                                                                                                                                                                 |
| Material won't take NEAREST filter                                  | Embedded — Step 1a → Storage = Files → extract `.tres` to `resources/`                                                                                                                                                         |
| Lit surface inverted (bumps = dents)                                | Normal map Y convention — Step 1a → Normal Map = Flip Y                                                                                                                                                                        |
| Re-import doesn't change prop                                       | Prop was made-local — must be nested instance                                                                                                                                                                                  |
| Editing one collider changed all copies                             | Shared shape resource — right-click → Make Unique                                                                                                                                                                              |
| "node was modified but has vanished" on a `.tscn` material override | Mesh is a nested GLB inside an inherited/instanced scene — hand-authored `surface_material_override` is silently dropped. Recolour from a script: `_ready()` → `set_surface_override_material(0, mat)` on the GLB mesh node(s) |

---

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
