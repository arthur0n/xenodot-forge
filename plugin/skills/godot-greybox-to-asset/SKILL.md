---
name: godot-greybox-to-asset
agents: [godot-assets]
domain: godot-core
description: Migrate a finished greybox blockout to final sourced assets in Godot 4.6 — the REPLACE half of the blockout loop (godot-greybox BUILDS it; this skill RETIRES it). Identify every BoxMesh greybox node in a level `.tscn`, batch-source/verify the `.glb` models and tileable surface textures through the asset-advisor loop, swap each node 1:1 in place preserving its name + position + rotation + collision, validate, then delete the greybox nodes LAST (never first), re-bake the navmesh, and decorate after the walls land. Use for "replace the greybox", "swap blockout for real assets", "retire the placeholder boxes", "migrate the level to final art", "the level is greyboxed, make it look real", or when an arena full of flat BoxMesh cover must become sourced models/textures. Owns the migration ORDER + safety + shared-material building-set; DELEGATES the per-node swap to godot-mesh-import-pixel-art (props) / godot-texture-import-pixel-art (surfaces) and the sourcing to the asset-advisor loop. NOT a second importer, NOT CSG greyboxing, NOT inherited-scene or make-local swaps, NOT the original blockout build (that is godot-greybox).
---

# godot-greybox-to-asset — retire the blockout (migration craft)

A greybox is a deliberate placeholder; migration is the controlled REPLACE that turns it into final art
**without losing the spatial work**. The whole danger is regression — a swap that moves a wall, drops a
collider, breaks the navmesh, or deletes a placeholder before its replacement exists. So the governing
rule is **swap in place, validate, retire LAST**: every asset goes in keeping the greybox node's name +
`position` + `rotation` + collision, you validate the level still loads/renders/walks, and only THEN do
you delete the greybox nodes — never the other way round. This skill owns the ORDER and the SAFETY; it
does not re-implement importing — it orchestrates the skills that already do.

## Requirements

- `godot-greybox` — the level being migrated was built by it (BoxMesh cover, SpawnMarker3D, FallZone,
  baked NavigationRegion3D). This skill consumes that blockout; it does not author shape.
- `godot-mesh-import-pixel-art` — owns the per-node prop swap (scale near-uniform, nested `.glb`
  instance, collider, NEAREST/material). This skill calls it once per discrete prop/cover node.
- `godot-texture-import-pixel-art` — owns large flat surfaces (wall/floor/ground): a `StandardMaterial3D`
  with `uv1_scale` + Texture Repeat on the existing BoxMesh, NOT a model. This skill calls it per surface.
- asset-advisor classify/verify loop — sources + verifies the batch of `.glb` / textures BEFORE any swap.
- `godot-verify` — the load/render/smoke gate run AFTER swaps and AGAIN after the greybox deletion;
  also the `position`+`rotation` (never raw `Transform3D` literal) authoring contract is preserved.
- `godot-code-rules` — strict typed GDScript for any glue (there should be little; this is scene edits).

## Project conventions

- Migrate ONE level `.tscn` (`levels/<name>.tscn`) at a time; never batch across levels in one pass.
- Art-kind → technique (decide per greybox node BEFORE sourcing, from the CLAUDE.md table):
  - **discrete prop / cover piece / furniture** → sourced low-poly `.glb` (`assets/models/<name>.glb`),
    instanced in place of the BoxMesh node — `godot-mesh-import-pixel-art`.
  - **large flat surface** (perimeter wall, floor, ground) → tileable texture on the EXISTING BoxMesh
    via `StandardMaterial3D` + `uv1_scale` + Texture Repeat — `godot-texture-import-pixel-art`. Keep the
    box; re-skin it. Do NOT replace a wall with a wall-shaped model.
