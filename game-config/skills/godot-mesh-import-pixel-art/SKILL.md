---
name: godot-mesh-import-pixel-art
description: Import, scale and wire a SOURCED low-poly / pixel-art .glb model in Godot 4 as a discrete prop — the primary path for furniture/items, instanced in place of a greybox box (NOT a texture wrapped on a primitive). Use whenever a .glb arrives in assets/models/ from the asset-sourcing loop, when a prop must stop being a flat greybox box, when an imported model renders blurry / wrong-sized / black, or when deciding how to swap a greybox node for a real model. Also use for the glTF Advanced-Import workflow (skip a node, override vs extract a material, embedded textures, normal-map invert-Y), when deciding inherited-scene vs nested-instance vs make-local for an imported model, or when adding a collider to an imported mesh (auto-generate + Make-Unique). NOT for authoring a model (that is parked/Blender) and NOT for tiling a texture on a wall (that is godot-texture-import-pixel-art).
---

A discrete prop (furniture, item, set dressing) in this 3D-pixel-art project is a **sourced low-poly `.glb` model instanced in place of its greybox box** — never a single PNG wrapped on a `BoxMesh`. The pixel look comes from the SubViewport downscale + orthographic camera, so a clean low-poly mesh (flat-material, vertex-coloured, or lightly textured) already reads as pixel art once rendered low-res. This skill covers importing a `.glb` you _sourced_ (free, CC0/low-poly — see `library/sources/model-sources.md`); authoring one from scratch (Blender) is parked v2.

## Requirements

- `godot-3d-pixelation` — the SubViewport rig must exist; scale and filter bugs are invisible at full res, obvious at low res. Judge the result in F5, not the editor viewport.
- `godot-texture-import-pixel-art` — the authority on NEAREST filtering + the Make-Unique gotcha. This skill _reuses_ it; it does not restate the `.import`/sampler rules.
- `godot-verify` — mandatory 3-layer check after wiring.
- The greybox prop it replaces already exists as a named node (e.g. `Wardrobe` `MeshInstance3D`) at a **computed** position — the slice that placed the box made it a clean 1:1 swap target. Keep that node's name and transform.

## Project conventions

- The source model lives at `assets/models/<name>.glb` (snake_case, glTF-binary, self-contained). `.gltf` (text + external `.bin`/textures) is NOT supported via the single-file upload — convert/export to `.glb` first. Any textures the model carries still belong in `assets/textures/`. `assets/` is gitignored.
- A `.glb` imports as a **PackedScene** by default; instance that scene as the prop. Do not flatten it into the level by hand.
- Keep the **one build path** rule: if the greybox prop was placed by an author-time builder (`tools/build_shared_apartment*.gd`), extend that builder to instance the model — don't fork a second importer or hand-edit the `.tscn` in parallel.

## Steps

**1. Place + let Godot import**

Drop the file at `assets/models/<name>.glb`. On the next editor open (or headless import) Godot generates the import + a PackedScene. Confirm no import errors in the Output panel.

**1a. Advanced Import (only when the default import is wrong)**

Godot treats a `.glb` as a _scene_, not a single mesh. The basic Import dock covers Root Type / Root Name / Root Scale; the **Advanced Import Settings** window (double-click the `.glb` in FileSystem) covers per-node and per-material decisions. Open it only when the default import has a concrete defect — otherwise skip to step 2.

