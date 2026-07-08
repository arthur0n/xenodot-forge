# tools/CAPABILITIES-twin.md — registered xenodot-twin tools

Materialize merges these into the project's `tools/` **alongside the base xenodot plugin's**
(`validate.sh`, `lib/checks.sh`, `verify_scene.gd`, …) — twin scripts compose the shared
`tools/lib/checks.sh` from the merged set; nothing from the base plugin is copied here.

## `ifc_convert.py` — IFC → GLB + property sidecar

```
python tools/ifc_convert.py <model.ifc> [--glb out.glb] [--sidecar out.json]
```

Converts an IFC model to GLB with node names carrying the IFC GlobalIds
(`use-element-guids`), and writes a property sidecar JSON keyed by GlobalId
(`get_psets`, `json.dump default=str`). Validates the STEP header first — the guard
against dead sample URLs that download HTML.

Needs a **Python 3.12** venv with `ifcopenshell==0.8.5` (3.14 has no wheel) — setup in
skill `twin-import`. No engine needed.

## `optimize_scene.gd` — the scene optimizer

```
$GODOT --headless --path . --script tools/optimize_scene.gd -- \
    --in=<model.glb|scene.tscn> --out=<optimized.scn> --report=<report.json> \
    [--chunks=auto|N] [--target-per-chunk=32] [--min-instances=8] \
    [--hints=<hints.json>] [--occluders] [--vis-ranges]
```

Groups repeated meshes into region-chunked MultiMesh fields (auto-sized per group by
default), preserving the GlobalId join as `twin_globalids` metadata; applies hint-sidecar
directives (`no_instance` / `occluder` / `lod_end` / `tags` → persistent groups +
metadata); optional occluder and visibility-range passes. Emits a full report JSON.
Helpers live in `tools/lib/twin_chunks.gd` (grid + emission) and `tools/lib/twin_hints.gd`
(hint contract). Recipe, measured numbers and knob guidance: skill `twin-optimize`.

## `verify_twin.sh` — the twin builder's gate

```
tools/verify_twin.sh [scene.tscn]
```

The shared static floor (`tools/lib/checks.sh`, same functions as `validate.sh`, labelled
`verify-twin:`), then the twin checks in order: GlobalId **join coverage**
(`check_twin_join.gd`, auto-discovered model/sidecar pair or `TWIN_MODEL`/`TWIN_SIDECAR`),
the seeded **data-binding smoke** (spawns `sim/server.js` on `TWIN_SIM_PORT`, always reaps
it), **playback determinism** (synthesizes a fixture, runs `check_playback.gd` twice,
gates the two hashes equal, cleans up), and the **frame-budget** bench (opt-in
`TWIN_BENCH=1`, needs a display). Every check SKIPs loudly when its prerequisites are
missing — a SKIP is not a pass.

Headless OK for everything except the frame budget; stops at the first failure; exit 0 =
OK. Gate contract: skill `twin-verify`.

## `check_twin_join.gd` — GlobalId join gate

```
$GODOT --headless --path . --script tools/check_twin_join.gd -- \
    --scene=<model.glb|scene.tscn> --sidecar=<props.json> [--min=0.95]
```

Joins the scene's candidate GlobalIds — named `MeshInstance3D` nodes **and**
`twin_globalids` metadata on optimized MultiMesh nodes — against the sidecar keys.
Prints `JOIN: <matched>/<total>` then `JOIN-GATE: OK|FAIL`, exit 0/1.

## `bench_scene.gd` — frames-drawn fps benchmark

```
$GODOT --path . -s tools/bench_scene.gd -- <scene.tscn> \
    [--vantage X,Y,Z:LX,LY,LZ] [--warmup 2] [--measure 8] [--out .xenodot/bench/x.json]
```

The only honest fps on macOS — process-loop fps lies when drawing suspends. Forces vsync
off + window always-on-top, warms up, measures, prints a `BENCH:` JSON row (fps,
frame_ms, cpu_ms/gpu_ms, draw calls, primitives) and optionally appends it to a file.

