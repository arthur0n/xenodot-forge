---
name: godot-verify
description: Verify Godot scenes and scripts actually load, run, and visibly render, including invalid property names that Godot silently drops and "valid but renders nothing" scenes (black screen, no errors). Use this skill after ANY change to .tscn/.gd files and before claiming work is done or verified — never assert "the scene runs" without running these checks. Also use it when a scene loads but looks wrong (missing material, wrong lighting — the signature of a silently dropped property) or when the game window is empty/black with no errors.
---

# Godot Verify (headless + render checks)

Three-layer verification, all required. Run from the project root (where `project.godot` is).

Shortcut: `tools/validate.sh` bundles layers 1–2 plus format/lint/parse checks (skill: godot-code-rules) — when you've run it, only layer 3 remains.

The Godot binary on this machine: `/Applications/Godot.app/Contents/MacOS/Godot` (not on PATH — `which godot` fails). Define `GODOT=/Applications/Godot.app/Contents/MacOS/Godot` once per shell call.

## Why three layers (verified behavior, Godot 4.6)

- **Exit codes lie.** Godot exits 0 even when `SCRIPT ERROR:` parse failures are printed. Never trust `$?`; grep the output.
- **Unknown properties are silently dropped.** A `.tscn` with `energy_multiplier = 1.5` on a DirectionalLight3D (Godot 3 name) or `material/0` on a MeshInstance3D loads and runs with zero warnings — the property just vanishes. Runtime checks cannot catch this class of bug; only layer 1 does.
- **A valid scene can render pure black with zero errors.** Real case: a hand-written `Transform3D` with transposed basis aimed the camera _away_ from the level — every property name valid, no runtime errors, black screen. Layers 1–2 are blind to this; only rendering actual frames (layer 3) catches it. The editor viewport does NOT catch it either — it uses the editor's camera, not the scene's.

## Layer 1 — property validation (catches silent drops)

```bash
$GODOT --headless --path . --script tools/verify_scene.gd                            # all scenes
$GODOT --headless --path . --script tools/verify_scene.gd -- levels/basic_room.tscn  # one scene
```

`tools/verify_scene.gd` instantiates each scene and checks every property assignment in the `.tscn` text against the live object's `get_property_list()`. Output:

- `VERIFY-FAIL <scene> [<node|sub_resource>] <reason>` — one line per problem
- `VERIFY: OK — N scene(s) clean` or `VERIFY: FAIL — N problem(s)`
- Exit code is meaningful here: 0 clean, 1 problems.

Loading the scenes also surfaces `SCRIPT ERROR:` parse errors in attached scripts and missing ext_resource files.

Known blind spots: `shader_parameter/*` and `metadata/*` are whitelisted (dynamic); property _values_ are not checked, only names.

## Layer 2 — smoke run (catches runtime errors)

```bash
$GODOT --headless --path . --quit-after 3 2>&1 | grep -E "SCRIPT ERROR|ERROR|WARNING"
```

Runs the main scene for 3 frames. Catches `_ready()`/`_process()` crashes, autoload failures, missing main scene. **Any matched line = failure**, regardless of exit code (grep exiting 1 = no matches = pass).

## Layer 3 — render check (catches "renders nothing")

```bash
$GODOT --path . --resolution 640x360 -s tools/verify_render.gd                       # main scene
$GODOT --path . --resolution 640x360 -s tools/verify_render.gd -- levels/foo.tscn    # one scene
```

`tools/verify_render.gd` boots the scene, renders ~20 frames, samples the output, and fails if the image is a flat color (camera pointing at nothing, no current camera, missing sky/lights). Output is one line:

- `VERIFY-RENDER: OK — <scene> (avg luminance X, spread Y)`
- `VERIFY-RENDER: FAIL — <scene>: <reason>`

Notes:

- **Not headless** — it needs a display; a small window flashes for under a second. If no display is available, say so explicitly and report layer 3 as not run.
- The sampled frame is saved to `.godot/verify_render_last.png` for the human to inspect; never paste or read the image into chat.
- Run it on `main.tscn` only (or any scene explicitly designed as a standalone entry point). Levels and entity scenes do not render standalone in a Main-shell architecture — Main provides the camera (skill: godot-main-scene). Layers 1–2 still run on all changed scenes; layer 3 only on entry-point scenes.

## Hand-authoring .tscn rules

Both are "valid but renders black" traps — layer 3 exists because of them:

- NEVER write `transform = Transform3D(...)` matrices by hand — a transposed basis is still a valid rotation and renders a black screen with zero errors (this happened). Use `position = Vector3(...)` and `rotation_degrees = Vector3(...)` properties instead; both load correctly in .tscn.
- An Environment with `background_mode = 2` (Sky) MUST have an actual Sky resource (e.g. ProceduralSkyMaterial) attached, or the background renders black.

## Pass criteria (all three required)

1. Layer 1 prints `VERIFY: OK` and exits 0.
2. Layer 2 grep finds nothing.
3. Layer 3 prints `VERIFY-RENDER: OK` for every changed scene (and the main scene if it exists).

Only then may you report the change as verified. If you cannot run the binary (no Godot on the machine), say so explicitly — do not claim verification.

## Error → Fix

| Symptom                                             | Fix                                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERIFY-FAIL ... unknown property "X"`              | Godot 3 name or typo; find the Godot 4 name (e.g. `material/0` → `surface_material_override/0`, `energy_multiplier` → `light_energy`)                                             |
| `VERIFY-FAIL ... could not resolve node`            | `parent=`/`name=` path in the .tscn doesn't match the tree — check section order and parent paths                                                                                 |
| `SCRIPT ERROR: Parse Error` during layer 1          | The attached .gd fails to compile; fix the script, not the scene                                                                                                                  |
| `ERROR: ... Invalid UID`                            | Hand-written uid string; remove the `uid="..."` attribute and let the editor assign one on save                                                                                   |
| Layer 2 hangs                                       | Scene waits on input/window; `--quit-after N` missing or a script blocks `_ready` — check for infinite loops                                                                      |
| `VERIFY-RENDER: FAIL ... flat color` on `main.tscn` | Camera aimed at nothing (wrong transform — see "Hand-authoring .tscn rules" above), no current Camera3D in the viewport, or `background_mode = Sky` with no Sky resource attached |
| Layer 3 flat color on a level or entity scene       | Expected in Main-shell architecture — levels and entities have no camera (Main provides it). Layer 3 does not apply to these scenes; only layers 1–2 are required                 |
| Layer 3 looks wrong but says OK                     | Spread check only proves _something_ rendered; composition/look is still the human's call — they must RUN the scene (F5/F6), not judge from the editor viewport                   |

## RTK note

When invoking from Claude Code Bash, prefix the binary call with `rtk` as usual (`rtk $GODOT --headless ...` passes through unfiltered). Do **not** pipe into `rtk grep` — it summarizes matches to a count and hides the `VERIFY-FAIL` lines; use plain `grep` inside the pipe. Never reference rtk inside `.gd` files — it is a shell-side proxy, not part of the project.
