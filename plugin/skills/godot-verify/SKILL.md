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
- **Render config has one ground truth: project.godot.** When reasoning about effective render resolution, stretch, aspect, or renderer, read `[display]` (`window/size/viewport_*`, `window/stretch/*`) and `config/features` in project.godot. NEVER infer the effective render resolution from a node's properties (a SubViewport's `stretch_shrink`/`size`, a Viewport's size) — those are one rig's local setting, not the window/stretch pipeline, and a number read off them (e.g. "213×120") is a fabrication that can drive a wrong plan.

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
- **Scope: startup render only.** Layer 3 proves the scene is not black at frame ~20 with NO input — it samples one frame and checks global luminance spread. It does NOT drive input, advance through interactions, or check single-color flood. Input-driven / mid-gameplay / first-person VIEW-MODEL visuals (a weapon shown at rest, a mesh face clipping the near plane after a swing, anything behind a keypress/tween) are INVISIBLE to it. An F5/F6 play-through remains mandatory for view-model and interaction visuals; do not report those as verified from Layer 3.

## Layer 4 — input-driven render assert (OPT-IN)

```bash
$GODOT --path . --resolution 640x360 -s tools/verify_render_action.gd \
    -- main.tscn method:Melee:try_melee 60 40
```

Args (after `--`): `<scene> <trigger> <settle_frames> <flood_threshold_pct> [output_png]`

- `<trigger>`: `method:<node_name>:<method_name>` | `action:<action_name>` | `none`
- `<settle_frames>`: physics frames to wait after trigger before capture (default `60`)
- `<flood_threshold_pct>`: fail if dominant color bucket covers more than N% of SubViewport pixels (default `40`)

**Scope: input-driven view-model / interaction artifacts.** Catches the class of bug Layer 3 cannot see: a near-plane-clip solid square filling the screen after a melee swing, or a view-model mesh rendered over the HUD after an action. Loads the scene, warms up 20 frames, fires the trigger (method call or input action), waits `settle_frames` for tweens/animations to finish, captures the SubViewport (pixel-art rig), and asserts no single color bucket floods more than `flood_threshold_pct`% of pixels.

Output:

```
VERIFY-RENDER-ACTION: OK   — <scene> trigger=<trigger> (dominant_color_pct=X%)
VERIFY-RENDER-ACTION: FAIL — <scene>: single color floods X% of screen (threshold N%)
VERIFY-RENDER-ACTION: SKIP — no display (headless renderer detected)
```

Exit 0 = pass or skip; 1 = fail. Frame saved to `.godot/verify_render_action_last.png`.

Notes:

- **Not headless** — needs display; same constraint as Layer 3. On headless renderer (CI without Xvfb) it self-skips with exit 0 — safe to call unconditionally in a CI job.
- `method:` trigger uses `find_child(name, recursive=true)` — node name only, not a path.
- Set `settle_frames` ≥ `cooldown / physics_delta` so the tween completes before capture (e.g. 60 frames @ 60 fps covers a 0.45 s cooldown).
- **OPT-IN — NOT in `validate.sh` default gate.** Slow (display required, settles N frames) and trigger-specific. Run manually or in a targeted CI job when merging view-model or weapon PRs.

## Hand-authoring .tscn rules

Both are "valid but renders black" traps:

- **NEVER write `transform = Transform3D(...)` by hand** — transposed basis is still valid rotation, renders black with zero errors. Use `position = Vector3(...)` and `rotation_degrees = Vector3(...)` instead.
- `background_mode = 2` (Sky) **must** have an actual Sky resource (e.g. `ProceduralSkyMaterial`) or background is black.
- Node hierarchy flat: `StaticBody3D` and standalone `MeshInstance3D` as direct children of root — no intermediate `Node3D` groups. (Groups make scenes editable-broken in the Godot editor.)
- `#` comments valid between `[sub_resource]` and `[ext_resource]` blocks. **Must NOT appear between `[node]` blocks** — parser fails to resolve parent paths. Annotate nodes with `editor_description = "..."` instead.
- A typed node-reference export (`@export var xs: Array[Marker3D]`) does **NOT** serialize in a hand-authored `.tscn` — the node types can't be resolved at property-assign, so the array loads empty with no error. Export `Array[NodePath]` and resolve to the typed array in `_ready()`.
- **Headless verify does NOT model editor-time scene-structure validation.** These pass Layer 1 (`verify_scene.gd` only checks property NAMES on a headless instantiate) yet the editor rejects or mis-handles them: re-asserting `script = ExtResource(...)` on a node already `instance=`d from a scene whose root carries that script (silently resets the instance to script defaults at runtime — see godot-gridmap-level); an `instance=` override on a non-root INHERITED node, or `type=` on a packed-scene override node (editor: "node name clashes with a node already in the scene"). For any change that re-scripts, re-instances, or re-types an existing instanced/inherited node, OPEN the `.tscn` in the editor (or re-run the builder and diff) — a green headless verify is not sufficient.

