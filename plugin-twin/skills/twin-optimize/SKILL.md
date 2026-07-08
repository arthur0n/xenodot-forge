---
name: twin-optimize
agents: [twin-architect, scene-optimizer]
description: >-
  Scale a digital-twin viewer to large instance counts without lying to yourself about fps — the
  chunked-MultiMesh recipe (measured to 1M instances), the occlusion-culling toggle discipline (it
  can be net-NEGATIVE), and the benchmark methodology that survives macOS (frames-drawn deltas,
  vsync off, warmup). Use when the walkthrough stutters, when a frame budget must hold at N
  instances, when deciding chunked vs single MultiMesh, when tempted to enable occlusion culling
  "because more culling is better", when an imported twin model should get the toolkit applied
  automatically (tools/optimize_scene.gd), or when any fps number is about to go in a report.
  NOT the import pipeline (twin-import) and NOT data binding (twin-bind-data).
---

# Twin optimize (chunking, culling, honest benchmarks)

Every number below is **measured** (Phase 0 spike S3, 1M-instance factory layout, macOS Metal;
record: `library-twin/findings/twin-spike-verdicts-2026-07-08.md` — twin knowledge reads/writes
go through the project's `library-twin/` mount, the engine-invisible symlink to its canonical
home `plugin-twin/library/`; the base plugin's knowledge stays on `library/`). The recipes
generalize; the exact percentages are one machine's — re-measure on the target hardware before
promising a budget.

## Scene optimizer — `tools/optimize_scene.gd` (headless)

Mechanizes the toolkit below on an imported twin model. No editor import needed (.glb loads at
runtime via GLTFDocument), deterministic, headless-safe, exit 0 = optimized scene + report:

```sh
$GODOT --headless --path . --script tools/optimize_scene.gd -- \
    --in=<model.glb|scene.tscn> --out=<optimized.tscn> --report=<report.json> \
    [--chunks=8] [--min-instances=8] [--occluders] [--vis-ranges]
```

Passes, in order:

- **Instancing (always on).** Groups MeshInstance3Ds by (mesh resource, `material_override`);
  nodes with per-surface override materials are skipped — MultiMeshInstance3D cannot express
  them. Groups with ≥ `--min-instances` (default 8) collapse into region-chunked
  MultiMeshInstance3D fields: the group's world AABB gridded `--chunks`×`--chunks` (default
  8×8) on the XZ plane, instances bucketed by origin, one MultiMesh per non-empty cell with a
  correct per-chunk `custom_aabb` so the frustum culler gets real units (chunk nodes sit at
  identity; buffers follow the 12-float recipe below, `instance_count` set BEFORE `buffer`).
- **GlobalId join preserved.** Every chunk node carries `meta "twin_globalids"` — a
  PackedStringArray of the original node names ordered by instance index — and the report
  embeds the same map (`globalid_map`), so data binding can still resolve
  instance → GlobalId (`set_instance_color` per instance later). Caveat: the stored name is
  the MeshInstance3D's own; models that keep the guid on a parent grouping node need the
  node-or-parent fallback applied BEFORE optimizing.
- **`--occluders` (opt-in — occlusion culling can be net-negative, see below).** Any remaining
  un-instanced mesh whose world-AABB volume exceeds 10 m³ (documented default) gets a child
  OccluderInstance3D + BoxOccluder3D sized to 90% of its local AABB — the shrink avoids
  self-occlusion artifacts, explicit box occluders need no bake.
- **`--vis-ranges` (opt-in).** Size classes by world-AABB diagonal: small (< 0.5 m) →
  `visibility_range_end = 40` m; medium (< 2 m) → 120 m; large → untouched (structure must
  never pop out). Un-instanced meshes only — chunked fields already cull per chunk. The
  distances are documented defaults, NOT a measured recipe yet (see TODO).

Report JSON: `meshes_before`, `nodes_before/after`, `groups_total/instanced`, `multimeshes`,
`instances_total`, `skipped_surface_override`, `occluders_added`, `vis_ranges_set`,
`est_draw_items_before/after` (one item per mesh-surface / per chunk-surface),
`globalid_map(_size)`, `per_group`.

