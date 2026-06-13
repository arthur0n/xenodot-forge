---
name: godot-project-conventions
description: Establish or verify the baseline conventions of a Godot 4.x 3D pixel-art project — renderer, window/stretch settings, folder layout, naming, input map — and record them in the project's CLAUDE.md so every other skill and session reads decisions from one place. Use this skill FIRST in any new Godot project, whenever the user says "set up the project", "start a POC", "initialize the game", or whenever another godot-* skill is about to run and no "## Project conventions" section exists in CLAUDE.md yet.
---

# Godot Project Conventions

This skill is the keystone: it makes project-wide decisions once, applies them to `project.godot`, and writes them into `CLAUDE.md`. All other `godot-*` skills must read `CLAUDE.md` before acting and must not contradict it.

## Requirements

- Godot **4.3+** project (a `project.godot` file exists; if not, ask the user to create the project in the editor first — do not hand-write a `project.godot` from scratch).
- Run this **before** any other godot-\* skill on a fresh project.

## Procedure

1. **Check for existing conventions.** If `CLAUDE.md` already has a `## Project conventions` section, read it, report any conflicts with the defaults below to the user, and stop — do not overwrite established decisions without explicit approval.

2. **Apply settings** (edit `project.godot` directly, or instruct the user for editor-only steps):
   - Renderer: **Forward+** (`rendering/renderer/rendering_method="forward_plus"`). Required by the normal-roughness texture used in outline shaders. Non-negotiable for this art style; flag to the user if the project targets web export (Compatibility-only), since that drops normal-based outlines.
   - Window: base size **1920×1080**; Stretch Mode `canvas_items`, Aspect `keep`.
   - Physics/render layers: layer 1 = world, layer 2 = player, layer 3 = enemies (extend, never renumber).

3. **Create folder layout** (only the folders needed now; create others on demand):

   ```
   res://scenes/      main and composition scenes
   res://entities/    player, NPCs, props (one folder per entity)
   res://levels/      level scenes / blockouts
   res://shaders/post/  post-process shaders
   res://resources/   shared .tres resources
   ```

4. **Define input actions** in the Input Map: `move_left`, `move_right`, `move_forward`, `move_back` (WASD + arrows), `jump` (Space). Use these exact names; controller skills depend on them.

5. **Write the conventions to `CLAUDE.md`** (create the file if absent, append the section if the file exists). Use this exact template, filling in anything the user customized:

```markdown
## Project conventions

- Engine: Godot 4.3+ (reversed-Z). Renderer: Forward+ (required by outline shaders).
- Art style: 3D pixel art. 3D content renders inside a SubViewport (skill: godot-3d-pixelation); post-process effects attach to the camera inside it.
- Camera: orthographic, fixed angle (skill: godot-camera-rig). Do not switch to perspective without flagging the texel-snapping consequence.
- Folders: scenes/, entities/, levels/, shaders/post/, resources/.
- Naming: node names PascalCase; files and folders snake_case; one scene per entity in entities/<name>/.
- Input actions: move_left, move_right, move_forward, move_back, jump.
- Shader contract: single post-process shader at res://shaders/post/post_process.gdshader; helpers get_linear_depth(), get_normal() (skill: godot-screen-textures).
- Code rules: strict typed GDScript (skill: godot-code-rules) — warnings-as-errors, gdlint/gdformat, validate gate.
- Rule for AI sessions: read this section before structural changes; load godot-code-rules before writing or editing any .gd file; record new project-wide decisions here, not in chat.
```

## Verification checklist

- [ ] `CLAUDE.md` contains the `## Project conventions` section.
- [ ] `project.godot` shows `rendering_method="forward_plus"` (absence of the key also means Forward+, the default).
- [ ] The five folders exist; Input Map lists the five actions.
- [ ] Project opens and runs (F5) without errors (gray screen is fine at this stage).

## Error → Fix

| Symptom                                                      | Fix                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Conventions section exists but conflicts with these defaults | Existing project decisions win; report differences, don't overwrite                                           |
| Project must export to web                                   | Compatibility renderer forced → normal-based outline features unavailable; record the limitation in CLAUDE.md |
| Input actions already exist with other names                 | Map skill names onto the existing ones in CLAUDE.md instead of duplicating actions                            |
