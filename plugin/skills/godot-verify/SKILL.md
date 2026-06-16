---
name: godot-verify
description: Verify Godot scenes/scripts actually load, run, and visibly render — catching silently-dropped invalid properties and "valid but renders nothing" (black-screen, no-error) scenes. Use after ANY .tscn/.gd change and before claiming work done or verified — never assert a scene runs without these checks. Also when a scene loads but looks wrong (missing material/lighting — the silent-drop signature) or the window is empty/black with no errors.
---

# Godot Verify

Three-layer verification, all required. Run from project root (where `project.godot` is).

`tools/validate.sh` bundles layers 1–2 plus format/lint/parse (skill: godot-code-rules) — when you've run it, only layer 3 remains.

Godot binary: `/Applications/Godot.app/Contents/MacOS/Godot` (not on PATH). Define once: `GODOT=/Applications/Godot.app/Contents/MacOS/Godot`.

## Why three layers

- **Exit codes lie.** Godot exits 0 even on `SCRIPT ERROR:` parse failures. Never trust `$?`; grep output.
- **Unknown properties silently drop.** A `.tscn` with `energy_multiplier = 1.5` on `DirectionalLight3D` loads with zero warnings — property vanishes. Only layer 1 catches this.
- **Valid scenes can render pure black with zero errors.** Transposed `Transform3D` basis aimed camera away from level — every property name valid, no errors, black screen. Only layer 3 catches this. Editor viewport doesn't catch it either (uses editor camera).

## Layer 1 — property validation (catches silent drops)

```bash
$GODOT --headless --path . --script tools/verify_scene.gd                            # all scenes
$GODOT --headless --path . --script tools/verify_scene.gd -- levels/basic_room.tscn  # one scene
```

Instantiates each scene, checks every property assignment against live object's `get_property_list()`.

- `VERIFY-FAIL <scene> [<node|sub_resource>] <reason>` — one line per problem
- `VERIFY: OK — N scene(s) clean` or `VERIFY: FAIL — N problem(s)`
- Exit code meaningful: 0 clean, 1 problems.

Blind spots: `shader_parameter/*`, `metadata/*`, `item/*` whitelisted; property _values_ not checked, only names.

## Layer 2 — smoke run (catches runtime errors)

```bash
$GODOT --headless --path . --quit-after 3 2>&1 | grep -E "SCRIPT ERROR|ERROR|WARNING"
```

Runs main scene 3 frames. Catches `_ready()`/`_process()` crashes, autoload failures, missing main scene. **Any matched line = failure** (grep exit 1 = no matches = pass).

## Layer 3 — render check (catches "renders nothing")

```bash
$GODOT --path . --resolution 640x360 -s tools/verify_render.gd                       # main scene
$GODOT --path . --resolution 640x360 -s tools/verify_render.gd -- levels/foo.tscn    # one scene
```

Boots scene, renders ~20 frames, fails if image is flat color (camera at nothing, no camera, missing sky/lights).

- `VERIFY-RENDER: OK — <scene> (avg luminance X, spread Y)`
- `VERIFY-RENDER: FAIL — <scene>: <reason>`

Notes:

- **Not headless** — needs display; small window flashes ~1 second. If no display: say so, report layer 3 as not run.
- Frame saved to `.godot/verify_render_last.png` for human inspection — never paste/read it into chat.
- Run on `main.tscn` only (or standalone entry-point scenes). Levels and entity scenes don't render standalone in Main-shell architecture (Main provides camera — skill: godot-main-scene). Layers 1–2 still run on all changed scenes.

## Hand-authoring .tscn rules

Both are "valid but renders black" traps:

- **NEVER write `transform = Transform3D(...)` by hand** — transposed basis is still valid rotation, renders black with zero errors. Use `position = Vector3(...)` and `rotation_degrees = Vector3(...)` instead.
- `background_mode = 2` (Sky) **must** have an actual Sky resource (e.g. `ProceduralSkyMaterial`) or background is black.
- Node hierarchy flat: `StaticBody3D` and standalone `MeshInstance3D` as direct children of root — no intermediate `Node3D` groups. (Groups make scenes editable-broken in the Godot editor.)
- `#` comments valid between `[sub_resource]` and `[ext_resource]` blocks. **Must NOT appear between `[node]` blocks** — parser fails to resolve parent paths. Annotate nodes with `editor_description = "..."` instead.
- A typed node-reference export (`@export var xs: Array[Marker3D]`) does **NOT** serialize in a hand-authored `.tscn` — the node types can't be resolved at property-assign, so the array loads empty with no error. Export `Array[NodePath]` and resolve to the typed array in `_ready()`.

## Pass criteria (all three required)

1. Layer 1: `VERIFY: OK`, exits 0.
2. Layer 2: grep finds nothing.
3. Layer 3: `VERIFY-RENDER: OK` for every changed entry-point scene.

If Godot binary unavailable: say so explicitly — do not claim verification.

## Error → Fix

| Symptom                                                                                                               | Fix                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERIFY-FAIL ... unknown property "X"`                                                                                | Godot 3 name or typo — find Godot 4 name (e.g. `material/0` → `surface_material_override/0`, `energy_multiplier` → `light_energy`)                                                                                                                                                                                                                                                                      |
| `VERIFY-FAIL ... could not resolve node`                                                                              | `parent=`/`name=` path mismatch — check section order and parent paths                                                                                                                                                                                                                                                                                                                                  |
| `SCRIPT ERROR: Parse Error` during layer 1                                                                            | Attached `.gd` fails to compile — fix script, not scene                                                                                                                                                                                                                                                                                                                                                 |
| `ERROR: ... Invalid UID`                                                                                              | Hand-written uid — remove `uid="..."` attribute, let editor assign                                                                                                                                                                                                                                                                                                                                      |
| Layer 2 hangs                                                                                                         | Scene waits on input/window; `--quit-after N` missing or script blocks `_ready`                                                                                                                                                                                                                                                                                                                         |
| `VERIFY-RENDER: FAIL ... flat color` on `main.tscn`                                                                   | Camera aimed at nothing (wrong transform — see hand-authoring rules), no current Camera3D, or Sky with no Sky resource                                                                                                                                                                                                                                                                                  |
| Layer 3 flat color on level/entity scene                                                                              | Expected in Main-shell — levels/entities have no camera. Layer 3 doesn't apply; only layers 1–2 required                                                                                                                                                                                                                                                                                                |
| Layer 3 looks wrong but says OK                                                                                       | Spread check only proves _something_ rendered — composition/look is human's call; run F5/F6                                                                                                                                                                                                                                                                                                             |
| Render OK but scene behaviorally broken (no enemies, actors inert/floating, nothing spawns)                           | Layer 3 only proves something rendered, not that gameplay works. For a generated gameplay scene, add a headless behavior-assertion script (load the scene, advance a few physics frames, assert invariants — actor/spawn counts ≥ expected, `NavigationRegion3D` present, state machines instantiated). Pattern, not a fixed tool; complements the static actor-inventory check in godot-gridmap-level. |
| `Leaked instance` / `RID allocations leaked at exit` / `ObjectDB instances leaked` / `resources still in use at exit` | Benign Godot 4 headless cleanup noise — NOT an error. Ignore. The last (`resources still in use at exit`) fires when actively-playing **looping audio** holds its stream as `--quit-after` terminates before scene-tree teardown; the Layer 2 smoke grep excludes all four.                                                                                                                             |

## RTK note

Prefix binary call with `rtk` as usual (`rtk $GODOT --headless ...` passes through). **Do not** pipe into `rtk grep` — it hides `VERIFY-FAIL` lines; use plain `grep` inside the pipe. Never reference rtk inside `.gd` files.