Gotchas baked into the tool (learned the hard way):

- `Node3D.global_transform` silently returns identity during `SceneTree._init` — wait one
  `process_frame` before reading transforms, or every instance lands in one chunk at origin.
- `PackedScene.pack()` silently DROPS any node whose `owner` is unset — own every descendant
  before packing.
- Runtime-loaded GLB meshes have no `resource_path`, so they serialize inline into the output
  `.tscn` (duplex: 286 meshes → 465 KB text); pass an `.scn` out-path for big models.

### Measured on real BIM (duplex.glb, 286 meshes) — instancing rarely wins there

At defaults, duplex has **224 distinct mesh groups in 286 meshes**: only 3 groups
(30 instances) instanced, est draw items 348 → 340. Even at `--min-instances=2`: 26 groups /
88 instances → 84 multimeshes, still 348 → 340. **Real IFC geometry is mostly unique.** The
instancing pass pays off on repeated-equipment scenes — synthetic control, 2000 nodes sharing
3 meshes: 3 groups → 192 chunks, nodes 2001 → 194, est draw items 2000 → 192, all 2000
GlobalIds preserved and unique after round-trip. On unique-geometry architecture the
`--occluders` / `--vis-ranges` passes are what remain to tune (duplex: 31 occluders,
47 vis ranges) — and their fps effect must be benched per the methodology below, not assumed.

### Measured on a real composite scene (city block of duplexes, M3 Pro Metal)

Full record: `library-twin/findings/twin-optimizer-benchmark-2026-07-08.md`. duplex.glb
duplicated 20x20 (114,400 meshes) and optimized with `--chunks=2` (optimizer wall-clock 1.3 s):

- **Aerial (all visible): 27.3 → 119.4 fps (+337%, ≥4.4x — the after is still pinned at the
  macOS 120 Hz presentation cap)**; frame 36.6 → 8.4 ms; render-thread submit 28.98 → 0.56 ms
  (−98%); draw calls 21,787 → 1,084.
- Street level: 99.3 → 120 fps (cap-limited); render-thread 7.46 → 0.37 ms (−95%).
- **The default `--chunks=8` REGRESSED the same scene at 10x10** (~100 instances/group → ~2
  instances per chunk, 14,336 multimeshes): aerial 120 → 50.3 fps. Chunk count must match
  instance density — target tens of instances per chunk, not a fixed grid.
- macOS caps frame presentation at the display refresh (120 Hz) even with `VSYNC_DISABLED` —
  an empty scene benches at exactly 120. At the cap, compare `cpu_ms` (viewport measured
  render time, now in `bench_scene.gd`; `gpu_ms` reads 0 on this Metal setup), not fps.
- Forward+ already auto-merges repeated identical surfaces (49,458 objects → 6,802 draw
  calls unoptimized), so `est_draw_items` overstates before-cost; the real win is per-object
  cull/sort/submit overhead. `--occluders`/`--vis-ranges` are no-ops on fully-instanced
  scenes (0 added). Join gate on the optimized composite: 28,600/28,600 ids (100%) via
  `twin_globalids` metas.

## Recipe — chunked MultiMesh

Split the instance field into a **chunk grid** of MultiMeshInstance3D nodes (one MultiMesh per
chunk per mesh type) instead of one giant MultiMesh. Chunks give the frustum/occlusion culler
units it can actually reject; a single MultiMesh is all-or-nothing.

- **8×8 grid proven; 64–256 chunks is the sane band.** Too few → nothing culls; too many →
  per-object overhead eats the win.
- **`instance_count` MUST be set BEFORE `buffer`** — assigning the buffer first silently fails.
- Buffer layout (TRANSFORM_3D, no color/custom): **12 floats per instance**, the 3×4 transform
  **row-major** — per row: basis column x/y/z components then origin. Build
  `PackedFloat32Array`s per chunk; `buffer = buf` after `instance_count = buf.size() / 12`.
- Shadows off on instanced field meshes unless the look needs them (isolates instancing cost).

