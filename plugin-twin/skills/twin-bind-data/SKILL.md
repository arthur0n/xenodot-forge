---
name: twin-bind-data
agents: [twin-architect, data-binder]
description: >-
  Bind live tag data to a digital-twin scene — the DataBus autoload contract (WebSocketPeer with the
  four gotchas that make it actually work), tag→node binding through the IFC GlobalId join,
  overlay/state response, and the seeded simulator as the deterministic test fixture. Use when
  wiring a live (or simulated) data stream into the viewer, when "the socket connects but nothing
  arrives" (poll), when frames back up or drop on reconnect, when binding a tag to a model element,
  or when a binding change needs a repeatable test source. NOT the IFC conversion/join itself
  (twin-import) and NOT scale work (twin-optimize).
---

# Twin bind-data (DataBus, GlobalId binding, seeded fixture)

Live data enters through ONE seam — the **DataBus autoload** — and reaches geometry through
ONE key — the **IFC GlobalId** (skill `twin-import` owns producing it). Everything here is
proven by the Phase 0 spike S2 (10 Hz stream, 0 drops, sub-ms latency, reconnect survival);
the protocol-adapter surface beyond WebSocket is Phase 3.

## The DataBus autoload contract

One autoload (`DataBus`, the viewer's one justified singleton — the starter-viewer ships it).
Consumers bind to its signals; nothing else touches the socket.

```gdscript
signal tag_update(tag: String, value: float, seq: int, latency_ms: float)
signal connection_changed(up: bool)
```

Frame shape on the wire (JSON per packet): `{tag, value, seq, sent_ms}`. The bus also exposes a
`stats()` dictionary (frames received/expected, drops, reconnects, latency min/avg/max) — the
binding smoke asserts against it (skill `twin-verify`).

### The four WebSocketPeer gotchas (each one cost the spike time — bake them in)

1. **`poll()` every frame or NOTHING happens.** WebSocketPeer does no background work; call
   `_ws.poll()` in `_process` unconditionally.
2. **`connect_to_url()` is async** — returns OK immediately; state walks
   `STATE_CONNECTING → STATE_OPEN` (or `CLOSED` on failure). Gate on `get_ready_state()`.
3. **Drain ALL pending packets each frame** (`while get_available_packet_count() > 0`) — a
   10 Hz stream backs up behind a per-frame single read under hiccups.
4. **Fresh peer per reconnect** — a CLOSED WebSocketPeer cannot be reliably reused; allocate a
   new `WebSocketPeer.new()` for every connection attempt, on a small cooldown. **Reset seq
   tracking on disconnect** — after a reconnect the source's seq numbering restarts/jumps, and
   stale last-seq state counts phantom drops.

## Tag → node binding (by GlobalId)

- The **binding map is data**: `tag → GlobalId` (JSON/dictionary, authored per the architect's
  design doc) — never per-tag `if` chains in scripts.
- Resolve `GlobalId → Node` once at load, using the join rules from `twin-import` (name or
  parent name; 22-char prefix under Godot name-dedup). Cache the lookup; the stream is per
  frame.
- Visual response per binding: normalize value into the tag's `[min, max]` range, then drive
  the node — material ramp (green→red albedo), `Label3D` text with value + latency, or a
  CanvasLayer HUD for aggregates. Unknown tag → ignore silently (the map is the filter);
  unknown GlobalId → **loud** (`push_warning`) — that's a stale map, a real bug.

## The data-binding runtime (implemented — `core/binding_map.gd`)

The runtime is a plain `Node` added under `Main` (NOT an autoload — the DataBus is the one
justified singleton; this composes on top of its `tag_update` signal). `main.gd` loads it when
`viewer.cfg [twin] binding_map=` points at a map (default `binding_map.json`), resolves it
against `%ModelHost`, and pushes a `bindings: N/M resolved` HUD line (via `overlay.set_bindings`).

### Binding map schema (agent-emitted JSON, NOT `.tres`)

The `data-binder` agent **emits JSON** — a data artifact it can author/regenerate deterministically,
diff, and validate — never a Godot resource. Project file `binding_map.json`:

```json
{
  "version": 1,
  "bindings": [
    {
      "tag": "pump_1.temp",
      "globalid": "<22-char IFC GlobalId>",
      "min": 20.0,
      "max": 90.0,
      "response": "albedo_ramp",
      "ramp": ["#00ff00", "#ff0000"]
    }
  ]
}
```

- Required per binding: `tag`, `globalid`, `min`, `max`, `response`, `ramp` (exactly two hex
  colours). **Typed-at-load**: the loader validates each row — unknown keys are tolerated, a row
  missing/mistyping a required field is `push_warning`'d and **skipped**, a malformed file yields
  0 bindings. It **never crashes** the viewer (a dead binding must not take the scene down).
- `t = clamp((value - min) / (max - min), 0, 1)`; `colour = ramp[0].lerp(ramp[1], t)`
  (`min == max` → `t = 1`, matching `tag_label_3d.gd`).

### Resolution index (built by one tree walk at scene (re)load)

`build_index(root)` walks `root` once and builds `GlobalId → Array[Locator]`, where each locator
is one of two kinds:

- **`node`** — a node whose name is a 22-char IFC GlobalId (the base64 IFC alphabet
  `0-9A-Za-z_$`; Godot's name-dedup suffix is stripped by taking the 22-char prefix, matching
  `twin-import`'s join). Response drives `material_override` on a **fresh per-target**
  `StandardMaterial3D` — never mutate the shared/imported material.
- **`mmi`** — a `MultiMeshInstance3D` carrying meta **`twin_globalids`** (`PackedStringArray`,
  **index = instance position**, emitted by `twin-optimize`'s `optimize_scene.gd`). Each entry
  becomes one locator `{node, index}`. Response drives `multimesh.set_instance_color(index, …)`.
  **`use_colors` must be true** on the MultiMesh; if it is false the runtime `push_warning`s once
  per node and skips (the optimizer enables `use_colors` on emitted fields).

**Duplicate-GlobalId caveat**: one GlobalId can resolve to **many** locators (a de-normalized IFC
export, or repeated equipment collapsed into a MultiMesh). All matched targets are driven by the
one binding — documented and intended; each target keeps its own render cache so they don't clash.

### Response table (v1)

| `response`    | node target                                  | mmi target                                  |
| ------------- | -------------------------------------------- | ------------------------------------------- |
| `albedo_ramp` | per-target `StandardMaterial3D.albedo_color` | `multimesh.set_instance_color(index, col)`  |
| `label`       | spawn a `TagLabel3D` above the node (once)   | spawn a `TagLabel3D` at the instance origin |

The `label` response reuses `overlay/tag_label_3d.gd` — spawn once, then it self-updates from the
DataBus (text + green→red ramp). `albedo_ramp` updates every frame.

## Seeded simulator = the fixture

Never develop binding against a source you can't replay. The seeded simulator — a plugin tool
materialized into the project at `tools/sim/server.js`
(`node tools/sim/server.js --seed 42 --port 8765 --hz 10 --map binding_map.json`) — is a WebSocket server
publishing JSON tag frames, **deterministic per (seed, tick)** via a seeded PRNG (mulberry32) —
same seed, same stream, every run. That determinism is what makes the `twin-verify` binding smoke a
real assert instead of a flake:

- Fix the seed in the smoke; assert `frames_received > 0`, `drops == 0`, and the bound node's
  state moved.
- **`--map binding_map.json` derives the tag list + each tag's `[min,max]` FROM the binding map
  itself** (the ranges double as the colour-ramp ranges), so the sim and the bindings can never
  drift. With no `--map` it falls back to a built-in 5-tag demo set.
- Flags: `--seed` (default 42), `--port` (8765), `--hz` (10), `--map`, `--stats <path>` (writes
  per-tag last-seq + frames-sent on exit, to cross-check the viewer's `stats()`).
- **No npm dependency, by design**: the sim is PLUGIN CAPABILITY (it lives in the xenodot-twin
  plugin at `plugin-twin/tools/sim/` and is materialized into every viewer project's `tools/`, so
  even wire-in-place viewers get it and it never drifts). The materialized `tools/` ships no
  `package.json`, so it must run under a bare `node tools/sim/server.js`. The sim is a minimal RFC6455 server
  on node's `http` + `crypto` (handshake + server→client unmasked text frames + just enough
  client-frame parsing to answer pings and honour close). It speaks only what a data source needs;
  Godot's `WebSocketPeer` and the framework relay (`ws`) both interoperate with it. Determinism is
  proven: two `--seed 42` runs produce byte-identical first-frame values; `--seed 99` differs.

## The relay seam — real sources (framework `ui/server/features/twin/twin-data.js`)

The seeded sim is the fixture; a **real** source (a plant WebSocket bridge, or an MQTT→WS bridge)
reaches viewers through the framework's **twin-data relay**. It holds ONE upstream connection and
fans its frames out to N browser/viewer clients on the WebSocket path **`/twin-data`**, reconnecting
to the source on drop without the viewers noticing (the real source is usually singular +
rate-limited; viewers come and go). It is **lazy** — no upstream connection until the first client,
dropped when the last leaves.

- Config: `.xenodot.json` `twin: { sourceUrl }` — read **fresh per (re)connect** via a getter in
  the twin feature (`getTwinConfig`, same live-read contract as `getCodexConfig`), so re-pointing
  the source needs no server restart. Env `TWIN_SOURCE_URL` overrides.
- The relay shares the existing session `WebSocketServer` (registered in `core/index.js`): it
  claims only `/twin-data` sockets; the session handler declines those via `isTwinDataPath`.
- **v1 is WebSocket-only.** There is NO MQTT/OPC-UA dependency — a protocol bridge plugs in behind
  `sourceUrl`, and that is the ONLY seam it needs (see the honest boundaries below).

## Phase 3 TODO — honest boundaries

Built and proven now: the binding-map runtime (`core/binding_map.gd` — loader, resolution index
incl. the `mmi`+index case, `albedo_ramp`/`label` responses), the seeded sim, and the WebSocket
relay seam (`/twin-data`, `sourceUrl`). Still NOT built or proven; do not claim them:

- **Real protocol adapters** — OPC-UA / MQTT / BACnet. The `sourceUrl` relay seam is where a
  WebSocket-fronted bridge (e.g. `mqtt→ws`) plugs in; the bridge itself is unbuilt. The relay is
  WebSocket-in / WebSocket-out only.
- **More responses** — v1 is `albedo_ramp` + `label`. No visibility/emission/animation responses,
  no CanvasLayer-aggregate response type in the map (the overlay HUD is hand-wired).
- **Historization / trends** — no time-series buffer, no trend overlay.
- **Alarm/threshold semantics** — the colour ramp is a demo response; a real alarm model
  (states, ack, hysteresis) is undesigned.
- **Binding-map authoring flow** — the map is agent-emitted/hand-authored data; no UI, no
  validation against the sidecar beyond the join check.
- **Multi-source / tag namespacing** — one stream, flat tag names.

## RTK note

Prefix shell commands with `rtk` as usual; the simulator (`node tools/sim/server.js`) and `$GODOT`
pass through. Never reference rtk inside `.gd` files.
