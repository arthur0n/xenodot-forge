# Verdict — godot-greybox skill (arena blockout quality)

Date 2026-06-23 · researcher: skill-researcher · input: Hermes run run_eb62deb87dee4918a69b64cc7214e47c (`.xenodot/handoffs/greybox-skill-research.md`).
Trigger: user unhappy arena levels ship as "flat empty oversized perimeter-walled squares". Wants the SKILL improved, NOT an addon.

## TL;DR

**ADOPT** a new `godot-greybox` skill, SPLIT from `level-designer` per Hermes rec. level-designer stays concept-first brief; godot-greybox = spatial-craft layer that emits/edits an `ArenaLayout` `.tres`, instantiates it via one builder node, and runs a checkable self-audit. Aligns with the SYSTEMS + DATA-DRIVEN directive (layout is DATA the builder reads — mirrors `cast-system` / `godot-enemy-archetype`). All numeric caps are INFERRED → ship checker in REPORT + baseline-diff mode first, harden to pass/fail only after calibrating on Blast Court + one good + one bad variant. Same discipline as the unverified-regex CI footgun.

## Grounded against THIS repo (Hermes could not read it)

Confirmed `levels/blast_court.tscn`, `levels/wave_manager.gd`, `levels/blast_court.gd`, `project.godot`.

1. **Unit scale = 1 Godot unit = 1 m — CONFIRMED.** blast_court floor slabs 0.2 thick, walls h=4, player capsule ~1.8 m, doorway-scale cover 4–6 m. P8 metrics-zoo dims apply AS-IS (wall 150–200% figure; halls ≥2.0 m; doorways ≥1.25×2.5). No scale conversion needed. `window/stretch/scale_mode="integer"` is render-only, not world scale.

2. **Blast Court IS the failure case, quantified.**
   - Footprint 72×48 = **3456 m²**. `active_cap=30` → **115 m²/enemy** vs Hermes INFERRED 25–40 → arena ~3× oversized. P7/P8 fail, measurably.
   - Cover = **2 blocks** (CoverBlockA 12×4×6, CoverBlockB 6×4×6), both top-edge (z=7.5/10.5). Density ~0.0006 cover/m² (≈0). No interior foothold near center → **P2 fails**. Center (player @ 25.5,25.5) empty.
   - All floor slabs `y=-0.1` uniform → **verticality 0 → P5 fails**.
   - Perimeter walls 4 sides h=4; 24 SpawnMarkers all on perimeter → **P3/P6 fail** (no internal massing, 1 region).
   - → user's exact complaint decomposes cleanly onto P2/P3/P5/P6/P7/P8. The failure-mode catalogue LED BY "flat empty square" is grounded in real geometry, not theory.
   - SIDE-FINDING: CoverBlockA/B authored with raw `Transform3D(...)` (8° rotation) → violates the Transform3D ban in `godot-verify`. Builder must emit `position`+`rotation`(`rot_y`), never Transform3D literals. Flag for cleanup.

3. **Spawn-to-engagement uses REAL markers.** 24 `SpawnMarker*` Marker3D + `CenterWP` (36,0,24) + 3 `EnemyWP*`. WaveManager resolves `spawn_marker_paths`. P7 metric = path SpawnMarker→CenterWP (or nearest cover), NOT abstract center. Markers are perimeter → straight-line ~24 m → at run speed too long AND too exposed (no cover between).

4. **Cover-off-navmesh + walkable checks REUSE WaveManager's exact APIs — do NOT fork.**
   - Nav region found via `get_tree().get_first_node_in_group("nav_region")` (NavFloor in blast_court has `groups=["nav_region"]`). Map RID via `nav_region.get_navigation_map()`.
   - Snap/closest-point: `NavigationServer3D.map_get_closest_point(map, pos)` (already used in `_nav_snap`). cover-off-navmesh = closest-point dist > eps.
   - Routes/dead-ends: `NavigationServer3D.map_get_path`.
   - LOS / sightline: `PhysicsDirectSpaceState3D.intersect_ray` with `collision_mask = 1` (WALL_MASK) and `EYE_HEIGHT = 1.0` — mirror WaveManager's `_ray_query` exactly so checker sees the SAME geometry enemies/spawns do.
   - Checker MUST bake/use the SAME navmesh (`blast_court_navmesh.tres`) the `NavigationAgent3D` enemies use. Confirmed single shared region.

5. **FallZone / trap-floor already exists — `fall_zones:Array[AABB]` reuses it, does NOT fork.** `levels/blast_court.gd`: FallZone Area3D `collision_mask=2`, `body_entered → _on_fall_zone_entered → apply_damage + teleport`; 4 dwell-trap tiles (TrapA–D Area3D sensors). ArenaLayout `fall_zones` = data that the builder instantiates into the existing FallZone Area3D pattern + dwell tiles. Schema describes what's built; no new runtime system.