- **Preserve the spatial contract.** A swap keeps the greybox node's PascalCase name, `position`,
  `rotation`, and a collider of equivalent footprint. The level's spatial read — elevation, zoning,
  and (if it's a combat/arena encounter) the `godot-arena-spatial-design` principles
  (topology/cover/sightlines/verticality/landmarks) — must read IDENTICALLY after migration;
  migration is re-skinning, not re-shaping. If an asset is a different size, scale it to the cell, do
  not move the cell.
- **Shared-material building set.** Source wall/floor/structural pieces as a coherent set sharing ONE
  material/texture family so the arena reads as one place, not a kitbash — pick the set in the asset
  request, not piecemeal per node.
- **One build path.** If the greybox was placed by a builder (`tools/build_*.gd` / a GridMap), extend
  that builder's swap, do NOT fork a second importer.
- `assets/` is gitignored; models → `assets/models/`, textures → `assets/textures/` (snake_case).

## Steps

1. **Inventory the greybox.** Open `levels/<name>.tscn`. List every placeholder node: BoxMesh cover/
   props vs BoxMesh perimeter/floor surfaces. Tag each by technique (prop `.glb` vs surface texture).
   Leave SpawnMarker3D / FallZone / NavigationRegion3D / lights ALONE — they are systems, not art.
2. **Source + verify the batch (asset-advisor).** File one asset request for the whole set: the
   shared-material building pieces + the props + the surface textures. Let the asset-advisor classify/
   verify loop land verified `.glb`/PNG in `assets/`. Do NOT start swapping until the batch verifies.
   (No real asset yet? `tools/gen_models.gd` / `tools/gen_textures.gd` placeholders are fine to swap
   onto FIRST — they still de-box the scene — and re-swapped when sourced art arrives.)
3. **Swap each node IN PLACE — greybox stays until validated.** Per node, delegate the mechanics:
   - prop/cover → `godot-mesh-import-pixel-art` (nest the `.glb` under the owned node; keep name +
     `position` + `rotation`; scale near-uniform to the cell; unique collider sized to AABB).
   - surface → `godot-texture-import-pixel-art` (apply `StandardMaterial3D` + `uv1_scale` + Repeat to
     the EXISTING BoxMesh; keep the box).
     Do the swaps with the greybox content still present as a fallback — do NOT delete any greybox node yet.
4. **Validate the swapped scene.** `tools/validate.sh` then
   `$GODOT --headless --path . --script tools/verify_scene.gd -- levels/<name>.tscn main.tscn`.
   F5: every piece renders as its asset (no flat box, no box-AND-model double), right size, on the floor,
   colliders solid. The arena shape reads the same as the blockout.
5. **Retire the greybox LAST.** Only after step 4 is green: delete the now-redundant placeholder
   `MeshInstance3D`/holder nodes that were fully replaced (a re-skinned surface keeps its box — nothing
   to delete there). Re-run validate + verify_scene. (Optional editor convenience while iterating: lock
   - a transparent-magenta `surface_material_override` on a not-yet-swapped greybox so it reads as
     "TODO" — purely visual, not the mechanism.)
6. **Re-bake nav + decorate.** Re-bake the `NavigationRegion3D` over the final geometry (new colliders
   may shift the walkable area). THEN add non-blocking decoration (set-dressing props, detail) — last,
   after the walls land, so it never blocks the structural migration.
7. Hand off to godot-verify for the final gate.

## Verification checklist

- [ ] Every greybox node inventoried and tagged prop-`.glb` vs surface-texture before sourcing
- [ ] Batch sourced + verified by asset-advisor (or local gen placeholders) BEFORE swapping
- [ ] Each swapped node keeps its original **name + position + rotation**
- [ ] Props are **nested `.glb` instances** (not make-local, not inherited scene) with a unique collider
- [ ] Surfaces re-skin the EXISTING BoxMesh (texture + `uv1_scale` + Repeat) — box kept, not replaced
- [ ] Wall/floor/structural pieces share ONE material family (reads as one place)
- [ ] Greybox placeholder nodes deleted **only after** the swapped scene passed validate + verify_scene
- [ ] No box-AND-model doubles; no floating/sunk/crushed props
- [ ] Arena's spatial read (cover, sightlines, verticality, landmarks) unchanged vs the blockout
- [ ] `NavigationRegion3D` re-baked over final geometry; enemies still path
- [ ] No raw `Transform3D` literals introduced (godot-verify)
- [ ] One build path (builder extended, not forked); decoration added LAST
- [ ] `tools/validate.sh` passes; `verify_scene.gd` prints `VERIFY: OK`

## Error → Fix

| Symptom                                         | Fix                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Box AND model both visible                      | Greybox `MeshInstance3D` content not replaced — swap content keeping name/position; delete the box only in step 5                            |
| A wall moved / cover shifted after swap         | Asset scaled the cell instead of fitting it — re-seat to the greybox `position`/`rotation`; scale the asset to the cell, never move the cell |
| Placeholder deleted, replacement missing        | Greybox retired before validation — restore from VCS; ALWAYS swap+validate, delete LAST (step 5)                                             |
| Enemies stop pathing / walk through new walls   | Navmesh stale — re-bake `NavigationRegion3D` over final geometry (step 6)                                                                    |
| Wall replaced by a wall-shaped model, looks off | Large flat surface should be a texture on the BoxMesh, not a model — use godot-texture-import-pixel-art                                      |
| Arena reads as a kitbash                        | Structural pieces don't share a material — re-source the building set with ONE shared material family                                        |
| Second importer / build script appeared         | Fork — extend the existing builder/swap, one build path                                                                                      |
| Prop giant/speck/floating/crushed               | Per-node scale/seat issue — see godot-mesh-import-pixel-art Error→Fix (near-uniform Root Scale, AABB to y0)                                  |
| Build fails godot-verify Transform3D ban        | Author swaps via `position`+`rotation`, never a `Transform3D` literal                                                                        |

---

For a Resource-driven arena assembled at RUNTIME, see `godot-runtime-arena` (not this). The per-node
import mechanics live in `godot-mesh-import-pixel-art` / `godot-texture-import-pixel-art`; sourcing lives
in the asset-advisor loop — this skill only orchestrates the migration order + safety over them.

Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.
