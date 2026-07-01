# scene-screenshot — tool definition

**Problem** — `tools/verify_render.gd` (godot-verify layer 3) reports only average luminance + spread — a "something rendered" statistic that is blind to geometry errors. When three sourced `.glb` furniture models were wired into a level scene, every verify pass reported `VERIFY-RENDER: OK` (luminance ~0.63), yet the user reported a mis-scaled prop, a wrong model, and a prop that failed to render entirely. The headless luminance check cannot show model placement, scale, floating/sinking, silhouette, or lighting quality. Agents and humans need an actual PNG image of the rendered scene so visual judgment is possible.

**Transport** — CLI (stateless). The capability is: boot Godot, load a scene, warm up N frames, capture the render-target texture, save PNG, exit. This is a batch/stateless one-shot — no live editor state required. CLI wins; MCP is not needed.

**Verdict** — build thin. `verify_render.gd` already contains the correct warmup loop and `save_png` call, but samples `root.get_texture()` (the window viewport) rather than the render target that actually holds the 3D content. When a game uses a pixelation rig, its 3D content renders inside a `SubViewport` (reached by node path from the root), not the root viewport; a game without a rig renders straight to the root. The new script extends the same pattern: load the entry-point scene, resolve the render target (the pixelation `SubViewport` if present, else root), await N warmup frames, call `<target>.get_texture().get_image().save_png(output_path)`, emit a one-line status, exit. No external dependency; no MIT tool does this in a SubViewport+SceneTree architecture without addon machinery.

**Headless caveat — critical.** Godot 4's `--headless` flag sets the rendering server to `Dummy`, disabling all rendering; `get_image()` returns a blank image. This is confirmed Godot 4 behavior — it is NOT the same as Godot 3's `--no-window`. `verify_render.gd` already documents this: it runs WITHOUT `--headless` (a window flashes briefly). `capture_screenshot.gd` must follow the same pattern: run Godot without `--headless` on a machine that has a display (the dev machine does). On macOS the brief window flash is unavoidable; the window closes on quit. A CI / display-less environment would require Xvfb (Linux only) or is simply not supported — say so in the script header. The `--write-movie` flag is also a non-starter for single-frame PNG without a display; it still requires a render-capable context.

**Render-target note.** When a game renders through a pixelation rig, its 3D content lives inside a `SubViewport` (`render_target_update_mode = ALWAYS`) reached by node path from the root. After warmup, the correct capture call is:

```gdscript
var sv := <resolve the pixelation SubViewport by node path> as SubViewport
await RenderingServer.frame_post_draw
var img := sv.get_texture().get_image()
img.save_png(output_path)
```

`root.get_texture().get_image()` (the current `verify_render.gd` approach) captures the upscaled window compositor output, not the raw pixel-art render. When a rig is present, capture the `SubViewport` directly so the image shows what the rig actually produced (at its native resolution); with no rig, capturing the root viewport is correct.

**Interface** —

```
$GODOT --path . -s tools/capture_screenshot.gd [-- <scene_path> [output_path]]
```

(The game's `project.godot` display settings govern the window resolution — do not hardcode one.)

- `<scene_path>` — optional `res://`-relative path to the entry-point scene (default: `run/main_scene` from `project.godot`). Must be an entry-point scene that carries a camera (bare level/entity scenes have none; they render inside the game's main scene).
- `output_path` — optional absolute or `res://`-relative path for the PNG (default: `res://.godot/screenshot_last.png`).
- stdout: one line — `SCREENSHOT: OK — <scene> → <output_path>` or `SCREENSHOT: FAIL — <reason>`.
- exit code: 0 on success, 1 on failure.
- artifact: PNG at `output_path`, readable by an agent via the `Read` tool (Claude Code supports image reading).

**Discovery** — `tools/CAPABILITIES.md` entry:

```
capture_screenshot.gd   Renders a scene (via its render target — the pixelation SubViewport if the game has one, else the root viewport) and saves a PNG. Run: $GODOT --path . -s tools/capture_screenshot.gd [-- <scene> [out.png]]. Requires display (not --headless). See library/tools/scene-screenshot.md.
```

**Home** — `tools/capture_screenshot.gd` (extends the `verify_render.gd` warmup pattern; no new `.gd` op script wrapper needed beyond the tool itself).

**Build** — godot-dev/tooling task: write `tools/capture_screenshot.gd` as a `SceneTree`-extending script that loads the entry-point scene (or the user-supplied scene), warms up 20 frames (same as `verify_render.gd`), captures the render target (the pixelation `SubViewport` if present, else root) via `await RenderingServer.frame_post_draw`, saves PNG to the output path, prints the one-line status, and quits. Register it in `tools/CAPABILITIES.md`. godot-verify should observe: (a) a valid PNG exists at the output path after running, (b) the PNG matches the render target's native resolution, (c) the PNG is not uniformly black (same luminance check `verify_render.gd` uses).

**Consumers** — `godot-verify` (as a new optional layer 4 "visual check" — an agent calls it, Reads the PNG, judges scale/placement/lighting); `godot-dev` (after wiring `.glb` models, to show the human what actually rendered); human (receives the PNG path, opens it to judge look).

**Choosing a vantage (for walled interior rooms).** A steep top-down / aerial vantage reads _poorly_ for furnished rooms — props shrink and the room interior sits in wall-shadow, so scale/placement can't be judged. Prefer a **low interior vantage**: eye ~6 m up, looking at the room centre, ortho size ~8. This sees over the near wall, keeps props at a readable size, and stays clear of the shadowed pit a top-down camera falls into. Use the steep diagnostic top-down only as a last resort for a pure layout/overlap check, not for judging look or scale.
