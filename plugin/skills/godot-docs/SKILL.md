---
name: godot-docs
agents: [builders]
domain: godot-core
description: >
  The Godot docs MCP (mcp__godot-docs__*) is the SOURCE OF TRUTH for engine API — class
  names, method/signal/property signatures, enums, and deprecations. Use BEFORE asserting
  any API: when unsure of a signature, when a `VERIFY-FAIL unknown property` smells like a
  Godot 3→4 rename, or when choosing between two APIs. Verify, don't recall — never write a
  signature from memory you could have checked. Mounted only when the user enabled the docs
  MCP (Settings → "Enable Godot docs MCP"); if the tools aren't present, say so.
---

# Godot Docs — verify, don't recall

The official Godot documentation is mounted as an MCP server. Recalled-from-memory Godot
APIs are **unverified** — a frequent source of silent failures (Godot 3 names, dropped
properties; skill: godot-verify). Check the docs before you write the API.

## The three tools

| Tool                                    | Use it to…                                                                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp__godot-docs__godot_docs_get_class` | **Primary.** Full API for one class — methods, signals, properties, enums, inheritance. Pass the class name (`"CharacterBody3D"`). Go straight here whenever you know the class.                                       |
| `mcp__godot-docs__godot_docs_get_page`  | fetch a specific tutorial/guide/class page by URL or path for a recommended pattern.                                                                                                                                   |
| `mcp__godot-docs__godot_docs_search`    | best-effort keyword discovery when you don't know the class yet. **May return `[]`** (Godot's site search is client-side) — if it does, don't conclude "no docs"; go direct with `get_class` on the likely class name. |

## When to consult (not optional)

- **Before writing an unfamiliar API** — a method/signal/property/enum you're not 100% sure of.
- **On a `VERIFY-FAIL ... unknown property "X"`** (skill: godot-verify) — it usually means a
  Godot 3→4 rename. Confirm the 4.x name via `godot_docs_get_class` rather than guessing
  (e.g. `material/0` → `surface_material_override/0`, `energy_multiplier` → `light_energy`).
- **When two APIs could work** — read both signatures and pick deliberately.
- **For a deprecation or a "what's the recommended way" question** — `godot_docs_get_page`.

If a quick lookup turns into a deep research detour, hand it to the
`xenodot:godot-docs-evangelist` agent instead of derailing your build.

## Rules

- **Cite what you verified.** When an API call rests on a docs lookup, note the class/method
  you confirmed so the next agent doesn't re-check.
- **Never invent.** If the docs don't cover it (or the MCP isn't mounted), say "unverified —
  docs MCP unavailable" rather than asserting a signature from memory.
- **Scope:** the server targets canonical Godot (`/en/stable`). For Redot/Blazium-fork-only
  APIs it may not have the page — flag that explicitly instead of guessing.
- The docs MCP reads docs only. It does not run the engine or verify a scene — that stays
  `tools/validate.sh` + skill: godot-verify.
