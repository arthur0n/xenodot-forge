---
name: godot-runtime-arena
agents: [game-designer, level-designer]
description: Resource-driven arena assembled at RUNTIME in Godot — author an `ArenaLayout` `.tres` (footprint, cover pieces with class, verticality, lanes, landmarks, spawn markers, fall zones) that ONE builder node instantiates in `_ready()`, plus a headless layout self-audit that REPORTS spatial metrics. OPT-IN — use ONLY when the user EXPLICITLY wants a Resource/data-driven, runtime-built, or many-variant arena (a designer iterates the `.tres` without touching scenes). For a normal prototype blockout use `godot-greybox` (static, hand-authored, editable in the editor) — that is the DEFAULT; this is the opt-in runtime path. Builds on `godot-arena-spatial-design`'s nine spatial principles. NOT GridMap tile-fill (`godot-gridmap-level`).
---

# godot-runtime-arena — Resource-driven arena, built at runtime

**OPT-IN.** Use this ONLY when runtime / Resource-driven assembly is explicitly wanted — the designer
edits an `ArenaLayout` `.tres` and one builder node constructs the geometry at play-time, so a new
arena variant is a new `.tres` with no scene editing. **For a one-off prototype you open and move in
the editor, use `godot-greybox` (static) instead — that is the default.** The arena's spatial quality
is judged by the nine principles in `godot-arena-spatial-design`; this skill is only the MECHANISM
(the Resource + the builder + the headless audit), not the design craft.

**Know the tradeoff before choosing this:** a runtime build means the geometry is NOT in the saved
scene — the level is empty in the editor and only appears on Play. Accept that ONLY because you want
data-driven variants / generation. If you'll hand-tweak the layout visually, you want `godot-greybox`.

## Requirements

- `godot-arena-spatial-design` — the nine spatial principles (what makes a good arena) apply here;
  this skill only changes HOW the arena is assembled (runtime, from data).
- `godot-code-rules` — strict typed GDScript: the `ArenaLayout` Resource + builder are typed.
- `godot-composition` — the builder is a component node under the level root; signals up / calls down.
- `godot-runtime-smoke` — the audit is a headless `SceneTree` tool wired as a `validate.sh` step.
- `godot-main-scene` — the builder lives inside a level scene under Main/LevelHost.
- `godot-verify` — the builder emits `position` + `rotation.y` only, never a `Transform3D` literal.

## ArenaLayout schema (DATA)

- `ArenaLayout extends Resource`: `footprint_m: Vector2`, `floor_y: float`, `perimeter_walls: bool`,
  `pieces: Array[ArenaPiece]`, `spawn_markers: Array[Vector3]`, `fall_zones: Array[AABB]`,
  `lanes: Array[LaneDef]`, `landmarks: Array[LandmarkDef]`.
- `ArenaPiece extends Resource`: `type: int` (enum BOX_FULL_COVER / BOX_HALF_COVER / RAMP / PLATFORM /
  DROPDOWN / WALL_PARTITION / SOFT_COVER), `pos: Vector3`, `rot_y: float`, `size: Vector3`,
  `cover_class: int` (HALF/FULL × HARD/SOFT), `lane_id: int`.
  Iterate the layout = edit the `.tres`. New cover behaviour = new piece type, no call-site change.

## Steps

1. Author / edit `levels/<name>_layout.tres` (an `ArenaLayout`) for the nine principles
   (`godot-arena-spatial-design`): interior cover per region (P2), mixed classes (P4), 2–3 levels
   (P5), ≥3 landmarks (P6), loop lanes (P1). Emit `pos` + `rot_y` only.
2. Wire `spawn_markers` + `fall_zones` to reuse the existing SpawnMarker3D / FallZone pattern — do not
   invent a new hazard or spawn system.
3. Let the `ArenaBuilder` node instantiate the layout in `_ready()` (BoxMesh StaticBody3D per piece,
   SpawnMarker3D, FallZone + dwell tiles, bake NavigationRegion3D in group `nav_region`).
4. Run the headless layout audit (`$GODOT --headless --script tools/audit_layout.gd -- <level.tscn>`).
   It REPORTS the metric set + diff vs a known-good baseline. Read violations; iterate the `.tres`.
   Do NOT gate the build on a number until it is calibrated on a good + a bad variant.

## Metric set → Godot API (headless audit)

| Metric                          | API                                                                        |
| ------------------------------- | -------------------------------------------------------------------------- |
| footprint m², per-enemy density | floor AABB area / active_cap                                               |
| cover count + class breakdown   | iterate `ArenaLayout.pieces`                                               |
| cover-off-navmesh               | `NavigationServer3D.map_get_closest_point` — dist > eps → flag             |
| %walkable / routes / dead-ends  | navmesh poly area; `NavigationServer3D.map_get_path`                       |
| spawn-to-engagement             | `map_get_path` SpawnMarker→centre / run speed                              |
| longest sightline / coverage %  | `PhysicsDirectSpaceState3D.intersect_ray`, mask=1, eye=1.0, grid of points |
| verticality                     | max-min `floor_y`, #distinct levels                                        |

## Error → Fix

| Symptom                                            | Fix                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Geometry empty in the editor, appears only on Play | EXPECTED for a runtime build — that's the tradeoff. If unwanted, you should be using `godot-greybox` (static), not this skill. |
| Build fails godot-verify Transform3D ban           | builder/`.tres` emit `pos` + `rot_y`, never a `Transform3D` literal                                                            |
| Cover floats / enemies path under it               | piece off the navmesh — re-place on nav, re-bake `nav_region`                                                                  |
| Audit flips red on a fresh number                  | caps are INFERRED — run REPORT mode, calibrate on good + bad before gating                                                     |

## Parked (later)

- Graph-grammar topology-seed (three-lane / figure-8) emitting an `ArenaLayout` + constraints →
  checker-gated. This is where genuine PROCEDURAL generation would live (NOT WFC — weak for continuous
  combat cover; NOT BSP — corridor/maze, anti-arena). Today the `ArenaLayout` is AUTHORED, not generated.

---

Opt-in runtime / Resource-driven path; the static default is `godot-greybox`. Adapted from The Level
Design Book + GDC talks. Reference, no code copied.
