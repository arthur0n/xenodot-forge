---
name: twin-playback
agents: [data-binder]
description: >-
  Record and replay a twin's tag stream deterministically — the twin-recording NDJSON contract, the
  recorder (byte-reproducible synthesized fixtures + live capture), the viewer's playback player
  (load/seek/play/pause/speed through the same DataBus.inject seam live data uses), and the playback
  DETERMINISM gate (same fixture + same seeks → identical emitted-state hash). Use when recording a
  session for replay, scrubbing a recording in the viewer, wiring the timeline bar, reasoning about
  seek/speed semantics, or when a playback change needs a repeatable determinism check. NOT the live
  DataBus wiring itself (twin-bind-data) and NOT the IFC join (twin-import).
---

# Twin playback (record, replay, determinism gate)

A **twin-recording** captures the tag stream so it can be replayed into the SAME binding runtime as
live data — bindings, labels, and the overlay never know playback exists; they see only DataBus
signals (the pinned Phase-4 consumer invariant). Recording + replay must be **reproducible**: the
same recording driven the same way paints the same thing every run. That reproducibility is what the
determinism gate enforces, and it rests on ONE foundation — the recorder's synthesized fixtures are
**byte-identical per args**.

## The recording format (PINNED cross-agent contract)

NDJSON, written by `tools/sim/record.js` and parsed by `core/recording.gd` — the encoder lives once
in `tools/sim/recording.js`, so the two sides cannot fork. Do not deviate on either side.

```
line 1 (header):  {"version":1,"kind":"twin-recording","hz":<int>,"seed":<int>,
                   "tags":[{"tag":str,"min":float,"max":float}, ...]}
every next line:  {"t_ms":<int>,"tag":str,"value":float,"seq":<int>}
```

- `t_ms` is integer milliseconds **relative to recording start**, frames ordered **ascending**.
- `kind` + `version` are discriminators — the viewer rejects an arbitrary NDJSON file, and a future
  `version:2` needs explicit migration, never a best-effort parse.
- **`seed` semantics** — `seed >= 0` ⇒ a **synthesized** fixture, re-derivable bit-for-bit from
  `(seed, seconds, hz, map)`. **`seed:-1`** (`SEED_RECORDED`) ⇒ a **live capture**: the wire carries
  no seed, so the file says "recorded, not synthesized." Gates branch on this: only `seed >= 0`
  files are reproducible inputs.
- **Live-seq gotcha** — a live capture's `seq` is **NOT zero-based**: the source counts ticks while
  the recorder is connecting/away, so the first captured `seq` is whatever the source was on. Header
  `hz` for a live capture is **derived from the observed cadence**, and each tag's `min/max` is the
  **observed** range, not a declared one. Live captures replay fine, but are observation — never feed
  one to the determinism gate (see below).
- **Validation is STRICT** — a bad header, a non-monotonic `t_ms`, or a frame whose tag is absent
  from the header table `push_warning`s (with the line number) and fails the WHOLE load
  (`loaded == false`). It never crashes the viewer; a half-loaded recording would hide a recorder bug.

## Recorder — two modes, one contract (`tools/sim/record.js`)

```bash
# Fixture (no network, pure synthesis — BYTE-REPRODUCIBLE per args; prints sha256):
node tools/sim/record.js --out fixture.ndjson --seconds 30 [--seed 42] [--hz 10] [--map binding_map.json]

# Live capture (RFC 6455 client — connects to a running sim/relay/source):
node tools/sim/record.js --out capture.ndjson --url ws://localhost:8765 [--seconds 30]
```

- **Fixture mode** synthesizes the EXACT stream the sim (`tools/sim/server.js`) would send — same
  `tagValue`, same tag-table derivation (`tools/sim/stream.js`, the shared core), `t_ms = tick*1000/hz`
  — straight to file. Same seed + args ⇒ **byte-identical file**; the printed `sha256` proves it.
  `--map` derives the tag list + each tag's `[min,max]` from the binding map (no drift); no `--map`
  ⇒ the built-in 5-tag demo set.
- **Live mode** stamps `t_ms` on a monotonic clock from the first frame, sets `seed:-1`, derives `hz`
  from the observed cadence. `--seconds` bounds it; SIGINT flushes what was captured.

## The player (`core/playback.gd`) — public API

