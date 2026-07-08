---
type: finding
title: "Twin optimizer benchmark — city block of 100/400 duplexes, before vs after, measured"
description: "Composite scene of repeated real BIM (duplex.glb x100/x400): at 114,400 meshes the aerial view goes 27.3 -> 119.4 fps (4.4x, after still display-capped) with --chunks=2; render-thread submit -98%. Default --chunks=8 REGRESSES (120 -> 50 fps) at ~100 instances/group; macOS caps presentation at 120 Hz even with vsync off; Forward+ already merges repeated identical surfaces; join gate 100% via twin_globalids metas."
timestamp: 2026-07-08T18:30:00+01:00
tags: [multimesh, benchmark, optimizer, chunking, metal, macos]
---

# Twin optimizer benchmark — city block of 100/400 duplexes, before vs after, measured

Evidence: scratch viewer project (`tools/gen_city.gd`, `models/bench_city*.json`,
`models/report_city*.json`); harness `tools/bench_scene.gd` (extended this run: `gpu_ms`/`cpu_ms`
capture + a vantage-camera fix — `Node3D.look_at()` silently no-ops during `SceneTree` init, so
aerial vantages had been rendering NOTHING; now `Basis.looking_at`). One machine: M3 Pro,
macOS, Metal (Forward+), Godot 4.6.3, 1280x720 window, 120 Hz ProMotion display.

## Scenario

`duplex.glb` (real BIM, 286 meshes / 224 distinct mesh groups) loaded once, its tree duplicated
into a 10x10 grid at 30 m pitch → **28,600 MeshInstance3Ds** (224 groups x ~100 instances plus
uniques), one shadowless DirectionalLight3D + flat ambient. GlobalId node names preserved
verbatim per copy (ids DUPLICATE across copies — see join note). Supplement: same at 20x20
→ **114,400 meshes**. Vantages: street level inside the block (1.7 m, looking down a street)
and high aerial oblique (whole block in frustum).

```sh
$GODOT --headless --path . --script tools/gen_city.gd -- --out=models/city_before.scn   # 0.74 s
$GODOT --headless --path . --script tools/optimize_scene.gd -- \
    --in=res://models/city_before.scn --out=res://models/city_after.scn \
    --report=models/report_city.json                                                    # 0.9 s
#   ... --chunks=2 --out=res://models/city_after_c2.scn                                 # 0.6 s
#   ... --occluders --vis-ranges --out=res://models/city_after_full.scn                 # 0.9 s
$GODOT --path . -s tools/bench_scene.gd -- res://models/city_after.scn \
    --vantage 139.5,1.7,135:139.5,1.7,0 --warmup 2 --measure 10 --out models/bench_city.json
```

## Numbers — 10x10 (28,600 meshes)

optimizer (defaults, chunks=8): 224/224 groups instanced, 14,336 multimeshes (~2 instances
each), nodes 28,703 → 14,440, est draw items 34,800 → 15,424. chunks=2: 896 multimeshes
(~32 each), nodes → 1,000, est 964. `--occluders`/`--vis-ranges` added **0** of each — they
only touch un-instanced meshes and everything instanced (city_after_full == city_after; its
rows below are the run-to-run noise floor: ~0.5% fps, ~0.03 ms cpu).

| scene           | vantage | fps         | frame_ms | cpu_ms | draw_calls | objects | primitives |
| --------------- | ------- | ----------- | -------- | ------ | ---------- | ------- | ---------- |
| before          | street  | 119.8 (cap) | 8.35     | 1.54   | 1,828      | 11,829  | 0.81M      |
| before          | aerial  | 120.0 (cap) | 8.34     | 5.72   | 5,536      | 40,500  | 2.77M      |
| after (c8)      | street  | 119.6       | 8.36     | 2.79   | 5,279      | 5,279   | 0.91M      |
| after (c8)      | aerial  | **50.3**    | 19.89    | 9.14   | 17,344     | 17,344  | 2.77M      |
| after_full (c8) | street  | 120.0       | 8.33     | 2.79   | 5,279      | 5,279   | 0.91M      |
| after_full (c8) | aerial  | 50.0        | 19.99    | 9.17   | 17,344     | 17,344  | 2.77M      |
| after (c2)      | street  | 120.0 (cap) | 8.33     | 0.37   | 542        | 542     | 1.39M      |
| after (c2)      | aerial  | 120.0 (cap) | 8.33     | 0.53   | 1,084      | 1,084   | 2.77M      |

Deltas (before → c2): fps flat at the display cap both vantages; render-thread submit
**−76% street (1.54 → 0.37 ms), −91% aerial (5.72 → 0.53 ms)**; draw calls −70%/−80%.
Before → c8 aerial: **fps −58% (120 → 50.3)** — the defaults REGRESS here.

