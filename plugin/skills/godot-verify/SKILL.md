---
name: godot-verify
agents: [builders, godot-playtester]
description: Verify Godot scenes/scripts actually load, run, and visibly render — catching silently-dropped invalid properties and "valid but renders nothing" (black-screen, no-error) scenes. Use after ANY .tscn/.gd change and before claiming work done or verified — never assert a scene runs without these checks. Also when a scene loads but looks wrong (missing material/lighting — the silent-drop signature) or the window is empty/black with no errors.
---

# Godot Verify

Three-layer verification, all required. Run from project root (where `project.godot` is).

`tools/validate.sh` bundles layers 1–2 plus format/lint/parse (skill: godot-code-rules) — when you've run it, only layer 3 remains.

Godot binary: **`$GODOT` is already set for you** — the framework resolves the engine binary once and exports it into every session, so just run `$GODOT …` directly. Do NOT re-derive it (`GODOT=/Applications/…`, `which godot`); that path is a per-call token tax the framework already paid. (Outside a framework session, `tools/validate.sh` still resolves it from `$GODOT`/PATH.)

## Why three layers

- **Exit codes lie.** Godot exits 0 even on `SCRIPT ERROR:` parse failures. Never trust `$?`; grep output.
- **Unknown properties silently drop.** A `.tscn` with `energy_multiplier = 1.5` on `DirectionalLight3D` loads with zero warnings — property vanishes. Only layer 1 catches this.
- **Valid scenes can render pure black with zero errors.** Transposed `Transform3D` basis aimed camera away from level — every property name valid, no errors, black screen. Only layer 3 catches this. Editor viewport doesn't catch it either (uses editor camera).
- **Render config has one ground truth: project.godot.** For the effective render resolution, stretch, aspect, or renderer, prefer the precomputed `render` block — `tools/forge-facts render.renderer` / `render.viewport_width` etc. (parsed once from project.godot into `.xenodot/manifest.json`) — instead of re-reading `[display]`/`config/features` every time. If the manifest is stale or absent, read `[display]` (`window/size/viewport_*`, `window/stretch/*`) and `config/features` in project.godot directly. NEVER infer the effective render resolution from a node's properties (a SubViewport's `stretch_shrink`/`size`, a Viewport's size) — those are one rig's local setting, not the window/stretch pipeline, and a number read off them (e.g. "213×120") is a fabrication that can drive a wrong plan.

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

Boots scene, renders ~20 frames, fails if the image is unhealthy — not just flat color but BLOWN-WHITE, TOO-DARK, FLAT, LOW-CONTRAST or HALF/HALF.

- `VERIFY-RENDER: OK — <scene> (avg luminance X, spread Y)`
- `VERIFY-RENDER: FAIL — <scene>: <reason>`

### Render-health metric set (a spread-only check is NOT enough)

A single `spread = lum_max - lum_min` threshold false-passes two real bugs we shipped: an all-white screen (avg 0.997, spread 0.898 — high spread, PASSED) and a fully-black 3D render that the bright HUD lifted over the spread floor. Mean-alone catches dark but MISSES white. Assert the SET (all must hold), not one metric:

| Metric (Rec.709 luma, downscale ~128×72 first) | Catches                      | Failure when                               |
| ---------------------------------------------- | ---------------------------- | ------------------------------------------ |
| `mean` in a calibrated `[lo, hi]` range        | blown-white AND too-dark     | `mean > hi` (white) or `mean < lo` (black) |
| `stdev`                                        | flat / low-contrast          | `stdev` below floor                        |
| 10-bin **Shannon entropy**                     | uniform fill, broken overlay | entropy below ~1.5 bits                    |
| quantized **unique-color count**               | solid flood                  | unique count below ~20                     |
| 4×4 **cell-mean spread**                       | HALF/HALF partial overlay    | cell_spread above ~0.35                    |

These thresholds are **INFERRED — CALIBRATE before trusting.** Capture 5–10 known-good frames from real levels, then set each bound with margin. Do NOT hardcode the example numbers above: our own good arena frame measured `avg=0.851`, which a naive `mean<0.85` upper bound would FALSE-FAIL. The mean range in particular is per-project and per-tonemap. The metric-computing script (a `render_health.gd` / an upgraded `verify_render.gd`) is a **godot-dev build** — this skill defines the contract it must satisfy, not the implementation.

### Frame the ARENA, not the HUD+horizon (mandatory for level-render PRs)

