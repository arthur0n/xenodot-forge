# game-observe — tool definition suite

**Problem** — `tools/validate.sh` runs Godot `--headless` with the DUMMY renderer. It catches
parse/logic errors but is structurally blind to rendering, audio, and physics-driven AI movement.
Bugs shipped "fixed" because the gate was green: cyan magnet bubble invisible (render-only),
enemies frozen despite 494 nav polys baked (physics/AI — observable via position-over-time),
alarm SFX still wrong (stdout log line visible in the console but not captured by agents).
Agents need real ground truth, not just green headless exits.

Three concrete evidence gaps, three targeted tools:

| Gap                                                 | Tool                    | Transport | Headless?              |
| --------------------------------------------------- | ----------------------- | --------- | ---------------------- |
| Render visuals (bubble, decals, VFX)                | `capture_screenshot.gd` | CLI       | **NO** — needs display |
| Console / log output (nav bake, errors, SFX events) | `capture_log.sh`        | CLI       | YES                    |
| AI/physics movement (enemies path to target)        | `smoke_movement.gd`     | CLI       | YES                    |

`capture_screenshot.gd` already exists and is registered in `tools/CAPABILITIES.md`.
This document defines the two missing tools: `capture_log.sh` and `smoke_movement.gd`.

---

## Tool 1 — capture_log.sh

**Transport** — CLI (stateless). Launch a scene, run for N seconds, capture all
stdout/stderr to a file. No live editor state; purely a shell wrapper.

**Verdict** — build thin. This is a three-line shell wrapper around:

```bash
"$GODOT" --headless --path . [scene] --quit-after N 2>&1 | tee "$LOGFILE"
```

No MIT lift needed. Display-not-required (headless OK for log capture — we want text output, not
rendering). The tool is display-independent because we are not calling `get_image()`; we are
reading stdout/stderr which flows even in DUMMY renderer mode.

**Interface** —

```
tools/capture_log.sh [scene.tscn] [seconds] [logfile]
```

Args:

- `[scene.tscn]` — optional res://-relative path (default: project main scene).
  Pass `""` to use default.
- `[seconds]` — integer; how many seconds Godot runs before `--quit-after` kills it
  (default: 5). High enough for nav bake + wave spawn to complete.
- `[logfile]` — destination path for captured output (default: `.godot/capture_log_last.txt`).

