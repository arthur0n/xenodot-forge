---
name: godot-greybox
agents: [game-designer, level-designer]
description: Fast HAND-AUTHORED STATIC blockout for prototyping a combat arena in Godot — write real, editable nodes (one floor, wall/cover boxes, spawn markers, FallZone, NavigationRegion3D) DIRECTLY into `levels/<name>.tscn` so every piece is selectable and movable in the editor. Turns a level-designer concept brief into a measurable, non-flat combat space via nine spatial principles (interior cover, layered sightlines, bounded verticality, ≥3 regions, spawn-to-engagement). This is the DEFAULT build method. Use for "greybox", "blockout", "prototype a level/arena", "level feels empty / flat / boxy", "add cover", "spatial pacing". NOT runtime/Resource-driven generation (that is `godot-runtime-arena`, opt-in only), NOT GridMap tile-fill (`godot-gridmap-level`, only when asked), NOT the concept interview (that is level-designer).
---

# godot-greybox — static hand-authored blockout (prototype craft)

A greybox is a fast **static** blockout you author **directly in the scene** — real `StaticBody3D` /
`MeshInstance3D` / `Marker3D` / `Area3D` nodes written into `levels/<name>.tscn`, every one
selectable and movable in the Godot editor. It is for PROTOTYPING the SHAPE of a combat space.

**Build it STATICALLY, never at runtime.** The geometry lives in the saved `.tscn`. Do NOT write a
builder that generates walls in `_ready()`, do NOT drive it from a Resource, do NOT use a GridMap,
do NOT generate the floor from a build script. **If the scene is empty in the editor and the
geometry only appears on Play, it was built wrong** — that is the #1 failure this skill exists to
prevent. (When you genuinely want a Resource assembled at runtime into many variants, that is a
different, OPT-IN skill: `godot-runtime-arena`. Default to static — this one.)

The "flat empty square" failure is the absence of five measurable properties — interior cover,
layered sightlines, bounded verticality, ≥3 nameable regions, and a spawn-to-engagement path that is
neither too long nor fully exposed. Author for those; self-audit by eye in the editor before handoff.

## Requirements

- `godot-code-rules` — strict typed GDScript for any glue `.gd` (there should be little; the level
  is data-as-scene, not code).
- `godot-composition` — gameplay components (spawner, hazard) are nodes under the level root.
- `godot-main-scene` — levels load under Main/LevelHost; the blockout IS a level scene.
- `godot-verify` — author nodes via `position` + `rotation` properties, NEVER a raw `Transform3D`
  literal in the `.tscn` (the parser drifts/clips them — the original reason hand-typed walls broke).
- level-designer has produced a concept brief (`design/levels/<name>.md`). This skill consumes it.

## Project conventions

