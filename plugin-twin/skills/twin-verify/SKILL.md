---
name: twin-verify
agents: [twin-architect, scene-optimizer, data-binder]
description: >-
  Verify a digital-twin viewer actually works — the base xenodot:godot-verify layers (property
  validation, smoke run, render health) PLUS the three twin-specific gates none of them cover: the
  frame-budget gate (bench vs the stated budget), the data-binding smoke (seeded sim → assert
  overlay state moved), and the GlobalId join coverage check. Use after ANY .tscn/.gd change in the
  viewer and before claiming work done — and specifically before reporting a performance win (budget
  gate), a binding feature (binding smoke), or a fresh model import (join coverage). The composed
  gate is tools/verify_twin.sh.
---

# Twin verify (base floor + twin gates)

Verification is layered: the **base floor is `xenodot:godot-verify`** — do not reimplement it.
Then three twin-specific gates catch what a game-shaped verify never looks for: a viewer that
renders beautifully but misses its frame budget, paints no live data, or lost its join keys.

`tools/verify_twin.sh` composes the static floor (the shared `tools/lib/checks.sh` functions —
the same library `validate.sh` composes) plus the twin checks. Run it from the project root.

## Step 1 — DELEGATE to `xenodot:godot-verify` (the floor)

Load and follow the base skill `xenodot:godot-verify` for property validation (silently-dropped
properties), the headless smoke run, and render health (windowed). Its layers, pass criteria,
hand-authoring rules, and error table apply to the viewer unchanged — this skill does not
restate them. `tools/verify_twin.sh` runs its layers 1–2 equivalent via the shared check
library; the windowed render layer remains yours to run per that skill when an entry-point
scene changed.

Everything below is what the base skill does NOT cover.

## Step 2 — frame-budget gate (twin)

The architect's design doc states a frame budget (fps floor, vantage, instance count).
`verify_twin.sh` gates it against `frame_ms` from the bench row. Budget source precedence:

1. `TWIN_FRAME_BUDGET_MS=<ms>` env — wins always;
2. `viewer.cfg` in the project root:

   ```ini
   [twin]
   frame_budget_ms=16.7
   ```

3. neither → **loud SKIP** ("no budget stated" — an architect finding, not a pass).

The bench needs a **real window** (frames-drawn methodology, `twin-optimize`), and the gate
usually runs in an agent/headless context — so the windowed bench is **opt-in**:

```bash
TWIN_BENCH=1 tools/verify_twin.sh [scene.tscn]      # runs bench_scene.gd, gates frame_ms vs budget
$GODOT --path . -s tools/bench_scene.gd -- <scene.tscn> --vantage <pos> --out .xenodot/bench/<slug>.json
```

- Without `TWIN_BENCH=1` (or when the bench prints `BENCH: SKIP` under a headless renderer)
  the gate **SKIPs loudly** with the exact windowed command — a SKIP is not a pass; say
  "budget gate not run (no display)".
- **PASS** iff `frame_ms <= budget` (`verify-twin: PASS frame-budget (frame_ms=X <= budget Yms)`),
  i.e. measured fps ≥ budget at the stated vantage/count. For an optimization slice, the report
  needs BEFORE and AFTER rows, both vantage classes.
- fps is the **frames-drawn delta** number, vsync off — the methodology contract is in
  `twin-optimize`; `bench_scene.gd` implements it (warmup, measure window, monitor averages).

## Step 3 — data-binding smoke (twin) — LIVE

