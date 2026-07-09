---
name: godot-project-baseline
agents: [godot-dev]
domain: godot-core
description: Establish or verify a Godot 4.x project's game-agnostic baseline — quality gates (warnings-as-errors, gdlint/gdformat), folder layout, naming, physics layers, input map — and record it in CLAUDE.md as the single source of truth. Use FIRST in any new project, on "set up the project" / "start a POC" / "initialize the game", or whenever another godot-* skill is about to run and CLAUDE.md has no "## Project conventions" section yet. Game-aesthetic decisions (renderer rationale, window/stretch, texture filters, art-style stack) do NOT live here — they belong in a project-local game-conventions skill this skill teaches you to create.
---

# Godot Project Baseline

This skill is the keystone: it makes project-wide decisions once, applies them to `project.godot`, and writes them into `CLAUDE.md`. All other `godot-*` skills must read `CLAUDE.md` before acting and must not contradict it.

It owns the **game-agnostic layer only** — quality gates and way-of-work. The **game-aesthetic layer** (renderer choice and its rationale, window/stretch, texture-filter defaults, art-style stack, camera-projection defaults) is per-game taste and lives in a **project-local** skill the designer authors once per game — see "Game-aesthetic conventions go project-local" below.

## Requirements

- Godot **4.3+** project (a `project.godot` file exists; if not, ask the user to create the project in the editor first — do not hand-write a `project.godot` from scratch).
- Run this **before** any other godot-\* skill on a fresh project.

## Procedure

1. **Check for existing conventions.** If `CLAUDE.md` already has a `## Project conventions` section, read it, report any conflicts with the defaults below to the user, and stop — do not overwrite established decisions without explicit approval.

2. **Install the quality gates** (the way-of-work contract, non-negotiable):
   - Strict gate files: ensure `project.godot` has the `[debug]` GDScript warnings escalated to errors (the warnings-as-errors contract), a `gdlintrc` (blocking lint caps + naming), and `gdstyle.toml` (in-editor advisory lint). The starter ships all three; for a pre-existing project, copy them from `starter/`.
   - Physics/render layers: layer 1 = world, layer 2 = player, layer 3 = enemies (extend, never renumber; record additions in `CLAUDE.md`).

3. **Create folder layout** (only the folders needed now; create others on demand):

   ```
   res://scenes/      main and composition scenes
   res://entities/    player, NPCs, props (one folder per entity)
   res://levels/      level scenes / blockouts
   res://shaders/post/  post-process shaders (if the game uses post effects)
   res://resources/   shared .tres resources
   ```

4. **Define input actions** in the Input Map: `move_left`, `move_right`, `move_forward`, `move_back` (WASD + arrows), `jump` (Space). Use these exact names; controller skills depend on them.

5. **Write the conventions to `CLAUDE.md`** (create the file if absent, append the section if the file exists). Use this exact template, filling in anything the user customized:

```markdown
## Project conventions

- Engine: Godot 4.3+ (reversed-Z).
- Aesthetics (renderer, window, texture filters, art-style stack, camera projection): decided by
  the project-local game-conventions skill (.claude/skills/); its decisions are recorded below,
  next to the baseline's.
- Folders: scenes/, entities/, levels/, shaders/post/, resources/. Reusable stateless GDScript → tools/lib/ (class_name helpers the game preloads, e.g. NodeBuilder); reusable stateful behavior → a component scene in entities/components/.
- Naming: node names PascalCase; files and folders snake_case; one scene per entity in entities/<name>/ (typing, naming regexes, file-header, size caps: skill godot-code-rules).
- Composition (SOLID): entity = engine-node base + component children; signals up / calls down; @export over subclass-per-variant; pure logic classes use \_init() constructor DI, no autoload service-locator (skill: godot-composition).
- Layers: 1 = world, 2 = player, 3 = enemies (extend, never renumber).
- Input actions: move_left, move_right, move_forward, move_back, jump.
- Code rules: strict typed GDScript (skill: godot-code-rules) — warnings-as-errors + gdlint/gdformat via the validate gate (blocking). In-editor linting: gdstyle (advisory; config gdstyle.toml, install tools/install_gdstyle.sh).
- Rule for AI sessions: read this section before structural changes; load godot-code-rules before writing or editing any .gd file; record new project-wide decisions here, not in chat.
```

