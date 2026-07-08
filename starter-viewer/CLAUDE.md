# <Your twin> — viewer conventions

This repo is a **digital-twin viewer**, not a game. It renders an external 3D model and
live process data on top of it; it has no gameplay, levels, or win state. The AI framework
that builds it — agents, `godot-*`/`twin-*` skills, the verify/gen tools — loads from the
**xenodot** (+ **xenodot-twin**) Claude Code plugins (the single source of truth); it is
**not** in this repo. Its working files appear here only as gitignored, generated paths:
`tools/` (copied from the plugin) and `library/` (a symlink to the plugin's knowledge base).
Twin-specific skills/agents you author live in this repo's `.claude/` until you promote
them to the framework (`npm run promote -- …`).

Record only **this twin's** conventions below — keep it thin (decisions here, not in chat).

## Layout

- `main.tscn` / `main.gd` — the viewer shell: environment, camera rig (Tab toggles
  orbit/fly, Esc exits fly), runtime model loading, placeholder grid when no model is set.
- `core/` — infrastructure: `data_bus.gd` (the DataBus autoload), `camera_rig.gd`,
  `recording.gd` (parsed twin-recording data model) + `playback.gd` (the player node).
- `overlay/` — HUD (`overlay.tscn`) + reusable binders (`tag_label_3d.gd`, a Label3D
  pinned to one tag with a green→red value ramp) + `timeline.tscn`/`timeline.gd` (the
  playback scrub bar; hidden unless a recording is loaded).
- `models/` — GLB models + `<name>_props.json` property sidecars (gitignored; delivered by
  `twin-import`). Models load at **runtime** via GLTFDocument — never imported as assets.
- `viewer.cfg` — per-deployment config: `[viewer] url="ws://..."` (DataBus source),
  `model="res://models/….glb"` (auto-load on boot), `[twin] binding_map=` and
  `recording=` (a twin-recording NDJSON to play back instead of live data).
  `--model=<path>` / `--recording=<path>` / `--screenshot=<png>` user args (after `--`)
  override/extend it.

## DataBus contract

`DataBus` (autoload, `core/data_bus.gd`) is the single ingress for live data. One JSON
object per WebSocket packet: `{"tag", "value", "seq", "sent_ms"}`. It emits
`tag_update(tag: String, value: float, seq: int, latency_ms: float)` and
`connection_changed(up: bool)`; consumers only ever connect to these two signals — nothing
else in the project touches sockets. Access it by PATH, typed via a preload const
(`const DataBusScript := preload("res://core/data_bus.gd")` +
`@onready var _data_bus: DataBusScript = get_node("/root/DataBus")`), never by the
`DataBus` global — the per-file `--check-only` gate does not inject autoload names
(godot-code-rules). It reconnects forever (fresh peer per attempt, 1 s
delay, quiet while the source is down) and exposes `stats()` (frames/drops/reconnects/
latency, plus `frames_injected`) for the overlay and verification bots.

The bus has two modes (`set_mode`, public `mode` field): `MODE_LIVE` (socket, default)
and `MODE_PLAYBACK` — the socket is closed, reconnect stops, and frames arrive only via
`inject_frame(tag, value, seq)` (latency 0; counts into `frames_injected`, never into
the transport stats). `inject_frame` is the public playback/gate seam; consumers cannot
tell modes apart (same signals), and only the overlay reads `mode` to colour its status
line LIVE green / PLAYBACK amber / OFFLINE red. Entering playback emits
`connection_changed(false)` unconditionally so HUDs re-evaluate on the mode edge.

## Playback (recorded tag streams)

A **twin-recording** is NDJSON (written by the plugin's recorder,
`tools/sim/record.js`; parsed by `core/recording.gd` — the pinned shared contract):
line 1 header `{"version":1,"kind":"twin-recording","hz":int,"seed":int,"tags":
[{"tag","min","max"},…]}` (seed `-1` = live capture), then one frame per line
`{"t_ms":int,"tag":str,"value":float,"seq":int}`, t_ms ascending, relative to start.
Malformed files are `push_warning`'d and rejected whole — never crash the viewer.

`core/playback.gd` (plain Node under Main, wired by `main.gd._start_playback`) drives
the SAME binding runtime as live data through `DataBus.inject_frame`. Public API:
`load_recording(path)`, `play()`, `pause()`, `seek(t_ms)`, `set_speed(x)` (clamped
0.25–8), `speed()`, `duration_ms()`, `position_ms()`, `is_playing()`, `is_loaded()`;
signals `playback_loaded(duration_ms, tag_count)` and
`playback_state(playing, position_ms, duration_ms)` (rate-limited to 10 Hz while
playing). Seek semantics (pinned): emit the last frame ≤ T per tag in header order,
then continue from T. End of recording pauses at the end (no auto-loop). The clock is
accumulated `delta * speed`, so `--headless --fixed-fps` runs are exactly reproducible.

The timeline bar (`overlay/timeline.gd`) is the one script allowed to know playback
exists. Keys: **Space** = play/pause (only while the bar is visible).

## Verify

`xenodot:godot-verify` is the deterministic gate (format → lint → strict parse → scenes →
smoke), and `xenodot-twin:twin-verify` layers the twin checks (model join, DataBus liveness)
on top. The strict warnings-as-errors block in `project.godot` is the contract — never
weaken it.

## Project conventions

_(empty — the `godot-project-conventions` skill fills this in on first setup.)_