A plain `Node` under Main (NOT an autoload — the DataBus stays the viewer's one justified singleton),
wired by `main.gd._start_playback` when `--recording=<path>` (user arg) or `viewer.cfg [twin]
recording=` is set. It replays through **`DataBus.inject_frame`** — the same seam live packets use —
so every consumer behaves exactly as it does live.

- `load_recording(path) -> bool` — parse + validate; on success switches DataBus to `MODE_PLAYBACK`
  (closes the live socket so a live frame can't fight the timeline), rewinds to 0, emits
  `playback_loaded(duration_ms, tag_count)` + a paused `playback_state`. Named `load_recording` (not
  `load`) to avoid shadowing GDScript's global `load()`.
- `play()` / `pause()` — start/freeze the clock. **No auto-loop**: reaching the end pauses AT the
  duration (a surprise restart is worse than a stopped bar; replay is an explicit `seek(0)` + `play()`).
- **`seek(t_ms)`** — pinned semantics: clamp to `[0, duration]`, then emit **ONE snapshot frame per
  tag** — the LAST frame with `t_ms <= T`, in **header-tag order** (the FIXED order is what keeps
  runs deterministic); a tag with no frame yet emits nothing. Playback then continues forward from T;
  play/pause state is unchanged.
- **`set_speed(x)`** — rate multiplier, **clamped `[0.25, 8.0]`** (`SPEED_MIN`/`SPEED_MAX`; the
  bounds cross-reference `overlay/timeline.gd`'s `SPEED_STEPS`). Zero/negative is excluded outright —
  it would stall or reverse the clock, which the ascending-`t_ms` format cannot express. An
  out-of-range value is `push_warning`'d and clamped, never honoured.
- Reads: `speed()`, `is_playing()`, `is_loaded()`, `duration_ms()`, `position_ms()`. Signals:
  `playback_loaded`, `playback_state(playing, position_ms, duration_ms)` (rate-limited to 10 Hz
  while playing; discrete transitions always emit immediately).
- **Determinism by construction** — the clock is pure accumulated `delta * speed`, NEVER a wall-clock
  read, and due frames emit in file order. So two runs over the same file with the same
  play/seek/set_speed calls emit identical `(tag, value, seq)` sequences (ORDER-EXACT). Under
  `--headless --fixed-fps N` every delta is constant, making positions frame-exact too.

The **timeline bar** (`overlay/timeline.gd`) is the ONE script allowed to know playback exists;
**Space** = play/pause while the bar is visible.

## The amber-PLAYBACK honesty convention

Consumers can't tell playback from live (same signals), but the overlay reads `DataBus.mode` and
colours its status line honestly: **LIVE green / PLAYBACK amber / OFFLINE red**. A viewer replaying a
recording says **PLAYBACK**, never pretends to be live. The transport stats keep this honest too:
`inject_frame` counts into **`frames_injected`** only — `frames_received`, `drops`, and seq tracking
are TRANSPORT truths and stay untouched, so playback can never fake liveness to the twin-verify smoke.

## The determinism gate (`tools/check_playback.gd` — skill `twin-verify` step)

Proves the player is reproducible: same fixture + same seeks ⇒ **identical emitted-state hash**.

```bash
$GODOT --headless --fixed-fps 60 --path . --script tools/check_playback.gd -- \
    --recording=<fixture.ndjson> [--seek=<t_ms>[,<t_ms>…]] [--out=<emitted.txt>]
```

It drives the SHIPPED runtime (the real DataBus autoload + the real player) through their PUBLIC
surfaces only, and asserts: **snapshot correctness per seek** (the seek's injected frames equal an
INDEPENDENT last-frame-≤T-per-tag recompute), **monotonic emission during play**, **transport
honesty** (`frames_injected > 0` while `frames_received == 0` — no live frame leaked in), and
**end-of-recording pause**. It prints one canonical line per emitted frame (`tag|value|seq`) and:

```
PLAYBACK-HASH: <sha256> (sha256 over <n> frame(s))
PLAYBACK-GATE: OK|FAIL — <reason>
```

**Run it TWICE; identical `PLAYBACK-HASH` lines is the determinism assertion** — `verify_twin.sh`
does exactly this and FAILs (exit 1) if they diverge.

- **SYNTHESIZED FIXTURES ONLY.** The gate hashes byte-reproducible fixtures (`seed >= 0`); byte-
  reproducibility is the foundation of a determinism check. A live capture (`seed:-1`, non-zero-based
  seq) is observation, never a reproducible anchor — the gate would be measuring the source's mood.
- **`--fixed-fps` is required** by contract (it honours the player's `delta * speed` clock and bounds
  the run). Note the emitted-STATE hash is **order-exact** — it reproduces at any frame rate, cold or
  warm — so the two-leg comparison is robust; the gate deliberately does NOT hash the clock POSITION
  at the bounded pause (that value is frame-exact only under a pinned delta, and a first-ever cold
  engine run shifts it via the asset-import pass — hashing it would false-FAIL a cold-vs-warm leg).
- A different or tampered fixture yields a different hash — that is how the two-leg comparison catches
  divergence (the per-run snapshot assertion catches player BUGS; the hash comparison catches input
  or environment divergence — two complementary checks).

## Verification (mandatory after any playback change)

Run `tools/verify_twin.sh` (skill `twin-verify`) — its playback-determinism step synthesizes a
fixture, runs `check_playback.gd` twice, and gates the two hashes equal. For a standalone check, run
the two `check_playback.gd` legs yourself and diff the `PLAYBACK-HASH` lines. Report the hash and the
`PLAYBACK-GATE` verdict.

## RTK note

Prefix shell commands with `rtk` as usual; the recorder (`node tools/sim/record.js`) and `$GODOT`
pass through unfiltered. Never reference rtk inside `.gd` files.
