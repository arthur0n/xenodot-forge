---
name: godot-main-scene
agents: [godot-dev]
domain: godot-core
description: Create the thin main.tscn entry point (set as run/main_scene) that owns the persistent shell — SubViewport pixelation rig, camera rig, UI — and loads/swaps level scenes under a container node. Use when the project needs a main scene, run/main_scene is unset in project.godot, levels need loading/switching, before adding a second level, or when deciding whether something belongs in Main, a level, or an autoload. The persistent-CameraRig-in-Main layout shown is the top-down/iso paradigm (godot-orthographic-follow-camera); in first-person/third-person the camera lives inside the Player entity (godot-first-person-controller), so Main owns no camera and the swap-time rig wiring is dropped — the level-loading spine is identical either way.
---

# Godot Main Scene (entry point + level loading)

One thin `Main` scene is the game's entry point (`run/main_scene`). It owns everything that must **survive a level swap**; levels are loaded and freed under a container node inside it. Never use `get_tree().change_scene_to_file()` in this architecture — it replaces the whole scene tree, destroying the shell (viewport rig, UI, camera) you built Main to preserve.

## Scene structure

```
Main (Node)                          res://main.tscn + res://main.gd (project root)
├── SubViewportContainer             ← pixelation rig (skill: godot-3d-pixelation)
│   └── SubViewport
│       ├── LevelHost (Node)         ← levels instanced here; unique_name_in_owner = true
│       └── CameraRig                ← persistent camera (skill: godot-orthographic-follow-camera)
└── UI (CanvasLayer)                 ← native-res UI, outside the SubViewport
```

> **Camera placement is paradigm-dependent.** The persistent `CameraRig` under Main above is the **top-down/iso** layout (skill `godot-orthographic-follow-camera`): the camera survives level swaps, so Main owns it and levels ship none. In **first-person/third-person** (skill `godot-first-person-controller`) the camera lives inside the Player entity, which lives in the level — so Main owns **no** CameraRig, levels legitimately carry that camera, and step-2's `%CameraRig` rig-wiring is dropped. Everything else here (LevelHost, `free()`-swap, `run/main_scene`, autoload persistence) is paradigm-agnostic. Pick the sibling camera skill for your genre; don't ship both.
>
> The rest of this skill writes the top-down/iso path concretely; a first-person project keeps the same spine minus the CameraRig node and its wiring.

Folder rule: every scene lives in its domain folder (`levels/`, `entities/`, …); the single entry point `main.tscn` + `main.gd` sit at the project root. There is no generic `scenes/` folder.

If the pixelation rig doesn't exist yet, build `Main → LevelHost` flat and note in CLAUDE.md that LevelHost must move inside the SubViewport when that skill runs. Omit `UI` until there is UI.

## What lives where

Rule of thumb: **survives a level swap → Main (or autoload); describes one place → level; pure data/state → autoload.**

- **Main**: viewport rig, camera rig, HUD/menus, music player, the level-loading code itself.
- **Level** (`levels/*.tscn`): geometry, props, lights, WorldEnvironment, spawn markers. Levels stay self-contained and runnable standalone (F6, godot-verify) — that's why each keeps its own lights/environment.
- **Autoload**: state that outlives nodes (score, settings, run progress). Don't park it on Main nodes — Main is structure, not a data bag.
- **Cameras**: exactly one current Camera3D per viewport. In the top-down/iso paradigm the camera survives swaps → once Main owns the CameraRig, levels must not ship a camera (delete level-local cameras when migrating); until then, Main must `make_current()` its own camera after loading a level. In first-person/third-person the camera lives inside the Player (in the level) → Main owns no CameraRig and the level's camera is `make_current()` on load. (See the paradigm note under Scene structure.)

### Run-state autoload (persist state across a swap)

When some state must outlive a level (run progress, carried-over counters), use a **thin data-only autoload** — fields and nothing else, no gameplay logic. The write/read seam: one node (typically `main.gd`, around the swap) writes the values plus an `active` flag _before_ loading the next level; the incoming level reads them on load and clears `active` (read-and-clear, so the carry happens exactly once). Paths that want a fresh start (a manual level-cycle, a new game) simply skip the autoload — leave `active` false and seed defaults.

Keep it a data bag, not a manager: no signals, no per-frame logic, no orchestration — Main and the levels own the flow; the autoload only holds the values between them.

Gate gotcha: under this project's strict gate the autoload's script `class_name` must **differ** from its autoload key, and persisted fields are `static var` accessed via the `class_name` (not the singleton name) — see godot-code-rules (`SHADOWED_GLOBAL_IDENTIFIER` on an autoload script).