## Numbers — 20x20 supplement (114,400 meshes; before finally below the cap)

| scene      | vantage | fps         | frame_ms | cpu_ms | draw_calls | objects | primitives |
| ---------- | ------- | ----------- | -------- | ------ | ---------- | ------- | ---------- |
| before     | street  | 99.3        | 10.07    | 7.46   | 6,802      | 49,458  | 3.38M      |
| before     | aerial  | **27.3**    | 36.64    | 28.98  | 21,787     | 162,000 | 11.1M      |
| after (c2) | street  | 120.0 (cap) | 8.33     | 0.37   | 542        | 542     | 5.55M      |
| after (c2) | aerial  | **119.4**   | 8.37     | 0.56   | 1,084      | 1,084   | 11.1M      |

**Headline: aerial 27.3 → 119.4 fps (+337%, ≥4.4x — the after is STILL display-capped, so the
true ratio is larger); frame 36.6 → 8.4 ms; render-thread 28.98 → 0.56 ms (−98%); draw calls
−95%.** Street: 99.3 → 120 (cap-limited +21%; cpu −95% says the real headroom is much larger).
Optimizer wall-clock on 114,400 meshes: **1.3 s** (gen 2.9 s).

## What this run taught us (beyond the fps table)

- **Chunk count must match instance density — the default can be net-negative.** `--chunks=8`
  on ~100-instance groups makes 64 cells x 224 groups = 14,336 multimeshes of ~2 instances:
  pure per-object overhead, aerial fps −58%. `--chunks=2` (~32/chunk) wins everything. This
  turns the skill's "automatic chunk-size selection" TODO from folklore into a measured need:
  target tens-of-instances per chunk, not a fixed grid.
- **macOS caps frame PRESENTATION at the display refresh (120 Hz) even with
  `VSYNC_DISABLED`.** An empty scene benches at exactly 120.0. Any config at the cap reads
  flat fps; below-cap deltas are real. `bench_scene.gd` now records the viewport's measured
  render time — `cpu_ms` (render-thread submit) is the sub-cap differentiator; `gpu_ms`
  returns 0.0 on this Metal setup (unsupported), reported anyway for platforms where it works.
- **Godot 4.6 Forward+ already auto-merges repeated identical surfaces** — the unoptimized
  scene shows draw_calls FAR below objects_rendered (49,458 objects → 6,802 calls). So
  `est_draw_items_before` is a scene-graph estimate, not GPU truth, and the naive "N meshes =
  N draw calls" pitch overstates the before-cost. What the optimizer actually removes at scale
  is per-object culling/sorting/submit overhead (162,000 objects → 1,084), which is exactly
  where the 27 fps went.
- **Chunk culling is coarser than per-node culling**: at street level the before scene culls
  to 0.81M primitives, c2 draws 1.39M (+72% GPU work) yet still wins on frame time — the M3
  Pro absorbs primitives; it was choking on object count. On weaker GPUs re-measure before
  copying the verdict.
- **`--occluders`/`--vis-ranges` are no-ops on fully-instanced scenes** (0 added — both passes
  only consider meshes that stayed un-instanced). On repeated-geometry scenes the instancing
  pass consumes everything; those flags only matter for mostly-unique models like bare duplex.

## Join gate on the optimized scene (duplicate ids — honest read)

`check_twin_join.gd --scene=models/city_after.scn --sidecar=models/duplex_props.json`
→ `SIDECAR_KEYS=295`, `JOIN-SOURCES: mesh_nodes=0 multimesh_ids=28600`,
`JOIN: 28600/28600 (100.0%)`, `JOIN-GATE: OK (min 95.0%)`, exit 0. Semantics: every
`twin_globalids` entry counts as one candidate matched by exact sidecar-key lookup, so the 100
copies of each GlobalId are 100 candidates that each match — the gate proves "every rendered
instance resolves to a property record", NOT unique-id coverage; it cannot exceed 100%. Caveat
for real sites: duplicated ids mean per-instance data binding (`set_instance_color`) would
paint all 100 copies identically — multi-building scenes need per-building-unique ids upstream.

## Caveats

One machine (M3 Pro, Metal, macOS, Godot 4.6.3), one window size (1280x720), shadows OFF
(single shadowless directional + flat ambient — shadow passes would re-rank everything),
no occlusion-culling occluders in any measured scene, fps ceiling-limited at 120 by the OS,
10 s measure / 2 s warmup, sequential same-session runs. Recipes generalize; the exact
percentages are this machine's.