6. **No greybox/layout guidance exists today.** `level-design-principles` (level-designer skill) = interview PRINCIPLES only (verticality, contrast, variety) — prose, NOT checkable, NOT a builder. `godot-gridmap-level` = tile-fill from drawn grid (≠ continuous combat cover). `godot-main-scene` = level swap under LevelHost. `godot-composition` = builder node should be a component under the level root. **Real gap → adopt confirmed.**

7. **L2 runtime layer exists for the checker: `godot-runtime-smoke`.** Headless `tools/smoke_*.gd` SceneTree harness, wired as a `tools/validate.sh` step. The layout self-audit checker = a new `tools/audit_layout.gd` (or `smoke_layout.gd`) following that proven pattern. NavigationServer3D map_get_path/closest_point + intersect_ray all work headless (logic asserts). No GdUnit4.

## Adopt / skip per element

| Hermes element                                      | Verdict                           | Grounding                                                               |
| --------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| P1 topology = loop / ≥2 escape routes / no degree-1 | ADOPT                             | strongest lever vs empty square; `map_get_path` non-overlap measures it |
| P2 interior foothold per region                     | ADOPT                             | blast_court fails it exactly (cover all perimeter)                      |
| P3 partitioned sightlines                           | ADOPT, cap CALIBRATE              | intersect_ray; perimeter-only walls fail it                             |
| P4 cover composition (half/full, hard/soft)         | ADOPT, ratio CALIBRATE            | `ArenaPiece.cover_class` carries it                                     |
| P5 verticality = restraint (bounded)                | ADOPT                             | blast_court flat → 0; cap "2–3 floor levels" CALIBRATE                  |
| P6 ≥3 landmarks/regions w/ unique massing           | ADOPT                             | blast_court = 1 region                                                  |
| P7 spawn-to-engagement pacing                       | ADOPT                             | use REAL SpawnMarkers→CenterWP; band CALIBRATE                          |
| P8 metrics zoo (dims)                               | ADOPT AS-IS (scale=1 m confirmed) | density m²/enemy CALIBRATE (115 now, target 25–40)                      |
| P9 choke/open balance                               | ADOPT, ratio CALIBRATE            | low priority for v1                                                     |
| Metric set (scene-graph / navmesh / raycast)        | ADOPT                             | reuses WaveManager APIs verbatim                                        |
| cover-off-navmesh detector                          | ADOPT (high value)                | catches real bug class; map_get_closest_point                           |
| ArenaLayout Resource schema                         | ADOPT                             | fits .tres mandate; reuses fall_zones/markers/nav                       |
| Builder node (reads layout → instantiates)          | ADOPT (BUILDER task)              | one node under level root; godot-composition                            |
| Layout self-audit checker tool                      | ADOPT (BUILDER task)              | tools/audit_layout.gd, godot-runtime-smoke pattern                      |
| Graph-grammar topology seed → checker-gated         | PARK (note in skill)              | best AI fit later; v1 = hand-authored DATA                              |
| WFC / BSP generators                                | SKIP                              | WFC weak for continuous cover; BSP anti-arena                           |
| Pass/fail hard caps NOW                             | SKIP for v1                       | ship REPORT + baseline-diff; harden after calibration                   |

## CALIBRATE-not-copy (all INFERRED — never paste as pass/fail)

cover density m²/enemy (start REPORT; blast_court=115, target band 25–40 by playtest) · longest-sightline cap · %-walkable-visible-from-worst-point cap · cover-class ratio (≤~70% single class) · verticality bound (2–3 levels) · spawn-to-engagement band (arena-survival 3–8 s INFERRED) · open:choke floor ratio. Calibrate on Blast Court + 1 good + 1 bad variant BEFORE any hard gate.

## Reuse, don't fork — summary

nav: group "nav_region" + NavigationServer3D (map_get_closest_point/map_get_path) · LOS: intersect_ray mask=1 eye=1.0 · spawn: existing SpawnMarker3D set · fall: existing FallZone Area3D mask=2 + dwell tiles · checker harness: godot-runtime-smoke / validate.sh step · builder: godot-composition component · Transform3D ban: emit position+rot_y only (godot-verify).

## Split decision — ADOPT

KEEP `level-designer` = concept-first interview/brief (design/levels/<name>.md). ADD `godot-greybox` = spatial-craft executor: reads brief → emits/edits `ArenaLayout` .tres → builder instantiates → self-audit reports violations → iterate. Contract = ArenaLayout .tres + brief (experience-goal + pacing beats). game-designer routes brief → godot-greybox craft → godot-dev build.
