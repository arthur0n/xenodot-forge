# Cyclops Level Builder

**Request** — evaluate the Cyclops Level Builder addon as a replacement for hand-typing Transform3D matrices when building 3D blockout levels (the hand-built path only; the draw-grid pipeline is separate).
**Verdict** — parked — runtime coupling is the blocker; revisit if/when a bake-to-static-body command ships

## Candidates

| Addon                 | Source                                           | License | Godot                                                                           | Language       | Last activity                                                                               | Notes                                |
| --------------------- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Cyclops Level Builder | https://github.com/blackears/cyclopsLevelBuilder | MIT     | 4.2+ (4.3 load failure open, issue #196; 4.5 naming collision open, issue #228) | GDScript 99.4% | Active — commits 2026-06-06; v1.0.4 last formal release Jun 2024; master tracks further dev | Editor plugin + custom runtime nodes |

## Why

Cyclops solves the real pain (drag-to-place blocks, auto collision, snapping) and is MIT/GDScript, so it clears the license and language gates. However it has two blockers for this project right now.

**Runtime coupling.** Levels built with Cyclops contain `CyclopsBlock` / `CyclopsBlocks` custom node types. These are `@tool extends Node3D` scripts that run `build_from_block()` at game startup (inside `_process` when `dirty`), reconstructing their `ArrayMesh` and `ConvexPolygonShape3D` at runtime from a stored `MeshVectorData` resource. The addon registers a `CyclopsAutoload` singleton that every block references via `/root/CyclopsAutoload`. This means `addons/cyclops_level_builder/` must ship with the game and the autoload must be active — the opposite of our convention of no stray autoloads and plain-node scenes. There is no bake-to-static-body / export-to-plain-nodes command in the codebase; blocks cannot be flattened into vanilla `StaticBody3D + MeshInstance3D + CollisionShape3D` that would survive removing the plugin.

**Godot 4.3 load failure.** Issue #196 (open, September 2024) and issue #232 (open, 2025) both report that enabling the plugin in Godot 4.3 fails with "Unable to load addon script … cyclops_level_builder.gd". The maintainer is active (commits 8 days ago) but these issues are unresolved. Combined with the runtime coupling, adoption now would require keeping the plugin permanently AND absorbing an unconfirmed 4.3 breakage risk.

**Scope clarification (on the record).** This evaluation covers only the **hand-built** level path (`levels/blockout_01.tscn` and other hand-typed level scenes). The draw-grid pipeline (`levels/drawn/current.json` → godot-dev authors a baked `.tscn`) is a separate path, evaluated under GridMap separately.

**What would change the verdict.** If the maintainer ships a "bake to standard nodes" command (the way CSG has "Bake Mesh" and "Bake Collision"), the runtime coupling disappears, the addon becomes editor-only, and the 4.3 loading issue becomes the only remaining blocker. Park and revisit then.

**Collision shape.** Where it does generate collision, it uses `ConvexPolygonShape3D` (convex hull per block). For simple box-primitive blockout rooms this is fine. Non-convex geometry (L-shapes, stairs) requires explicit boolean-subtract workflows in Cyclops or produces inaccurate hulls — not a blocker on its own but worth noting.

**Forward+ / pixel-art rig.** No conflict: Cyclops applies `StandardMaterial3D` (its grid.tres default) and does not touch the SubViewport, the orthographic camera, or any post-process chain. Switching materials to flat pixel-art StandardMaterial3D after blocking would be trivial. This is not a concern.

**Code-rules.** Cyclops GDScript does not use strict typing uniformly (untyped `var global_scene = get_node(...)` calls appear throughout). Our `tools/validate.sh` would flag these on any file inside `addons/cyclops_level_builder/` if we ever linted it — but the convention is that third-party addon scripts are excluded from our lint gate. Not a blocker, but documents the gap.

## Install

Not applicable — verdict is parked.

## Later

- **GridMap** — Godot's built-in voxel-tile tool for the draw-grid pipeline (`levels/drawn/current.json`); evaluate separately.
- **Qodot** — BSP/Quake-map import pipeline; heavier toolchain dependency (TrenchBroom), no runtime coupling. Consider if Cyclops never bakes.
- **Hand-tooling improvement** — the immediate fix for the transform-drift bug (the affected hand-built level scene) is a godot-dev task: re-author the level as hand-typed nodes using the `level-design-principles` skill and the boxed-room pattern from blockout_01.tscn, with each `StaticBody3D` anchored at the mesh origin so scale can never drift from the collider.