### Measured trade-off (1M instances) — chunking is camera-dependent

| Vantage                    | single → chunked fps | primitives      | verdict                    |
| -------------------------- | -------------------- | --------------- | -------------------------- |
| walkthrough (inside)       | 84.4 → 117.6 (+39%)  | −92% (18M→1.4M) | chunked wins big           |
| overview (full visibility) | 81.9 → 72.1 (−12%)   | same 18M        | chunked LOSES (more draws) |

So: **the primary camera decides.** A walkthrough viewer chunks; an overview dashboard may be
better single/coarse. When both matter, chunk and accept the overview tax — but say so in the
report, with both vantages measured.

## Occlusion culling — toggle discipline (it can be net-negative)

Godot's occlusion culling is a **CPU Embree raster** every frame — it costs before it saves.
On flat/open scenes it is **net-NEGATIVE**: the spike's occ-off control run beat the occ-on
run on the same scene. Rules:

- **Always ship it toggleable** (a flag / project-setting switch), never as the only path.
- **Report primitive reduction alongside fps** — a big primitive drop with flat fps means the
  bottleneck is elsewhere; fps alone can hide that occlusion is pure cost.
- Requires the project setting `rendering/occlusion_culling/use_occlusion_culling = true`
  (plus `get_viewport().use_occlusion_culling` at runtime).
- **Explicit `OccluderInstance3D` + `BoxOccluder3D` needs NO bake** — baking is only for
  deriving occluders from arbitrary meshes. Hand-placed box occluders on walls work at runtime.

## Benchmark methodology (how not to lie)

`tools/bench_scene.gd` implements this; keep the discipline even ad hoc:

- **fps = `Engine.get_frames_drawn()` delta / elapsed** — the only trustworthy number on
  macOS. When the window is occluded, macOS suspends drawing: `frame_post_draw` stops firing
  and the process loop keeps spinning, so **process-loop fps lies**. Keep the window
  `ALWAYS_ON_TOP` + foregrounded for the whole run; report `process_fps` separately if at all.
- **vsync OFF** (`display/window/vsync/vsync_mode = 0`) — otherwise everything clamps to 60/120
  and deltas vanish.
- **Warm up ~2 s, measure ~8 s** per config; average Performance monitors
  (`RENDER_TOTAL_DRAW_CALLS_IN_FRAME`, `RENDER_TOTAL_PRIMITIVES_IN_FRAME`,
  `RENDER_TOTAL_OBJECTS_IN_FRAME`) over the window.
- **Before/after, same vantage(s), both vantage classes** — see the trade-off table for why a
  one-vantage result can invert.
- Not headless — rendering benchmarks need a display by nature. Headless runs must SKIP loudly,
  never fabricate.

## Phase 2 TODO — honest boundaries

The following are NOT yet proven recipes; treat them as open work, not folklore:

- **LOD / `visibility_range_*` as a MEASURED recipe** — the optimizer's `--vis-ranges` pass
  applies documented size-class defaults, but no bench has validated the distances (or added
  hysteresis via `visibility_range_begin_margin`). Do not present visibility ranges as a
  proven fps win until benched here.
- **Auto-LOD generation** (simplified proxy meshes for far ranges, procedural or via
  `ImporterMesh` LODs) — not built; `--vis-ranges` only hides, it never swaps.
- **Automatic chunk-size selection** — `--chunks` is a fixed default (8×8); the 64–256 band is
  empirical at 1M instances on one layout. Small groups get near-1-instance chunks today; no
  formula for arbitrary models/instance densities yet.
- **Calibrated frame-budget defaults per hardware tier** — budgets are per-project statements
  today.
- **Semantic occluder authoring** (IFC walls/slabs/floorplan → fitted occluders) — the
  `--occluders` pass is geometric only (AABB volume gate + shrunken box); it has not been
  benched for fps effect, and thin-wall coverage from a floorplan is unproven.

## RTK note

Prefix shell commands with `rtk` as usual (`rtk $GODOT …` passes through). Never reference rtk
inside `.gd` files.
