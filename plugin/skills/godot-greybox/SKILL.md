---
name: godot-greybox
agents: [game-designer, level-designer]
description: Fast HAND-AUTHORED STATIC blockout for prototyping ANY level in Godot — write real, editable nodes (one floor, walls/props, hazards, NavigationRegion3D) DIRECTLY into `levels/<name>.tscn` so every piece is selectable and movable in the editor. Turns a level-designer concept brief into a measurable, non-flat space (elevation change, distinguishable zones). This is the DEFAULT build method. Use for "greybox", "blockout", "prototype a level", "level feels empty / flat / boxy". NOT runtime/Resource-driven generation (that is `godot-runtime-arena`, opt-in only), NOT GridMap tile-fill (`godot-gridmap-level`, only when asked), NOT the concept interview (that is level-designer), NOT combat/arena spatial-design principles for encounter spaces (that is the opt-in `godot-arena-spatial-design` — layer it on top when the level is a combat arena).
---

# godot-greybox — static hand-authored blockout (prototype craft)

A greybox is a fast **static** blockout you author **directly in the scene** — real `StaticBody3D` /
`MeshInstance3D` / `Marker3D` / `Area3D` nodes written into `levels/<name>.tscn`, every one
selectable and movable in the Godot editor. It is for PROTOTYPING the SHAPE of a level — any level,
not just a combat arena.

**Build it STATICALLY, never at runtime.** The geometry lives in the saved `.tscn`. Do NOT write a
builder that generates walls in `_ready()`, do NOT drive it from a Resource, do NOT use a GridMap,
do NOT generate the floor from a build script. **If the scene is empty in the editor and the
geometry only appears on Play, it was built wrong** — that is the #1 failure this skill exists to
prevent. (When you genuinely want a Resource assembled at runtime into many variants, that is a
different, OPT-IN skill: `godot-runtime-arena`. Default to static — this one.)

A flat, empty room reads as boring or unfinished for a measurable reason: no elevation change, no
distinguishable zones, one undifferentiated box. Author for at least one elevation change and ≥2
distinguishable named zones; self-audit by eye in the editor before handoff (see
`level-design-principles` for the interview-time version of this bar — verticality, space contrast,
shape variety). **Building a combat/arena encounter space?** Layer the opt-in
`godot-arena-spatial-design` principles (cover, sightlines, spawn pacing) on top of this skill —
they are NOT part of the generic bar below.

## Requirements

- `godot-code-rules` — strict typed GDScript for any glue `.gd` (there should be little; the level
  is data-as-scene, not code).
- `godot-composition` — gameplay components (hazards, interactables) are nodes under the level root.
- `godot-main-scene` — levels load under Main/LevelHost; the blockout IS a level scene.
- `godot-verify` — author nodes via `position` + `rotation` properties, NEVER a raw `Transform3D`
  literal in the `.tscn` (the parser drifts/clips them — the original reason hand-typed walls broke).
- level-designer has produced a concept brief (`design/levels/<name>.md`). This skill consumes it.

## Project conventions

- 1 Godot unit = 1 metre (e.g. floor ~0.2 thick, walls h≈4, player capsule ~1.8).
- The blockout lives in `levels/<name>.tscn` — REAL nodes in the SAVED file:
  - **Floor:** ONE `StaticBody3D` + `MeshInstance3D` (BoxMesh) + `CollisionShape3D` — a single floor,
    never fragmented per-row segments.
  - **Walls / props:** each a `StaticBody3D` + `BoxMesh` + collider, placed by `position` + `rotation`.
  - **Fall hazard (if the level has one):** a `FallZone` `Area3D` (`collision_mask` MUST include the
    player's layer, 2, or it never fires), reusing the existing pattern. Gotcha: on respawn, ZERO
    the player's velocity (the reset/`reset_to` call) or it keeps the fall speed.
  - **Nav:** one `NavigationRegion3D` in group `nav_region`, baked over the floor.
  - node names PascalCase; files snake_case.
- Reuse existing systems (e.g. FallZone) — do not invent new runtime systems.

## Steps

1. Read the level-designer brief: concept, zones, footprint. If oversized, shrink the footprint
   FIRST (oversized is the #1 cause of "empty").
2. **Author `levels/<name>.tscn` directly** — one floor node, the perimeter, then interior walls/
   props per zone, with at least one elevation change and ≥2 distinguishable named zones. Real
   nodes, `position` + `rotation`, all in the SAVED scene. **Building a combat/arena encounter?**
   Also apply `godot-arena-spatial-design`'s nine principles here (loop topology, interior cover,
   sightlines, verticality, landmarks, spawn-to-engagement pacing).
3. Add any hazard `Area3D`s (e.g. FallZone) and a baked NavigationRegion3D. Reuse the existing
   hazard systems.
4. **Open it in the EDITOR — every piece must be selectable and present in the saved file.** If it's
   empty until Play, you built a runtime generator — STOP and author the geometry statically (or
   switch to `godot-runtime-arena` if runtime is genuinely the goal).
5. Self-audit by eye (below) + a quick F5 walk; iterate the scene directly.
6. Hand off to godot-dev / godot-verify.

## Pre-handoff self-audit (by eye, in the editor + one F5)

- [ ] geometry is in the SAVED `.tscn` — selectable in the editor, NOT runtime-built
- [ ] ONE floor (not fragmented segments)
- [ ] at least one elevation change (not perfectly flat)
- [ ] ≥2 distinguishable named zones (not one undifferentiated box)
- [ ] props/obstacles sit ON the navmesh (not floating/sunk)
- [ ] no raw `Transform3D` literals (godot-verify)

## Error → Fix

| Symptom                                          | Fix                                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Walls show on Play but are absent in the editor  | A runtime builder generated them in `_ready()`. Author the geometry into the saved `.tscn` as real nodes — or, if runtime IS the goal, use `godot-runtime-arena`. |
| Floor is many segments / drifts off colliders    | Don't build the floor from code/per-row/a build script; ONE hand-authored floor node.                                                                             |
| Prop/obstacle floats or something paths under it | re-place it on the floor; re-bake `nav_region`                                                                                                                    |
| Build fails godot-verify Transform3D ban         | author nodes via `position` + `rotation` properties, never a `Transform3D` literal                                                                                |

---

For a Resource-driven arena assembled at RUNTIME (an `ArenaLayout` `.tres` + a builder node + a
headless spatial audit) — used ONLY when many data-driven variants are explicitly wanted — see the
opt-in `godot-runtime-arena` skill, NOT this one. For combat/arena spatial-design principles (cover,
sightlines, spawn pacing) layer the opt-in `godot-arena-spatial-design` skill on top of whichever
build method you chose.