- 1 Godot unit = 1 metre (e.g. floor ~0.2 thick, walls h≈4, player capsule ~1.8).
- The blockout lives in `levels/<name>.tscn` — REAL nodes in the SAVED file:
  - **Floor:** ONE `StaticBody3D` + `MeshInstance3D` (BoxMesh) + `CollisionShape3D` — a single floor,
    never fragmented per-row segments.
  - **Walls / cover:** each a `StaticBody3D` + `BoxMesh` + collider, placed by `position` + `rotation`.
  - **Spawns:** `SpawnMarker*` `Marker3D` children wired to the wave/spawn manager's `spawn_marker_paths`.
  - **Fall hazard:** a `FallZone` `Area3D` (`collision_mask` MUST include the player's layer, 2, or it never fires), reusing the existing pattern. Gotcha: on respawn, ZERO the player's velocity (the reset/`reset_to` call) or it keeps the fall speed.
  - **Nav:** one `NavigationRegion3D` in group `nav_region`, baked over the floor.
  - node names PascalCase; files snake_case.
- Reuse existing systems (spawn manager, FallZone) — do not invent new runtime systems.

## The nine spatial principles (author for these; self-audit BY EYE)

- **P1 TOPOLOGY = LOOP.** Every cover piece has ≥2 escape routes; no dead-ends (three-lane / figure-8).
  _Biggest lever vs the empty square._ CHECK (editor + F5): you can circle ≥2 ways; no degree-1 pockets.
- **P2 INTERIOR FOOTHOLD.** Each region has ≥1 cover piece NOT touching a perimeter wall. CHECK: walk
  the centre — is there cover to use?
- **P3 PARTITIONED SIGHTLINES.** No standing point sees the whole arena. CHECK: stand at spawn + each
  corner — is any spot exposed to everything?
- **P4 COVER COMPOSITION.** Mix half (crouch/step-out) vs full (blocks LOS), hard vs soft. CHECK: no
  single class dominates.
- **P5 VERTICALITY = RESTRAINT.** Present but bounded (2–3 floor levels). CHECK: is there ANY elevation
  change? (a flat floor = fail).
- **P6 LANDMARKS.** ≥3 nameable sub-regions, distinct massing/height/greybox colour. CHECK: can you
  name 3 distinct areas?
- **P7 SPAWN-TO-ENGAGEMENT.** Path spawn→first fight is in band (not instant, not a long boring run)
  and passes ≥1 cover. CHECK: walk spawn→centre — time it; does it pass cover?
- **P8 SCALE / DENSITY.** Halls ≥2.0 m; doorways ≥1.25×2.5; not oversized (the #1 cause of "empty" —
  shrink footprint). CHECK: footprint vs enemy count reads dense, not a parking lot.
- **P9 CHOKE vs OPEN.** Alternate open spaces with commitment chokes. CHECK: is there a tight passage
  before the big space?

## Steps

1. Read the level-designer brief: experience-goal, pacing beats, footprint. If oversized, shrink the
   footprint FIRST (oversized is the #1 cause of "empty").
2. **Author `levels/<name>.tscn` directly** — one floor node, the perimeter, then INTERIOR cover per
   region (P2), mixing classes (P4), with 2–3 floor levels (P5), ≥3 landmark regions (P6), on a loop
   topology (P1). Real nodes, `position` + `rotation`, all in the SAVED scene.
3. Add the `SpawnMarker*` Marker3D children, the FallZone Area3D, and a baked NavigationRegion3D.
   Reuse the existing spawn/hazard systems.
4. **Open it in the EDITOR — every piece must be selectable and present in the saved file.** If it's
   empty until Play, you built a runtime generator — STOP and author the geometry statically (or
   switch to `godot-runtime-arena` if runtime is genuinely the goal).
5. Self-audit by eye (below) + a quick F5 walk; iterate the scene directly.
6. Hand off to godot-dev / godot-verify.

## Pre-handoff self-audit (by eye, in the editor + one F5)

- [ ] geometry is in the SAVED `.tscn` — selectable in the editor, NOT runtime-built
- [ ] ONE floor (not fragmented segments)
- [ ] interior footholds per region (P2); not a hollow square
- [ ] loop topology, no dead-ends (P1)
- [ ] no point sees the whole arena (P3)
- [ ] cover-class mix (P4)
- [ ] 2–3 verticality levels (P5)
- [ ] ≥3 named landmark regions (P6)
- [ ] spawn-to-engagement in band + passes cover (P7)
- [ ] cover sits ON the navmesh
- [ ] no raw `Transform3D` literals (godot-verify)

## Error → Fix

| Symptom                                         | Fix                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Walls show on Play but are absent in the editor | A runtime builder generated them in `_ready()`. Author the geometry into the saved `.tscn` as real nodes — or, if runtime IS the goal, use `godot-runtime-arena`. |
| Floor is many segments / drifts off colliders   | Don't build the floor from code/per-row/a build script; ONE hand-authored floor node.                                                                             |
| Arena reads empty in the centre                 | add interior-foothold cover per region (P2); shrink footprint if oversized                                                                                        |
| Whole arena visible from spawn                  | add internal wall/massing (P3)                                                                                                                                    |
| Cover floats / enemies path under it            | re-place cover on the floor; re-bake `nav_region`                                                                                                                 |
| Build fails godot-verify Transform3D ban        | author nodes via `position` + `rotation` properties, never a `Transform3D` literal                                                                                |

---

For a Resource-driven arena assembled at RUNTIME (an `ArenaLayout` `.tres` + a builder node + a
headless spatial audit) — used ONLY when many data-driven variants are explicitly wanted — see the
opt-in `godot-runtime-arena` skill, NOT this one. Adapted from The Level Design Book
(book.leveldesignbook.com) + GDC talks (FMPONE, Steve Lee, Griesemer, Worch). Reference, no code copied.
