# input-driven render assertion — tool definition

**Problem** — Layer 3 (`verify_render.gd`) samples one frame at startup with no input. This class
of bug ships undetected: (1) one view-model rendering over another at rest, (2) a mesh face
clipping the near plane after an action, leaving a solid color flooding the screen. Both only
appear during or after a player-triggered action. The startup snapshot is structurally blind to
this class of artifact.

**Transport** — CLI. Load scene, advance physics frames, call a method or synthesize an input
action, wait for tween/animation to settle, sample the render target, assert flood threshold. No
live editor state needed — purely stateless batch. MCP not justified.

**Verdict** — build thin. Pattern is a direct extension of `capture_screenshot.gd` (already
proven: SubViewport capture, warmup loop, display-required constraint). No MIT lift candidate
needed or appropriate.

**Headless feasibility**

| Concern                                                | Assessment                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--headless` mode                                      | BLOCKED — sets renderer to Dummy; `get_image()` returns blank. Same constraint as L3 + `capture_screenshot.gd`. Needs display (Xvfb on CI). |
| Method call (`try_action()`)                           | WORKS — call directly on the instantiated scene node; simpler and more deterministic than synthesizing key events.                          |
| Input synthesis (`Input.action_press`)                 | WORKS without a real window — input system is independent of display; viable as fallback when no callable method exists.                    |
| Physics settle (`await get_tree().physics_frame` × N)  | WORKS — reliable; caller controls settle frame count.                                                                                       |
| Render-target capture (`sv.get_texture().get_image()`) | WORKS — proven in `capture_screenshot.gd` at the resolved render target (the pixelation SubViewport if present, else root).                 |
| Flood assertion                                        | WORKS — count pixels within ±delta of dominant color / total; threshold N% → FAIL.                                                          |

**Interface**

```
$GODOT --path . -s tools/verify_render_action.gd \
    -- <scene> <trigger> <settle_frames> <flood_threshold_pct> [output_png]
```

(The game's `project.godot` display settings govern the window resolution — do not hardcode one.)

Args (all after `--`):

- `<scene>` — `res://`-relative path (e.g. `main.tscn`)
- `<trigger>` — one of:
  - `method:<node_path>:<method_name>` — calls method on named node (e.g. `method:Player:try_action`)
  - `action:<action_name>` — synthesizes `Input.action_press` + `action_release` (e.g. `action:melee`)
  - `none` — no trigger; just advance frames and assert (useful for "rest" pose checks)
- `<settle_frames>` — physics frames to wait after trigger before capture (e.g. `60`)
- `<flood_threshold_pct>` — fail if any single color covers more than N% of render-target pixels (e.g. `40`)
- `[output_png]` — optional; default `.godot/verify_render_action_last.png`

Stdout / exit:

```
VERIFY-RENDER-ACTION: OK — <scene> trigger=<trigger> (dominant_color_pct=X%)
VERIFY-RENDER-ACTION: FAIL — <scene>: <reason>
```

Exit 0 = pass, 1 = fail.

Flood algorithm: sample the full render-target image, bucket each pixel to nearest 8-step RGB bin,
find the most-common bucket, divide its count by total pixels → `dominant_color_pct`. If >
threshold → FAIL with reason "single color floods X% of screen (threshold N%)".

`.godot/verify_render_action_last.png` always saved on both pass and fail for human inspection.

**Discovery**

`tools/CAPABILITIES.md` one-liner:

```
verify_render_action.gd  input-driven render assert — trigger action/method, settle, flood-check the render target
```

`--help` (first `--` arg = `help`): print usage and exit 0.

**Home** — `tools/verify_render_action.gd` (standalone; reuses SubViewport path constant from
`capture_screenshot.gd` — copy the constant, do not import).

**Build** — godot-dev/tooling: implement `tools/verify_render_action.gd` per interface above;
register one-liner in `tools/CAPABILITIES.md`; add invocation example to `godot-verify` skill
SKILL.md Layer 4 section; update the Error→Fix table row ("View-model / post-interaction
artifact") to reference the new script. godot-verify should observe: script exits 0 for a normal
rest frame, exits 1 with `floods X%` message when a solid-square clip is triggered.

**Consumers** — `godot-verify` skill (Layer 4 opt-in, not part of default `validate.sh` gate —
slow, display-required, trigger-specific). Called manually or in a targeted CI job per
view-model PR. Agents load `godot-verify` skill and discover via `tools/CAPABILITIES.md`.

**Risks / known limits**

- Display required (same as L3) — no silent headless fallback; script must print `VERIFY-RENDER-ACTION: SKIP — no display` and exit 0 when `DisplayServer` reports headless, so `validate.sh` can safely call it without breaking CI.
- `method:` trigger requires the method to be public and callable synchronously; async tweens must be awaited inside the settled frame count — caller sets `settle_frames` high enough (60 @ 60 fps = 1 s).
- When the game uses a pixelation rig, the view-model renders inside its `SubViewport` — the script must traverse to that render target, same as `capture_screenshot.gd`; with no rig, sample the root viewport. If the rig path changes, update the constant.
- Flood bucket resolution (8-step RGB) is a heuristic; near-plane clip produces near-pure color → reliably caught. Partially-clipped faces may score below threshold — caller can lower threshold for sensitive checks.