## Game-aesthetic conventions go project-local

The baseline stops where taste starts. Renderer choice and its rationale, window size/stretch, texture-filter defaults, the art-style stack (pixelation, outlines, palettes), camera-projection defaults — these are one game's decisions, so they must not ship in this plugin. The pattern:

- **Author a project-local skill** at `<game>/.claude/skills/<game>-game-conventions/SKILL.md` (e.g. a game codenamed "nova" gets `nova-game-conventions`). Project-local skills load like any shipped skill — no plugin change needed, usable immediately.
- **Run order**: run it right after this baseline on a fresh project. It appends its decisions to the **same** `## Project conventions` section in `CLAUDE.md`, so every other skill still reads one source of truth.
- **If one proves universal** (genuinely not specific to that game), the promote flow exists: file `mcp__ui__promote { kind: "skills", name, reason }`; the user approves on the promotions board and runs `npm run promote` — never move files by hand. Default to keeping it local.

Example skeleton (a 3D pixel-art game's aesthetic payload — the kind of content that belongs in the project-local skill, not here):

```markdown
---
name: <game>-game-conventions
description: <Game>'s aesthetic conventions — renderer, window, art-style stack.
  Run right after godot-project-baseline on a fresh project.
---

# <Game> conventions (aesthetics)

1. Renderer: Forward+ (rendering/renderer/rendering_method="forward_plus") — required by the
   normal-roughness texture the outline shaders read. If the project targets web export,
   Compatibility is forced and normal-based outlines drop: record the limitation in CLAUDE.md
   instead of fighting it.
2. Window: base size 1920×1080; Stretch Mode canvas_items, Aspect keep.
3. Art style: 3D pixel art — 3D content renders inside a SubViewport (skill: godot-3d-pixelation);
   post-process effects attach to the camera inside it, single shader at
   res://shaders/post/post_process.gdshader (skill: godot-screen-effects); textures import with
   Nearest filtering (skill: godot-texture-import-pixel-art).
4. Camera: projection is genre-dependent — the pixel-art look comes from the SubViewport
   downscale, not the camera. Orthographic fixed-angle (skill: godot-orthographic-follow-camera)
   for top-down/iso; perspective eye-camera inside the SubViewport for first/third-person.
   Switching projection only trades texel-snapping behaviour — flag it, don't forbid it.
5. Record every decision in CLAUDE.md `## Project conventions`, under the baseline's lines.
```

## Verification checklist

- [ ] `CLAUDE.md` contains the `## Project conventions` section.
- [ ] `project.godot` has the `[debug]` warnings block; `gdlintrc` and `gdstyle.toml` are present (new games inherit all three from the starter).
- [ ] The five folders exist; Input Map lists the five actions.
- [ ] Aesthetics are covered: a project-local `<game>-game-conventions` skill exists (or the user explicitly deferred aesthetic decisions — record the deferral).
- [ ] Project opens and runs (F5) without errors (gray screen is fine at this stage).

## Error → Fix

| Symptom                                                                                                       | Fix                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conventions section exists but conflicts with these defaults                                                  | Existing project decisions win; report differences, don't overwrite                                                                                                                                                                                                                                                                                                                |
| Another godot-\* skill needs an aesthetic decision (renderer, viewport, filter) that CLAUDE.md doesn't record | Create/run the project-local `<game>-game-conventions` skill first (pattern above) — don't improvise a per-game decision in the middle of another skill                                                                                                                                                                                                                            |
| Input actions already exist with other names                                                                  | Map skill names onto the existing ones in CLAUDE.md instead of duplicating actions                                                                                                                                                                                                                                                                                                 |
| Tab/Enter/arrow input action does nothing at runtime (verify passes)                                          | Wrong `physical_keycode` integer. Non-printable keys use Godot's `KEY_*` values, which verify can't validate — only an F5 play-test catches it. KEY_TAB=4194306, KEY_ENTER=4194309, KEY_ESCAPE=4194305, KEY_SPACE=32; arrows L/U/R/D=4194319/4194320/4194321/4194322; modifiers SHIFT=4194325/CTRL=4194326/ALT=4194328. Printable letters/digits use the ASCII value (A=65, 0=48). |