The black-arena bug PASSED because the check averaged the WHOLE viewport including the HUD — bright HUD text/bars masked a black 3D render. For any change to a level's lighting / environment / materials, capture from **arena gameplay vantages** (forward across the floor, down at the floor, at a wall) — NOT a HUD-inclusive horizon frame — and gate multiple yaw angles (spawn + yaw90 + yaw180). A 3-vantage arena capture (the metric set above applied per vantage, emitting `VERIFY-ARENA: ALL PASS`) is **mandatory** for level-render PRs. Like `render_health`, the script that does it (a `verify_arena_render.gd`) is a **godot-dev build, NOT shipped** — this skill defines the contract; build it per this section and calibrate thresholds per project before trusting.

Notes:

- **Not headless** — needs display; small window flashes ~1 second. If no display: say so, report layer 3 as not run. (Headless DUMMY renderer returns blank/black `get_image()` — render-health is windowed-only by nature.)
- Frame saved to `.godot/verify_render_last.png` (and `.godot/verify_arena_*.png`) for human inspection — never paste/read it into chat.
- Run on `main.tscn` only (or standalone entry-point scenes). Levels and entity scenes don't render standalone in Main-shell architecture (Main provides camera — skill: godot-main-scene). Layers 1–2 still run on all changed scenes.
- **Scope: startup render only.** Layer 3 proves the scene is not unhealthy at frame ~20 with NO input — it samples frames and checks the metric set above. It does NOT drive input, advance through interactions, or prove gameplay. Input-driven / mid-gameplay / first-person VIEW-MODEL visuals (a weapon shown at rest, a mesh face clipping the near plane after a swing, anything behind a keypress/tween) are INVISIBLE to it. An F5/F6 play-through remains mandatory for view-model and interaction visuals; do not report those as verified from Layer 3.

## Layer 4 — input-driven render assert (OPT-IN, build per contract — NOT shipped)

Catches the class of bug Layer 3 cannot see: a near-plane-clip solid square filling the screen after a melee swing, or a view-model mesh rendered over the HUD after an action. **No script for this ships** — build it per the full contract in `plugin/library/tools/verify-render-action.md` (a `verify_render_action.gd`: load the scene, warm up 20 frames, fire the trigger, wait `settle_frames` for tweens to finish, capture the render target, and assert no single color bucket floods more than `flood_threshold_pct`% of pixels). The interface it must expose:

```
verify_render_action.gd -- <scene> <trigger> <settle_frames> <flood_threshold_pct> [output_png]
```

- `<trigger>`: `method:<node_name>:<method_name>` | `action:<action_name>` | `none`
- `<settle_frames>`: physics frames to wait after trigger before capture (e.g. `60`)
- `<flood_threshold_pct>`: fail if the dominant color bucket covers more than N% of render-target pixels (e.g. `40`)

**Scope: input-driven view-model / interaction artifacts** — the class Layer 3 (a no-input startup snapshot) is structurally blind to.

Output the built script must emit:

```
VERIFY-RENDER-ACTION: OK   — <scene> trigger=<trigger> (dominant_color_pct=X%)
VERIFY-RENDER-ACTION: FAIL — <scene>: single color floods X% of screen (threshold N%)
VERIFY-RENDER-ACTION: SKIP — no display (headless renderer detected)
```

Exit 0 = pass or skip; 1 = fail. Frame saved to `.godot/verify_render_action_last.png`.

Contract notes:

- **Not headless** — needs display; same constraint as Layer 3. On a headless renderer (CI without Xvfb) it must self-skip with exit 0 — safe to call unconditionally in a CI job.
- `method:` trigger resolves by node name (`find_child(name, recursive=true)`), not a path.
- Set `settle_frames` ≥ `cooldown / physics_delta` so the tween completes before capture (e.g. 60 frames @ 60 fps covers a 0.45 s cooldown).
- **OPT-IN — NOT in the `validate.sh` default gate.** Slow (display required, settles N frames) and trigger-specific. Build + run manually, or wire into a targeted CI job, when merging view-model or weapon PRs.

## Layer 5 — CanvasLayer / overlay UI capture (root viewport)

Layers 3 and 4 capture the **SubViewport** (the pixel-art rig — the 3D scene). A
`CanvasLayer` UI screen — a HUD, a pause/menu/choice overlay — is a child of Main
**outside** the SubViewport and renders straight to the **root window** viewport. So
the SubViewport texture does NOT contain it: a UI screen is invisible to Layers 3/4.
Capture the composited **root** viewport instead. Windowed only (the `--headless`
dummy renderer returns a blank image).

```gdscript
# extends SceneTree — boot main.tscn, open the screen via the REAL path (see below),
# wait one render pass, then sample the composited root window (CanvasLayer overlays included).
await RenderingServer.frame_post_draw
var img := root.get_texture().get_image()  # root window = SubViewport 3D + ALL CanvasLayer overlays
if img == null:
    push_error("root.get_texture().get_image() returned null — needs a display")
# then img.save_png(...) AND assert non-trivial (not flat/blank) so a non-composited UI fails loud.
```