Stdout (the wrapper's own output):

```
CAPTURE-LOG: OK — <scene> → <logfile> (N lines)
CAPTURE-LOG: FAIL — <reason>
```

Exit 0 = OK, 1 = fail. The logfile contains the full raw output including navmesh bake
confirmations, `push_error`/`push_warning` lines, `print()` output, and engine ERRORs.
Agent reads the logfile with the `Read` tool and searches for expected/unexpected strings.

**Discovery** — `tools/CAPABILITIES.md` one-liner:

```
capture_log.sh   Run a scene headless for N seconds, save all stdout/stderr to a logfile. Run: tools/capture_log.sh [scene.tscn] [seconds] [logfile]. Headless OK. See library/tools/game-observe.md.
```

**Home** — `tools/capture_log.sh` (pure shell, no GDScript needed).

**Build** — godot-dev/tooling task: write `tools/capture_log.sh` using the GODOT resolver
pattern from `validate.sh` (resolve_engine fn or source it), run `$GODOT --headless --path .
[scene] --quit-after N 2>&1 | tee logfile`, print one-line status, exit 0/1. Register in
`tools/CAPABILITIES.md`. godot-verify should observe: logfile exists after run, contains
`"Navmesh"` or similar engine line when nav bake fires, exit 0.

**Consumers** — `godot-verify` skill (diagnose nav/audio/startup-error gaps; call when validate
passes but the human reports a runtime symptom). `godot-runtime-smoke` skill (complement to
signal-level asserts — agent reads log to confirm `"baked"` line present).

**Typical agent invocation** (nav frozen bug):

```bash
tools/capture_log.sh "" 8 .godot/nav_log.txt
# then: Read .godot/nav_log.txt and grep for "NavigationServer" / "baked"
```

---

## Tool 2 — smoke_movement.gd

**Transport** — CLI (stateless). Headless SceneTree script: boot scene, step physics N frames,
record entity `global_position` at intervals, assert displacement > threshold. No GPU needed —
nav and physics run under the DUMMY renderer.

**Verdict** — build thin. Pattern is identical to existing `smoke_*.gd` scripts (SceneTree,
`_process` frame loop, assert then `quit(0/1)`). No MIT lift. The key insight: enemy movement
is NavAgent + physics — both run headless. `NavigationServer3D.process()` + `PhysicsServer3D`
tick when `SceneTree` advances frames, even `--headless`. This is proven by the existing 494-nav-poly
bake completing under `validate.sh` (`--quit-after 3` already triggers it).

**Headless feasibility** —

| Concern                                          | Assessment                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| NavMesh bake                                     | WORKS headless — confirmed by user log "navmesh already baked 494 polys"       |
| NavigationAgent3D target following               | WORKS — pure math/server calls, no GPU                                         |
| PhysicsServer3D (CharacterBody3D.move_and_slide) | WORKS headless — confirmed in existing smoke scripts                           |
| Recording `global_position` over frames          | WORKS — any Node3D property readable in `_process`                             |
| `Input` / player presence                        | SKIP — spawn enemy + dummy target Node3D at a fixed position; no player needed |

**Interface** —

```
$GODOT --headless --path . --script tools/smoke_movement.gd \
    -- <entity_scene> <target_pos> <sample_frames> <min_displacement> [max_frames]
```

Args (after `--`):

- `<entity_scene>` — e.g. `entities/enemy/enemy.tscn`
- `<target_pos>` — `"X,Y,Z"` world position; a dummy Node3D placed here becomes the nav target
- `<sample_frames>` — record position every N physics frames (e.g. `10`)
- `<min_displacement>` — meters the entity must travel in total across the run (e.g. `1.0`);
  asserts total path length ≥ this value
- `[max_frames]` — total physics frames to run (default: `300` ≈ 5 s at 60 Hz)

Stdout (one per sample + summary):

```
MOVEMENT: frame=10 pos=(X, Y, Z)
MOVEMENT: frame=20 pos=(X, Y, Z)
...
MOVEMENT: OK — <entity> moved 3.2m in 300 frames (min=1.0m)
MOVEMENT: FAIL — <entity> moved 0.0m in 300 frames (min=1.0m) — NavAgent not targeting
```

Exit 0 = displaced enough, 1 = not.

**How it wires the nav target** — the script instantiates the entity scene, adds it to root,
then creates a plain `Node3D` at `target_pos` and calls
`entity.get_node("NavigationAgent3D").set_target_position(target_pos_vec)` (or equivalent path).
If the entity uses a group-based target lookup (`"player"` group), the script adds the dummy to
that group. Exact node path is entity-specific; the build task reads `enemy.gd` to confirm.

**Discovery** — `tools/CAPABILITIES.md` one-liner:

```
smoke_movement.gd   Headless physics simulation: boot an entity scene, step frames, assert global_position displacement >= threshold. Run: $GODOT --headless --path . --script tools/smoke_movement.gd -- <scene> <target_pos> <frames> <min_meters>. See library/tools/game-observe.md.
```

**Home** — `tools/smoke_movement.gd`. Wired in `validate.sh` step 6 loop (smoke\_\*.gd) automatically —
no validate.sh edit needed.

**Build** — godot-dev/tooling task: write `tools/smoke_movement.gd` per interface above. Read
`entities/enemy/enemy.gd` to confirm NavAgent node path and player-group name before hardcoding
them. Provide a concrete default invocation in the script header:

```
$GODOT --headless --path . --script tools/smoke_movement.gd \
    -- entities/enemy/enemy.tscn "10,0,10" 10 1.0 300
```

Register in `tools/CAPABILITIES.md`. godot-verify should observe: exit 0 with `moved X.Xm`
line when enemy has a valid navmesh; exit 1 with `moved 0.0m` when nav is broken — which is
exactly the "enemies frozen" scenario we needed to catch.

**Consumers** — `godot-verify` (new L2.5 movement gate, called by `validate.sh` via the
`smoke_*.gd` loop once the file exists); `godot-enemy-ai` skill (explicit reference for
movement-regression checks).

---

## Which tool for which bug

| Observed symptom                     | Tool                                 | Why                    |
| ------------------------------------ | ------------------------------------ | ---------------------- |
| Cyan bubble not drawing              | `capture_screenshot.gd` (existing)   | render = GPU needed    |
| Enemies frozen despite nav bake      | `smoke_movement.gd` (new)            | movement = headless OK |
| Alarm SFX still wrong (log evidence) | `capture_log.sh` (new)               | console = headless OK  |
| Nav bake count / any engine print    | `capture_log.sh`                     | stdout capture         |
| View-model artifact after trigger    | `verify_render_action.gd` (existing) | render + input         |

## macOS / display note

`capture_screenshot.gd` and `verify_render_action.gd` require a display (no `--headless`).
On the Apple M3 Pro dev machine: run from a Terminal with a GUI session open — the window
flashes briefly and closes. No Xvfb needed on macOS. `capture_log.sh` and `smoke_movement.gd`
are fully headless — safe to run in any context including CI.
