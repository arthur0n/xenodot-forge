---
name: godot-export-builds
agents: [godot-dev]
description: Export a Godot-family game to a shippable build from the command line — headless `--export-release` to desktop (macOS / Linux / Windows) first, web (HTML5) gated behind a renderer spike, then upload to itch.io with butler. Use when packaging a build for distribution, shipping a POC to itch.io, setting up `export_presets.cfg`, or when an export fails with "no export template found" / "no matching preset". Desktop is the guaranteed path; web is uncertain whenever the look depends on Forward+ post-process. NOT for running/verifying in-editor (that is godot-verify) — this produces a distributable artifact.
---

# Godot Export Builds (headless → itch.io)

Produce a distributable build from the project, without opening the editor. Works across the
Godot family (Godot / Redot / Blazium) through the `$GODOT` seam — the export CLI is shared.

Run from project root (where `project.godot` is). Define the binary once (it is not on PATH):

```bash
GODOT=/Applications/Godot.app/Contents/MacOS/Godot   # or the Redot/Blazium fork binary
```

Desktop is the **guaranteed ship path** — no renderer constraints. Treat web as a separate,
uncertain spike (see Web caveat). Ship desktop first; never let "also web" block shipping.

## Prerequisite: export templates (one-time, per engine version)

Headless export needs the export templates for the **exact** engine version (e.g. `4.6.3.stable`).
They are a ~700 MB download, separate from the editor binary, and are NOT installed by default.

```bash
ls ~/Library/Application\ Support/Godot/export_templates/   # macOS — must list e.g. 4.6.3.stable
```

If empty / missing the matching version:

- **Editor:** _Editor → Manage Export Templates → Download and Install._ (Simplest.)
- **CLI download** (headless box): fetch `Godot_v<ver>_export_templates.tpz` from the engine's
  release page and unzip its contents into the `export_templates/<ver>.stable/` folder above.

Without templates, `--export-release` fails with **"No export template found at the expected path."**
This is a host setup step, not a project bug — surface it; do not fake the export.

## `export_presets.cfg` — one preset per platform

Hand-authored at project root, committed. The headless export selects a preset **by its exact
`name=`**. Minimal desktop presets (no signing, POC):

- `preset.<n>.platform` = `"macOS"` | `"Linux/X11"` (4.6 may show `"Linux"`) | `"Windows Desktop"`
- `preset.<n>.name` = the string you pass on the CLI (e.g. `"Linux"`, `"macOS"`, `"Windows"`)
- `preset.<n>.export_path` = default output (CLI arg overrides it)
- `preset.<n>.runnable = true`

macOS exports a `.app`/`.zip`; Linux a single executable; Windows an `.exe` (+ `.pck` unless
embedded). Keep the project's `main.tscn` as the main scene — export ships whatever
`run/main_scene` points at.

## Export commands (desktop)

```bash
mkdir -p build/{linux,macos,windows}
rtk $GODOT --headless --path . --export-release "Linux"   build/linux/<game>.x86_64
rtk $GODOT --headless --path . --export-release "macOS"   build/macos/<game>.zip
rtk $GODOT --headless --path . --export-release "Windows" build/windows/<game>.exe
```

- Preset name in quotes must match `export_presets.cfg` exactly.
- **macOS-only prereq:** the macOS preset needs `textures/vram_compression/import_etc2_astc=true` in `project.godot` `[rendering]` (ASTC-only templates) — set it once or the macOS export aborts.
- **Exit codes lie** (Godot habit): grep stderr for `ERROR`/`template`; confirm the artifact
  exists and is non-trivially sized (`ls -la build/...`). A 0-byte or missing output = failure
  even on exit 0.
- `--export-debug` for a debug build; `--export-pack foo.pck` for data-only.

## Web caveat (spike before promising "plays in browser")

The 3D-pixel-art look here is a **Forward+** SubViewport downscale + a depth/normal post-process
outline pass (skill `godot-screen-effects`). The Web target runs **Compatibility/WebGL2** — which
has **no normal-roughness buffer**, so the outline pass may not survive — or **experimental
WebGPU**. Decide explicitly, one of: (a) web works acceptably, (b) ship web with a **degraded**
look (outlines off / simplified), (c) **defer web**, desktop-only. Web also needs the **Web**
export template and is served over HTTP with COOP/COEP headers (itch's iframe handles this).

```bash
rtk $GODOT --headless --path . --export-release "Web" build/web/index.html
```

## Upload to itch.io (butler)

[butler](https://itch.io/docs/butler/) is itch's CLI uploader. Requires `butler login` once
(opens a browser for the itch account) — **credentials are the human's**; never assume them.

```bash
butler push build/linux   <user>/<game>:linux       # one channel per platform
butler push build/macos   <user>/<game>:osx
butler push build/windows <user>/<game>:windows
butler push build/web     <user>/<game>:html5        # itch serves HTML5 channels playable in-browser
```

Tag the release with `--userversion 0.1.0` to mark **v0.1** of the game. Channel names map to
itch's per-platform download buttons; an `html5` channel embeds as the playable iframe.

## Verify the build (don't trust exit 0)

1. Artifact exists and is non-trivial: `ls -la build/<platform>/`.
2. Desktop smoke: launch the exported binary on its platform → look + move + jump + fire (the
   POC's gate). On a headless box you can't launch a GUI build — say so; report it as not run.
3. Web: open `build/web/index.html` via a local server (file:// won't load wasm) and confirm it
   boots; apply the D3 verdict on the outline look.

## Error → Fix

| Symptom                                                                   | Fix                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No export template found at the expected path`                           | Templates for this exact engine version not installed — see Prerequisite.                                                                                                                                                                   |
| `Cannot export project with preset "X" ... no matching`                   | `name=` in `export_presets.cfg` differs from the CLI string (case-sensitive).                                                                                                                                                               |
| Export "succeeds" (exit 0) but output is 0 bytes / missing                | Template mismatch or bad `export_path` — grep stderr for `ERROR`; check the preset platform string.                                                                                                                                         |
| macOS build won't open ("damaged") on another Mac                         | Unsigned POC build — right-click→Open, or `xattr -dr com.apple.quarantine`. Signing/notarization is out of POC scope.                                                                                                                       |
| `Target platform requires 'ETC2/ASTC' texture compression` (macOS export) | Set `textures/vram_compression/import_etc2_astc=true` under `[rendering]` in `project.godot`, then re-export. macOS templates ship only ASTC-compressed texture variants; default-off means none get imported. Linux/Windows don't need it. |
| Web build blank / wasm errors in console                                  | Served without COOP/COEP, or Forward+ feature unsupported under WebGL2 — apply the Web caveat verdict.                                                                                                                                      |
| `butler: command not found`                                               | Install butler (itch app → "install butler", or from itch.io/docs/butler) and `butler login`.                                                                                                                                               |

## Notes

- Engine seam: identical flow on Redot/Blazium — point `$GODOT` at the fork binary; templates
  must match that fork's version string.
- RTK: prefix the binary call with `rtk` (passes through). Do **not** pipe export output into
  `rtk grep` — use plain `grep` so `ERROR`/template lines aren't filtered. Never reference rtk in
  project files.
- This is an export skill, not a verification skill — run `godot-verify` on the scene first; a
  scene that fails verify will export a broken build just as happily.
