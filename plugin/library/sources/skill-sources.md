# External skill sources

Canonical registry of the external skill collections the **skill-researcher** agent
searches during the self-improvement loop. Nothing here is bundled with the repo or
loaded into context by default — each source is downloaded at runtime to a per-user
cache on first use, so a fresh clone of this repo works with only git + network.

Cache root: `$HOME/.cache/xenodot/` (machine-local, shared across clones of this
repo, safe to delete — it re-downloads on next use). Never edit files inside a cache;
never copy a collection wholesale into the project.

## GodotPrompter

- **Source**: https://github.com/jame581/GodotPrompter (MIT)
- **Cache**: `$HOME/.cache/xenodot/GodotPrompter`
- **Bootstrap**: `git clone --depth 1 https://github.com/jame581/GodotPrompter "$HOME/.cache/xenodot/GodotPrompter"`
- **Refresh**: `git -C "$HOME/.cache/xenodot/GodotPrompter" pull --ff-only` — best-effort; offline failure is fine, use the cached copy
- **Layout**: skills in `skills/<name>/SKILL.md` (+ `references/`); ~47 skills, many 2D-only or C# (this project is 3D pixel art, GDScript-only)
- **Attribution on adopt**: `Adapted from GodotPrompter (https://github.com/jame581/GodotPrompter), MIT License, Copyright (c) GodotPrompter Contributors.`

## Adding a source

One section per collection in this file: source URL + license, cache path under
`$HOME/.cache/xenodot/`, bootstrap and refresh commands, layout notes, and the
attribution line adopted skills must carry. Licenses must permit adaptation (MIT,
Apache-2.0, CC-BY…); the skill-researcher rewrites — never copies — into
`.claude/skills/godot-<name>/`.