- **Skip a node** — a sourced model often ships extra nodes (a baked-in light, a camera, a duplicate LOD, a logo plane). Select it in the Advanced Import tree → **Skip Import** (or rename it with the `-noimp` suffix at source). We light scenes ourselves (`godot-pixel-lighting`) and frame them with the orthographic rig (`godot-camera-rig`), so **always skip any imported Light/Camera** — leaving them in fights our rig.
- **Material: override vs extract** — by default materials are embedded in the imported scene and can't be edited or shared. For each material node, **Storage = Built-In** keeps it embedded (fine for a one-off prop); **Storage = Files** _extracts_ it to a real `.tres` you can edit and reuse — extract when you need to set `texture_filter`, swap an albedo, or share the material across props. Extract to `resources/` (our material home), not next to the model.
- **Embedded vs external textures** — a `.glb` packs its textures inside the binary. If you extract a material and want the source PNG editable / NEAREST-filtered the project way, also extract the texture to `assets/textures/<name>.png`, then it imports under our pixel-art rules (`godot-texture-import-pixel-art`). A self-contained flat/vertex-coloured model needs none of this.
- **Normal map invert-Y** — if a model carries a normal map and lit surfaces look _inverted_ (bumps read as dents under the sun), the map uses the opposite green-channel convention (DirectX vs OpenGL). On that texture's import set **Normal Map = Flip Y** (or invert the green channel in an editor). Note: at our SubViewport downscale normal maps rarely earn their cost — prefer a flat material first; only chase this if a specific prop visibly needs the detail.

**2. Filtering — only if the model carries a painted/pixel texture**

Many CC0 low-poly models are flat-material or vertex-coloured — they have **no texture**, so there is nothing to filter; skip to step 3. If the model _does_ carry a pixel/painted texture and it looks blurry:

1. Instance the model, select the `MeshInstance3D`, Inspector → Mesh → right-click → **Make Unique**, then Surface 0 → Material → **Make Unique** (the gotcha — see `godot-texture-import-pixel-art` step 4).
2. Set the material `texture_filter = 1` (NEAREST — the `= 3` mipmap trap applies here too).

**3. Scale to footprint (the most common defect)**

Sourced models arrive at arbitrary units — a chair can import 0.1 m or 10 m tall. Scale it to the footprint the greybox box already defined:

- Read the greybox box `size` (the target footprint, in metres) and the model's AABB (`get_aabb()` on the mesh, or read the bounds in the editor).
- Set the **glTF import Root Scale** (Import dock), or the instanced node's `scale`, so the model's AABB matches the box footprint. Prefer one uniform scale (keep proportions); align the base, not the centre.
- Re-seat on the floor: floor top ≈ y 0, so the model's lowest point sits at y 0 (mesh pivots vary — offset the node, don't eyeball).

**4. Scene structure — instance, don't make-local (the re-import decision)**

The imported `.glb` is a read-only PackedScene; how you attach behavior/colliders to it decides whether you can re-import the source later. Three options, one canonical choice:

