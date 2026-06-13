---
name: godot-main-scene
description: Create the Main scene entry point for a Godot 4.x project — a thin main.tscn set as run/main_scene that owns the persistent shell (SubViewport pixelation rig, camera rig, UI) and loads/swaps level scenes under a container node. Use this skill when the project needs a main scene, when run/main_scene is unset in project.godot, when the user asks how levels should be loaded or switched, before adding a second level, or whenever deciding if something belongs in the Main scene, a level, or an autoload.
---

# Godot Main Scene (entry point + level loading)

One thin `Main` scene is the game's entry point (`run/main_scene`). It owns everything that must **survive a level swap**; levels are loaded and freed under a container node inside it. Never use `get_tree().change_scene_to_file()` in this architecture — it replaces the whole scene tree, destroying the shell (viewport rig, UI, camera) you built Main to preserve.

## Scene structure

```
Main (Node)                          res://main.tscn + res://main.gd (project root)
├── SubViewportContainer             ← pixelation rig (skill: godot-3d-pixelation)
│   └── SubViewport
│       ├── LevelHost (Node)         ← levels instanced here; unique_name_in_owner = true
│       └── CameraRig                ← persistent camera (skill: godot-camera-rig)
└── UI (CanvasLayer)                 ← native-res UI, outside the SubViewport
```

Folder rule: every scene lives in its domain folder (`levels/`, `entities/`, …); the single entry point `main.tscn` + `main.gd` sit at the project root. There is no generic `scenes/` folder.

If the pixelation rig doesn't exist yet, build `Main → LevelHost` flat and note in CLAUDE.md that LevelHost must move inside the SubViewport when that skill runs. Omit `UI` until there is UI.

## What lives where

Rule of thumb: **survives a level swap → Main (or autoload); describes one place → level; pure data/state → autoload.**

- **Main**: viewport rig, camera rig, HUD/menus, music player, the level-loading code itself.
- **Level** (`levels/*.tscn`): geometry, props, lights, WorldEnvironment, spawn markers. Levels stay self-contained and runnable standalone (F6, godot-verify) — that's why each keeps its own lights/environment.
- **Autoload**: state that outlives nodes (score, settings, run progress). Don't park it on Main nodes — Main is structure, not a data bag.
- **Cameras**: exactly one current Camera3D per viewport. Once Main owns the CameraRig, levels must not ship a camera (delete level-local cameras when migrating); until then, Main must `make_current()` its own camera after loading a level.

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
```

3. Set it as the entry point in `project.godot` under `[application]`: `run/main_scene="res://main.tscn"` (editor: Project Settings → Application → Run → Main Scene).
4. Record in CLAUDE.md Project conventions: entry point path + "levels load under Main/LevelHost; never change_scene_to_file".
5. Run godot-verify on main.tscn (it exercises `_ready`, so the initial level load is verified too).

## Verification checklist

- [ ] F5 (not F6) launches Main and the initial level is visible.
- [ ] `load_level()` called twice in a row swaps cleanly — no doubled geometry, no "two current cameras" flicker.
- [ ] Shell nodes (UI, CameraRig, SubViewport) still exist after a swap.
- [ ] godot-verify passes on both main.tscn and the level scenes individually.

## Error → Fix

| Symptom                                                   | Fix                                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "Can't change state while flushing queries" on level swap | Swap was triggered from a physics signal inside the dying level → `load_level.call_deferred(path)`                               |
| Screen black after Main loads level                       | Level renders outside the SubViewport (LevelHost in wrong place), or no current camera — CameraRig missing/not current           |
| Lighting/environment doubles or flickers during swap      | Old level freed with `queue_free()` while new one added same frame → use `free()` as in the script                               |
| UI got pixelated                                          | UI node ended up inside the SubViewport — move it to a CanvasLayer under Main                                                    |
| Level works in F6 but not under Main                      | Level script assumes it's the scene root (`get_parent()` of root, `$/root/Level` paths) — levels must not depend on their parent |

## Scope boundary

This skill stops at "Main exists and can swap levels". Loading screens, async loading (`ResourceLoader.load_threaded_request`), transitions, player persistence across levels, and save systems are separate future slices — flag them, don't bolt them on.