Proves the live path end-to-end, **headless**: seeded sim → DataBus → `binding_map` → visible
state. `verify_twin.sh` runs it automatically (`tools/smoke_binding.gd`); the fixture discipline
lives in `twin-bind-data`. The smoke drives the **REAL viewer shell** (`main.tscn`: the DataBus
autoload + `main.gd`'s BindingMap wiring), not a reimplementation — so it exercises exactly what
ships. Standalone:

```bash
node tools/sim/server.js --seed 42 --port 8899 --hz 10 --map binding_map.json &
$GODOT --headless --path . --script tools/smoke_binding.gd -- \
    --map=binding_map.json --url=ws://localhost:8899 [--scene=main|<optimized.tscn>] [--seconds=S]
```

Each assertion prints its own line, then a verdict `BIND-SMOKE: OK` (exit 0) /
`BIND-SMOKE: FAIL — <reason>` (exit 1):

- **a. Stream health** — DataBus up (`connection_changed` within timeout), `frames_received > 0`,
  `drops == 0` (the seeded stream is deterministic; a drop is a bus bug).
- **b. Resolution** — `resolved_count == total_count` and `total_count >= 1` (a miss is a stale
  map — the binder `push_warning`s it, so the static smoke also catches it before this step).
- **c. Node drive** — ≥ 1 NODE-target binding's `material_override.albedo_color` is **non-white
  AND changes** between two samples ~1 s apart. Headless-safe: `material_override` is a
  CPU-readable property. A viewer that connects but paints nothing FAILs here.
- **d. MMI targets (windowed-only)** — under the **headless dummy renderer** both
  `get_instance_color` and the `MultiMesh.buffer` colour floats read BLACK regardless of
  `set_instance_color`, so instance-colour equality is **not assertable headlessly**. The smoke
  instead asserts the write path is **wired** (`use_colors == true`, index in range) and prints
  `MMI-SMOKE: WINDOWED-ONLY …` — a documented partial, **never a failure**. Confirm the actual
  colour in a windowed render (step 1) when an MMI binding matters.

**Sim conventions**: fixed **seed 42**, port **`TWIN_SIM_PORT` (default 8899)** — chosen
deterministically; the gate FAILs loudly if the port is busy (override `TWIN_SIM_PORT`). The sim
is **always reaped** (EXIT trap + explicit `kill` + `pkill -f tools/sim/server.js`), so no stream server
survives the gate. Binding-map source precedence (must match the map the viewer loads): **1.**
`TWIN_BINDING_MAP` env → **2.** `viewer.cfg [twin] binding_map=` → **3.** `binding_map.json`. No
map found → **loud SKIP** naming the precedence (a SKIP is not a pass).

Run it after ANY binding/overlay change. Without a display the state asserts still run headless;
only the MMI "visibly rendered" claim needs the windowed render layer (step 1).

### Hint-group assertion (optimizer's hint pass)

When `TWIN_MODEL` is an **optimized scene** (`.tscn`/`.scn`) with a sibling `<base>_hints.json`
(the hints file that produced it), `verify_twin.sh` also runs `smoke_binding.gd --mode=hints`: it
asserts the optimized scene carries a node in **each group the hints' used keys materialise**
(`no_instance → twin_no_instance`, `occluder → twin_occluder`) — the simplest honest proof the
optimizer's hint pass landed. Verdict `HINTS-SMOKE: OK|FAIL`. Silent no-op for a raw model or when
no sibling hints file exists (the common case).

## Step 4 — GlobalId join coverage (twin)

After any model (re)import, join-code change, or optimization pass, `verify_twin.sh` runs the
headless join gate `tools/check_twin_join.gd` — it also works standalone:

```bash
$GODOT --headless --path . --script tools/check_twin_join.gd -- \
    --scene=models/model.glb --sidecar=models/model_props.json [--min=0.95]
```

Candidate GlobalIds come from **both** sources, so the gate survives optimization:

1. **named `MeshInstance3D` nodes** — guid on the node or its parent grouping node; Godot
   dedup suffixes handled (a GlobalId is exactly 22 chars);
2. **`twin_globalids` metadata arrays** (`PackedStringArray`) on optimized nodes — the
   MultiMeshInstance3D batches `twin-optimize` emits; each id counts individually. A node
   carrying the meta is counted by its ids only, never double-counted by name.

Output contract (machine-parseable, then exit 0/1):

```
JOIN-SOURCES: mesh_nodes=<n> multimesh_ids=<m>
JOIN: <matched>/<total> (<pct>%)
JOIN-GATE: OK|FAIL (min <pct>%)
```

- **PASS** at ~100% (gate default `--min=0.95`; a handful of legitimately unnamed helper
  nodes may miss; a double-digit miss rate is a broken conversion).
- Model+sidecar pair source precedence in `verify_twin.sh`: `TWIN_MODEL` + `TWIN_SIDECAR`
  env → auto-discovery (newest `.glb` under `models/` and `x-shared-assets/` with a sibling
  `<base>_props.json` or `<base>.props.json`). No pair found → **loud SKIP** with the env-var
  hint — a SKIP is not a pass. Threshold override: `TWIN_JOIN_MIN=<ratio>`.
- On FAIL, diagnose from `MISS_SAMPLE` per the `twin-import` error table — never carry a
  low-join model into binding work.

## Step 5 — playback determinism (twin)

After any recording/playback change, `verify_twin.sh` runs the playback-determinism gate
`tools/check_playback.gd` (contract + recorder/player details: skill `twin-playback`). It
synthesizes a byte-reproducible fixture (`tools/sim/record.js` fixture mode), then runs the gate
**twice** over the same fixture + seeks and asserts the two `PLAYBACK-HASH` lines are **IDENTICAL** —
that equality IS the determinism gate. Standalone:

```bash
node tools/sim/record.js --out /tmp/fx.ndjson --seconds 3 --seed 42 --hz 10
$GODOT --headless --fixed-fps 60 --path . --script tools/check_playback.gd -- \
    --recording=/tmp/fx.ndjson --seek=966,1933      # run twice; diff the PLAYBACK-HASH lines
```

The gate drives the SHIPPED runtime (real DataBus autoload + real `core/playback.gd`) through
public seams only and asserts, each on its own line before `PLAYBACK-GATE: OK|FAIL`:

- **snapshot correctness per seek** — the frames injected on `seek(T)` equal an INDEPENDENT
  last-frame-≤T-per-tag recompute (a real cross-check of the player, not a tautology);
- **monotonic emission during play** — seq never steps backward while draining a play window;
- **transport honesty** — `frames_injected > 0` while `frames_received == 0` (playback drove the
  frames; no live frame leaked in — the amber-PLAYBACK source is the ONLY source);
- **end-of-recording pause** — play to the end auto-pauses AT the duration (no auto-loop).

Details that matter: **SYNTHESIZED fixtures ONLY** (`seed >= 0` is byte-reproducible; a live capture
is `seed:-1` with non-zero-based seq — observation, not a reproducible anchor). **`--fixed-fps` is
required** by contract; the emitted-state hash is order-exact (reproduces at any frame rate), so the
two-leg comparison is robust. **Loud SKIP** (a SKIP is not a pass) when `node`, `tools/sim/record.js`,
`tools/check_playback.gd`, or `core/playback.gd` is missing. The synthesized fixture is always cleaned
(EXIT trap), like the binding-smoke sim.

## Pass criteria

1. `xenodot:godot-verify` floor: per that skill (verify_twin.sh runs its headless layers;
   windowed render per the base skill when an entry-point scene changed).
2. Frame-budget gate: `verify-twin: PASS frame-budget` (measured `frame_ms` ≤ budget at the
   stated vantage), or an explicit SKIP with reason (no display/`TWIN_BENCH` unset / no budget
   stated — the latter is an architect finding, not a pass).
3. Binding smoke: `BIND-SMOKE: OK` (exit 0) for any binding/overlay change — stream health,
   full resolution, and ≥ 1 node target visibly moving; MMI targets flagged
   `MMI-SMOKE: WINDOWED-ONLY` (headless dummy renderer, not a failure). Loud SKIP only when the
   sim/smoke fixtures or a binding map are genuinely absent (a SKIP is not a pass).
4. Join coverage: `JOIN-GATE: OK` at ~100% for any import/join/optimization change (both
   sources: named MeshInstance3D nodes + `twin_globalids` metas).
5. Playback determinism: `verify-twin: PASS playback-determinism` for any recording/playback
   change — two `check_playback.gd` legs over the same synthesized fixture + seeks print the SAME
   `PLAYBACK-HASH`, each leg's `PLAYBACK-GATE: OK`. Loud SKIP only when node/the recorder/the gate
   script/the player is genuinely absent (a SKIP is not a pass).

If the engine binary or a display is unavailable: say so explicitly — never claim a layer you
didn't run.

## RTK note

Prefix shell commands with `rtk` as usual. `tools/verify_twin.sh`, `$GODOT`, and
`node tools/sim/server.js` run without an rtk filter (passthrough). Do not pipe gate output into
`rtk grep` — it can hide FAIL lines; use plain `grep` inside pipes.