- **Make-local** — `Scene → Make Local` on the instance flattens the mesh data into your `.tscn`. You get full edit control, but you **lose the link to the source** (a re-import of an updated `.glb` won't reach it) and bloat the scene with mesh data. **Avoid** — it breaks the asset-sourcing loop's "re-source and re-import" path.
- **Inherited scene** — `New Inherited Scene` from the `.glb`, then add nodes. Re-import flows through, but it **couples your gameplay logic directly to the art file's root** — if the source's node structure changes on re-import, your overrides can break. Avoid for props with behavior.
- **Nested instance (canonical)** — instance the `.glb` PackedScene as a **child** of a node you own (the named greybox node, a `Node3D`/`StaticBody3D`, or an entity scene per `godot-composition`). Behavior and colliders live on _your_ node; the model is a swappable child. Re-import flows straight through, and re-sourcing the prop is a one-child swap. This is the same "engine-node base + children" shape as our composition convention — the model is the visual child.

So: the greybox node you own stays the parent; the model PackedScene becomes its child. Never make-local a sourced prop.

**5. Swap the greybox node 1:1**

Replace the named greybox node's _content_, not its identity:

- Keep the node **name** (`Wardrobe`) and **position** (the computed transform from the prop slice) so nothing else in the scene shifts.
- Make the named node the owner (a `Node3D`, or `StaticBody3D` if it needs collision) and **nest** an instance of `<name>.glb` (the PackedScene) under it at the local origin, scaled per step 3 (step 4). One model per greybox box.
- Collision (when gameplay needs it — furniture blocking is parked until a slice asks for it). Two paths:
  - **Source suffix** — if you control the source export, name the collider mesh with a suffix and Godot builds it on import: `-col` (static trimesh sibling), `-convcol` (convex), `-colonly` (collider, no visible mesh). Cheapest when the model already ships a collision proxy.
  - **In-engine auto-generate** — select the imported `MeshInstance3D` → **Mesh → Create Collision Shape** (single convex for a prop, or trimesh for a static concave shape) → it adds a `CollisionShape3D` under a body. Then **right-click the shape resource → Make Unique** (the gotcha — same as mesh materials: a shared `.glb` instance reuses one shape resource, so editing one edits all until made unique). Prefer a simple primitive (`BoxShape3D`/`CapsuleShape3D`) over a generated trimesh for anything the player collides with — trimesh is static-only and expensive. See `design/collision-shapes.md`.

**6. Verify**

```bash
tools/validate.sh                      # if you touched a builder .gd
$GODOT --headless --path . --script tools/verify_scene.gd -- levels/<level>.tscn main.tscn
```

Then F5: the prop renders as the model (not a flat box), is the right size next to the player and other props, sits **on** the floor (no float/sink), and is crisp/blocky at SubViewport scale (no blur).

## Verification checklist

- [ ] `assets/models/<name>.glb` imported with no Output-panel errors
- [ ] Model scaled to the greybox footprint (not giant / not tiny); base on the floor
- [ ] Replaced node keeps its original **name** and **position**; nothing else moved
- [ ] If textured: surface material Made Unique with `texture_filter = 1` (not 3); if flat/vertex-coloured: no texture step needed
- [ ] Any imported Light/Camera was skipped (Advanced Import → Skip, or `-noimp`) — our rig owns lighting/framing
- [ ] Model is a **nested instance** under a node you own — NOT made-local, NOT an inherited scene (re-import still flows through)
- [ ] If a material/texture was extracted: material → `resources/`, texture → `assets/textures/`, imported under pixel-art rules
- [ ] If collision was added: shape resource Made Unique; a simple primitive for anything the player hits (trimesh only for static concave)
- [ ] One build path (builder extended, not a forked importer / parallel hand-edit)
- [ ] `tools/validate.sh` passes (if a builder changed); `verify_scene.gd` prints `VERIFY: OK`
- [ ] F5 shows the model crisp at SubViewport scale

## Error → Fix

| Symptom                                                      | Fix                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prop is a giant / a speck                                    | Step 3 — scale to the greybox box footprint via Root Scale or node `scale`                                                                                |
| Prop floats or sinks into the floor                          | Step 3 — align the model's lowest AABB point to y 0; offset the node for an off-centre pivot                                                              |
| Model texture looks blurry / smeared                         | Step 2 — Make Unique the surface material, set `texture_filter = 1` (not 3)                                                                               |
| Model renders black / unlit                                  | It has no material, or its material is unshaded with no albedo — Make Unique and set an albedo, or confirm the scene sun reaches it                       |
| Half the model is invisible / inside-out                     | Back-face culling on inverted normals — set the material cull mode to Disabled, or re-export the source double-sided                                      |
| `.gltf` upload rejected                                      | Only `.glb` (self-contained) is supported — re-export/convert to `.glb`                                                                                   |
| Editor shows the box AND the model                           | The greybox `MeshInstance3D` wasn't replaced — swap its content, keep the node name/position (step 5)                                                     |
| Scene has a stray light / camera / extra mesh from the model | Step 1a — open Advanced Import, Skip the node (or `-noimp` at source); our rig owns lighting/framing                                                      |
| Material can't be edited / won't take a NEAREST filter       | It's embedded — step 1a, Advanced Import → that material → Storage = Files to extract a `.tres` into `resources/`                                         |
| Lit surface looks inverted (bumps read as dents)             | Normal map uses the opposite Y convention — step 1a, set Normal Map = Flip Y on that texture (or drop the normal map; rarely needed at SubViewport scale) |
| Re-importing an updated `.glb` doesn't change the prop       | The prop was made-local — step 4, it must be a nested instance under your node, not flattened into the `.tscn`                                            |
| Editing one prop's collider changed every copy               | Shared shape resource — step 5, right-click the `CollisionShape3D` resource → Make Unique                                                                 |

---

The Advanced-Import workflow and the glTF import-name suffix table (`-col` / `-convcol` / `-colonly` / `-noimp`) are Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