Invocation: `$GODOT --path . --resolution <W>x<H> -s tools/capture_<screen>.gd` (NO
`--headless`). Reference impl: a project's `tools/capture_passive_screen.gd`.

**Open the screen through the REAL input path, not by calling `_open()` directly.** A
capture that pokes the private open method proves the layout but SKIPS the input wiring —
exactly where a "TAB does nothing" bug hides (e.g. a toggle on a `process_mode =
WHEN_PAUSED` node whose `_input` never fires while unpaused). Drive the toggle action /
key event and step frames (skill: `godot-playthrough-bot`, toggle/UI input-sim), THEN
capture.

### Interactive / on-screen acceptance is SELF-VERIFIED, not punted to F5 (mandatory)

For ANY change whose acceptance is **interactive or on-screen** — a UI screen, HUD,
toggle/menu, overlay, anything whose correctness is a pixel or an input response — the
builder MUST self-verify by (a) driving the **real input path** through the SceneTree
(`godot-playthrough-bot`) AND (b) **capturing the relevant viewport and ACTUALLY
INSPECTING the frame** for occlusion / layout / missing elements (root viewport via
`root.get_texture().get_image()` for CanvasLayer UI; Layer 3/4 / `verify_render` for the
3D scene). **"human F5" is a LAST RESORT for what is genuinely impossible to capture —
NOT the default for anything capturable.** A visible anomaly in a capture (a panel
occluding a column, a missing element) is a **FINDING to report**, never waved off as
"expected" without a stated, justified reason.

## Hand-authoring .tscn rules

Both are "valid but renders black" traps:

- **NEVER write `transform = Transform3D(...)` by hand** — transposed basis is still valid rotation, renders black with zero errors. Use `position = Vector3(...)` and `rotation_degrees = Vector3(...)` instead.
- `background_mode = 2` (Sky) **must** have an actual Sky resource (e.g. `ProceduralSkyMaterial`) or background is black.
- Node hierarchy flat: `StaticBody3D` and standalone `MeshInstance3D` as direct children of root — no intermediate `Node3D` groups. (Groups make scenes editable-broken in the Godot editor.)
- `#` comments valid between `[sub_resource]` and `[ext_resource]` blocks. **Must NOT appear between `[node]` blocks** — parser fails to resolve parent paths. Annotate nodes with `editor_description = "..."` instead.
- A typed node-reference export — SINGULAR (`@export var mesh_root: Node3D`) OR array (`@export var xs: Array[Marker3D]`) — does **NOT** resolve from a hand-authored `.tscn` NodePath value: the node type can't be resolved at property-assign, so it stays null / loads empty with NO error (a green gate, a dead feature at runtime). Export an untyped `NodePath` / `Array[NodePath]` and resolve with `get_node()` in `_ready()`.
- **Headless verify does NOT model editor-time scene-structure validation.** These pass Layer 1 (`verify_scene.gd` only checks property NAMES on a headless instantiate) yet the editor rejects or mis-handles them: re-asserting `script = ExtResource(...)` on a node already `instance=`d from a scene whose root carries that script (silently resets the instance to script defaults at runtime — see godot-gridmap-level); an `instance=` override on a non-root INHERITED node, or `type=` on a packed-scene override node (editor: "node name clashes with a node already in the scene"). For any change that re-scripts, re-instances, or re-types an existing instanced/inherited node, OPEN the `.tscn` in the editor (or re-run the builder and diff) — a green headless verify is not sufficient.

## Pass criteria (all three required; Layer 4 opt-in)

1. Layer 1: `VERIFY: OK`, exits 0.
2. Layer 2: grep finds nothing.
3. Layer 3: `VERIFY-RENDER: OK` for every changed entry-point scene (the render-health metric set, not spread alone). For a level-render PR, ALSO `VERIFY-ARENA: ALL PASS` on the arena-framed multi-vantage capture.
4. Layer 4 (opt-in): `VERIFY-RENDER-ACTION: OK` or `SKIP` — run when merging view-model / weapon changes.
5. Interactive / on-screen change (UI screen, HUD, toggle/menu, overlay): real-input-path sim (`godot-playthrough-bot`) AND a captured-and-INSPECTED frame (Layer 5 root viewport for CanvasLayer UI) — not a "human F5" punt. A captured anomaly is a finding, not waved off as "expected".

If Godot binary unavailable: say so explicitly — do not claim verification.

## Error → Fix