Requires a display: `--headless` prints `BENCH: SKIP` and exits 0. Methodology: skill
`twin-optimize`; the budget gate that consumes it: skill `twin-verify`.

## `sim/server.js` — seeded tag simulator

```
node tools/sim/server.js [--seed 42] [--port 8765] [--hz 10] \
    [--map binding_map.json] [--stats out.json]
```

The deterministic data-binding test fixture: a dependency-free RFC 6455 WebSocket server
(bare `node`, no npm install) publishing JSON tag frames `{tag,value,seq,sent_ms}` — the
DataBus wire shape — at a fixed rate. Values are a pure function of `(seed, tick, tag)`:
the same seed replays bit-for-bit. `--map` derives the tag list and each tag's
`[min,max]` from the binding map itself, so sim and bindings can never drift.

Shared internals — one source, no forks: `sim/stream.js` (the deterministic core),
`sim/protocol.js` (RFC 6455 framing, both directions), `sim/recording.js` (the NDJSON
recording contract). Fixture contract: skill `twin-bind-data`.

## `sim/record.js` — twin-stream recorder

```
# fixture mode (no network, byte-reproducible per seed — sha256 printed):
node tools/sim/record.js --out fixture.ndjson --seconds 30 [--seed 42] [--hz 10] [--map binding_map.json]

# live mode (records a running source):
node tools/sim/record.js --out capture.ndjson --url ws://localhost:8765 [--seconds 30]
```

Two modes, one NDJSON contract (`sim/recording.js`): a header line
`{version, kind:"twin-recording", hz, seed, tags[]}` then frames `{t_ms,tag,value,seq}`
ascending. **Fixture mode** synthesizes the exact stream the sim would send (same
`tagValue`, same tag table, `t_ms = tick·1000/hz`) — same seed+args yield a
byte-identical file, the foundation of the playback determinism gate. **Live mode**
connects as an RFC 6455 client (masked frames, validated Accept), stamps `t_ms` from the
first frame on a monotonic clock, derives header `hz` from the observed cadence, and
marks the file `seed:-1` — recorded, not synthesizable (its `seq` is also not zero-based;
playback keys on `t_ms`).

Bare `node`; no engine needed. Without `--seconds`, SIGINT flushes and summarizes.
Playback consumes these files (starter-viewer `core/recording.gd`). Contract: skill
`twin-playback`.

## `check_playback.gd` — playback determinism gate

```
$GODOT --headless --fixed-fps 60 --path . --script tools/check_playback.gd -- \
    --recording=<fixture.ndjson> [--seek=t1,t2] [--out=emitted.txt]
```

Drives the SHIPPED player (`core/playback.gd`) and the real DataBus autoload through
their public seams only: load → seek (each snapshot asserted against an **independent**
last-frame-≤T-per-tag recompute — the gate has its own parser, so the check is not
circular) → play a bounded window → pause. Hashes the emitted `tag|value|seq` sequence
and prints `PLAYBACK-HASH: <sha256>` + `PLAYBACK-GATE: OK|FAIL`. Also asserts monotonic
emission, transport honesty (`frames_injected>0` while `frames_received==0`) and the
end-of-recording pause.

Two runs of the same fixture+seeks printing the SAME hash **is** the determinism check —
that's what `verify_twin.sh` gates. Synthesized fixtures only (`seed>=0`); the hash is
order-exact, so it is stable across cold/warm engine starts. Contract: skill
`twin-playback`.

## Referenced (NOT bundled) — base xenodot capabilities

Twin sessions load both plugins; these resolve from the base plugin / the merged project
`tools/`:

- `xenodot:godot-verify` — the verification floor `twin-verify` step 1 delegates to.
- `xenodot:godot-code-rules` — strict GDScript rules every twin `.gd` follows.
- `xenodot:godot-export-builds` — shipping a distributable viewer build.
- `tools/lib/checks.sh`, `validate.sh`, `verify_scene.gd`, `verify_render.gd` — the base
  gate scripts `verify_twin.sh` composes or defers to (materialized from the base plugin).