## Steps

1. Create `main.tscn` at the project root per the structure above; set `unique_name_in_owner` on LevelHost.
2. Attach `main.gd` (also at the root):

```gdscript
extends Node

@export_file("*.tscn") var initial_level: String = "res://levels/basic_room.tscn"

var current_level: Node = null
@onready var _level_host: Node = %LevelHost

func _ready() -> void:
	load_level(initial_level)

func load_level(path: String) -> void:
	if current_level != null:
		current_level.free()  # synchronous: queue_free() leaves both levels alive one frame → camera/WorldEnvironment conflicts
		current_level = null
	current_level = (load(path) as PackedScene).instantiate()
	_level_host.add_child(current_level)

	# Player must exist in the level the instant it's instantiated — this
	# wiring is synchronous. A level that spawns its Player via call_deferred()
	# (or any runtime builder) arrives too late; the rig is never wired (silent).
	var player := current_level.find_child("Player") as Player
	if player != null:
		var rig: CameraRig = %CameraRig
		rig.target = player
		player.camera_rig = rig
```

> **`owned=true` stops at instanced-scene boundaries.** `find_child(name, recursive, owned=true)` only returns nodes whose `.owner` is the node you call it on. A node living inside an instanced sub-scene (the Player's own `Camera3D`, a prop's internals) is owned by THAT sub-scene's root, so an `owned=true` search from the level/Main root will NOT find it — use `owned=false` to search into instanced sub-scenes. (Conversely, do not re-own those internals to make `owned=true` work — that breaks the instance and bloats the `.tscn`; see godot-gridmap-level. A level builder that recursively re-owned a Player instance is exactly what made this search return null on the second level.)

3. Set it as the entry point in `project.godot` under `[application]`: `run/main_scene="res://main.tscn"` (editor: Project Settings → Application → Run → Main Scene).
4. Record in CLAUDE.md Project conventions: entry point path + "levels load under Main/LevelHost; never change_scene_to_file".
5. Run godot-verify on main.tscn (it exercises `_ready`, so the initial level load is verified too).

## Verification checklist

- [ ] F5 (not F6) launches Main and the initial level is visible.
- [ ] `load_level()` called twice in a row swaps cleanly — no doubled geometry, no "two current cameras" flicker.
- [ ] Shell nodes (UI, CameraRig, SubViewport) still exist after a swap.
- [ ] godot-verify passes on both main.tscn and the level scenes individually.

## Error → Fix

| Symptom                                                               | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Can't change state while flushing queries" on level swap             | Swap was triggered from a physics signal inside the dying level → `load_level.call_deferred(path)`                                                                                                                                                                                                                                                                                                                                    |
| Screen black after Main loads level                                   | Level renders outside the SubViewport (LevelHost in wrong place), or no current camera — CameraRig missing/not current                                                                                                                                                                                                                                                                                                                |
| Lighting/environment doubles or flickers during swap                  | Old level freed with `queue_free()` while new one added same frame → use `free()` as in the script                                                                                                                                                                                                                                                                                                                                    |
| UI got pixelated                                                      | UI node ended up inside the SubViewport — move it to a CanvasLayer under Main                                                                                                                                                                                                                                                                                                                                                         |
| Level works in F6 but not under Main                                  | Level script assumes it's the scene root (`get_parent()` of root, `$/root/Level` paths) — levels must not depend on their parent                                                                                                                                                                                                                                                                                                      |
| Player moves but camera never follows it (no error)                   | Level spawns its Player via `call_deferred()` / a runtime builder — `load_level()` wires the rig synchronously at `add_child`. The Player must be a baked node in the level `.tscn` (present before `instantiate()` returns), never deferred                                                                                                                                                                                          |
| Paused overlay (win/lose, pause menu) freezes — no input gets through | Main (and any node that must act while paused) defaults to `process_mode = INHERIT` (PAUSABLE) → its `_input`/`_process` go silent under `get_tree().paused`. Set `process_mode = PROCESS_MODE_ALWAYS` in `_ready` so the restart/resume input still fires. Release the captured mouse (`Input.mouse_mode = MOUSE_MODE_VISIBLE`) before pausing so the panel is readable; recapture `MOUSE_MODE_CAPTURED` on resume before reloading. |

## Scope boundary

This skill stops at "Main exists and can swap levels". Loading screens, async loading (`ResourceLoader.load_threaded_request`), transitions, player persistence across levels, and save systems are separate future slices — flag them, don't bolt them on. If a slice DOES pause the tree (a win/lose or pause overlay), the node driving the overlay must be `PROCESS_MODE_ALWAYS` or its resume input never fires — see Error → Fix.