| Symptom                                                                                                                                              | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERIFY-FAIL ... unknown property "X"`                                                                                                               | Godot 3 name or typo — find Godot 4 name (e.g. `material/0` → `surface_material_override/0`, `energy_multiplier` → `light_energy`)                                                                                                                                                                                                                                                                                                                                                                              |
| `VERIFY-FAIL ... could not resolve node`                                                                                                             | `parent=`/`name=` path mismatch — check section order and parent paths                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SCRIPT ERROR: Parse Error` during layer 1                                                                                                           | Attached `.gd` fails to compile — fix script, not scene                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ERROR: ... Invalid UID`                                                                                                                             | Hand-written uid — remove `uid="..."` attribute, let editor assign                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Layer 2 hangs                                                                                                                                        | Scene waits on input/window; `--quit-after N` missing or script blocks `_ready`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `VERIFY-RENDER: FAIL ... flat color` on `main.tscn`                                                                                                  | Camera aimed at nothing (wrong transform — see hand-authoring rules), no current Camera3D, or Sky with no Sky resource                                                                                                                                                                                                                                                                                                                                                                                          |
| Layer 3 flat color on level/entity scene                                                                                                             | Expected in Main-shell — levels/entities have no camera. Layer 3 doesn't apply; only layers 1–2 required                                                                                                                                                                                                                                                                                                                                                                                                        |
| Layer 3 looks wrong but says OK                                                                                                                      | Spread check only proves _something_ rendered — composition/look is human's call; run F5/F6                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Layer 3 says OK but the screen is all-WHITE, or the 3D is BLACK behind a visible HUD                                                                 | Spread-only assertion with no mean bound, sampling the HUD-inclusive whole viewport. White passes (high spread); HUD spread masks a black 3D. Assert the render-health metric SET (mean-in-calibrated-range + stdev + entropy + unique-count + 4×4 cell-spread) on an ARENA-framed 3-vantage capture (build per Layer 3's contract — a `verify_arena_render.gd`, not shipped; mandatory for level-render PRs), NOT whole-viewport spread. Calibrate thresholds vs real known-good frames — don't hardcode.      |
| Render OK but scene behaviorally broken (no enemies, actors inert/floating, nothing spawns)                                                          | Layer 3 only proves something rendered, not that gameplay works. Asserting the scene actually _behaves_ (spawn/actor counts ≥ expected, `NavigationRegion3D` present, state machines live, player can walk) is **godot-runtime-smoke**'s job — a headless `smoke_*.gd` that boots the scene, steps physics, and asserts invariants; the player-can-walk / navigability-smoke case specifically is its companion **godot-playthrough-bot**. Complements the static actor-inventory check in godot-gridmap-level. |
| View-model / post-interaction artifact (weapon on top of HUD, solid square after an action) passed Layer 3                                           | Expected — Layer 3 is a startup snapshot, no input. Use Layer 4 (build per contract, not shipped — see `plugin/library/tools/verify-render-action.md`): trigger the action, settle, flood-check the render target. If it reports `FAIL … floods X%`, the artifact is confirmed; investigate near-plane clip (camera near plane too large) or view-model visibility logic.                                                                                                                                       |
| Headless `VERIFY: OK` but editor errors on open ("node name clashes") or runtime uses default/stale exports                                          | Editor-only scene-structure trap headless can't see: `script=` re-set on an instanced node, or `type=`/`instance=` override on an inherited/packed node. Remove the redundant override; fix at the source (entity `.tscn` / builder), then open in editor to confirm.                                                                                                                                                                                                                                           |
| `Leaked instance` / `RID allocations leaked at exit` / `ObjectDB instances leaked` / `resources still in use at exit` / `Pages in use exist at exit` | Benign Godot 4 headless cleanup noise — NOT an error. Ignore. `resources still in use at exit` fires when actively-playing **looping audio** holds its stream as `--quit-after` terminates before scene-tree teardown; the Layer 2 smoke grep excludes these. If you hit a benign-noise line NOT yet excluded, do NOT edit `validate.sh` yourself (plugin-owned, gitignored gate) — report it as friction so the exclusion is promoted upstream.                                                                |
| UI overlay / CanvasLayer screen renders blank or is missing from a capture                                                                           | The SubViewport texture (Layer 3/4) excludes CanvasLayer overlays. Capture the composited ROOT viewport instead: `await RenderingServer.frame_post_draw` then `root.get_texture().get_image()`, windowed (no `--headless`) — see Layer 5.                                                                                                                                                                                                                                                                       |
| Reported a UI / visual / toggle feature "verified" (or "human F5 needed") without a capture                                                          | If it is on-screen and capturable, capture + INSPECT it yourself (Layer 3/4/5) and drive the real input path (`godot-playthrough-bot`). "human F5" is only for the genuinely uncapturable. Never wave off a visible anomaly in a capture as "expected" without a stated reason.                                                                                                                                                                                                                                 |

## RTK note

Prefix binary call with `rtk` as usual (`rtk $GODOT --headless ...` passes through). **Do not** pipe into `rtk grep` — it hides `VERIFY-FAIL` lines; use plain `grep` inside the pipe. Never reference rtk inside `.gd` files.