## Pass criteria (all three required; Layer 4 opt-in)

1. Layer 1: `VERIFY: OK`, exits 0.
2. Layer 2: grep finds nothing.
3. Layer 3: `VERIFY-RENDER: OK` for every changed entry-point scene.
4. Layer 4 (opt-in): `VERIFY-RENDER-ACTION: OK` or `SKIP` — run when merging view-model / weapon changes.

If Godot binary unavailable: say so explicitly — do not claim verification.

## Error → Fix

| Symptom                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VERIFY-FAIL ... unknown property "X"`                                                                                                               | Godot 3 name or typo — find Godot 4 name (e.g. `material/0` → `surface_material_override/0`, `energy_multiplier` → `light_energy`)                                                                                                                                                                                                                                                                                                               |
| `VERIFY-FAIL ... could not resolve node`                                                                                                             | `parent=`/`name=` path mismatch — check section order and parent paths                                                                                                                                                                                                                                                                                                                                                                           |
| `SCRIPT ERROR: Parse Error` during layer 1                                                                                                           | Attached `.gd` fails to compile — fix script, not scene                                                                                                                                                                                                                                                                                                                                                                                          |
| `ERROR: ... Invalid UID`                                                                                                                             | Hand-written uid — remove `uid="..."` attribute, let editor assign                                                                                                                                                                                                                                                                                                                                                                               |
| Layer 2 hangs                                                                                                                                        | Scene waits on input/window; `--quit-after N` missing or script blocks `_ready`                                                                                                                                                                                                                                                                                                                                                                  |
| `VERIFY-RENDER: FAIL ... flat color` on `main.tscn`                                                                                                  | Camera aimed at nothing (wrong transform — see hand-authoring rules), no current Camera3D, or Sky with no Sky resource                                                                                                                                                                                                                                                                                                                           |
| Layer 3 flat color on level/entity scene                                                                                                             | Expected in Main-shell — levels/entities have no camera. Layer 3 doesn't apply; only layers 1–2 required                                                                                                                                                                                                                                                                                                                                         |
| Layer 3 looks wrong but says OK                                                                                                                      | Spread check only proves _something_ rendered — composition/look is human's call; run F5/F6                                                                                                                                                                                                                                                                                                                                                      |
| Render OK but scene behaviorally broken (no enemies, actors inert/floating, nothing spawns)                                                          | Layer 3 only proves something rendered, not that gameplay works. For a generated gameplay scene, add a headless behavior-assertion script (load the scene, advance a few physics frames, assert invariants — actor/spawn counts ≥ expected, `NavigationRegion3D` present, state machines instantiated). Pattern, not a fixed tool; complements the static actor-inventory check in godot-gridmap-level.                                          |
| View-model / post-interaction artifact (weapon on top of HUD, solid square after an action) passed Layer 3                                           | Expected — Layer 3 is a startup snapshot, no input. Run Layer 4: `$GODOT --path . --resolution 640x360 -s tools/verify_render_action.gd -- main.tscn method:<node>:<method> 60 40`. If it reports `FAIL … floods X%`, the artifact is confirmed; investigate near-plane clip (camera near plane too large) or view-model visibility logic.                                                                                                       |
| Headless `VERIFY: OK` but editor errors on open ("node name clashes") or runtime uses default/stale exports                                          | Editor-only scene-structure trap headless can't see: `script=` re-set on an instanced node, or `type=`/`instance=` override on an inherited/packed node. Remove the redundant override; fix at the source (entity `.tscn` / builder), then open in editor to confirm.                                                                                                                                                                            |
| `Leaked instance` / `RID allocations leaked at exit` / `ObjectDB instances leaked` / `resources still in use at exit` / `Pages in use exist at exit` | Benign Godot 4 headless cleanup noise — NOT an error. Ignore. `resources still in use at exit` fires when actively-playing **looping audio** holds its stream as `--quit-after` terminates before scene-tree teardown; the Layer 2 smoke grep excludes these. If you hit a benign-noise line NOT yet excluded, do NOT edit `validate.sh` yourself (plugin-owned, gitignored gate) — report it as friction so the exclusion is promoted upstream. |

## RTK note

Prefix binary call with `rtk` as usual (`rtk $GODOT --headless ...` passes through). **Do not** pipe into `rtk grep` — it hides `VERIFY-FAIL` lines; use plain `grep` inside the pipe. Never reference rtk inside `.gd` files.
