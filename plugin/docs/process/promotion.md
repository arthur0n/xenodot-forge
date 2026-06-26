# Promotion — game-local → framework plugin

A new capability (a **skill**, **agent**, or **tool**) starts **game-local** in a game's
`.claude/` and is usable immediately. It is **promoted** into this plugin — where it ships to
every game — only when it clears the gate below. **Default: stay local.** Promote deliberately,
so the framework stays scoped to game-dev and doesn't bloat.

## Rubric — promote only if all four hold

1. **General** — useful to _any_ game the framework builds; no coupling to one game's genre,
   content, or names.
2. **Proven** — succeeded in **≥1 real use** in a game, not speculative.
3. **Non-overlapping** — doesn't duplicate an existing framework capability.
4. **Owned** — the framework owner accepts maintaining it going forward.

If any criterion fails → it stays local (or is dropped).

## Flow

1. **Author game-local**, usable immediately.
2. **After the first successful real use**, the orchestrator runs the rubric. If it passes, it
   **offers** promotion to the human — never auto-promotes.
3. **On approval**, the human runs in the forge:
   `npm run promote -- <skills|agents|tools> <name>`
   The capability moves into `plugin/<kind>/` and re-syncs to every game.
4. **Fails the rubric** → stays local.

## Updating an existing core file (NOT a promote)

`promote` only **adds** a new capability — it moves a game-local file into the plugin and
**skips** any name already there. It has **no update mode**, by design: a blind whole-file
overwrite would drag game-specific content upstream.

So **never improve a materialized core file game-local** (`tools/*` — `validate.sh`,
`verify_scene.gd`, the smokes — or a materialized skill). Materialize copies the plugin source
over the game copy whenever the plugin is newer, so a game-local edit to a core file is fighting
the system and will eventually be overwritten. Instead:

- **General improvement** → edit the file **directly in the plugin** (`plugin/tools/…`,
  `plugin/skills/…`). It re-materializes to every game on the next startup/`doctor`.
- **New general helper** a core step needs → author it game-local, then `promote` it as a new
  `tools/` add (the normal flow; `promote` handles new files fine).
- **Game-specific gate step** (hardcoded scene list, a level-only check) → keep it in a
  **game-local extension** the core sources but never owns.

### The validate.sh core/extension seam

The plugin's `tools/validate.sh` runs the framework-general gate, then near its end sources an
optional game extension if present:

```bash
if [ -f tools/validate.local.sh ]; then source tools/validate.local.sh; fi
```

`tools/validate.local.sh` is **game-local, NOT materialized** (materialize is additive — it
never deletes or overwrites a file the plugin doesn't ship), so a game's own gate steps survive
every sync. General steps live in the plugin core; only this game's specifics
(e.g. a `node-clash` scene list, a level-only `nav-gate`) go in the extension.

## Exception — clearly-general agents

An agent whose generality is unambiguous (it serves _any_ game, with zero game coupling) may be
authored **directly in the plugin as provisional**, skipping the local-prove step — because the
refactor that centralised agents removed the game-local `.claude/agents/` path where an agent
would otherwise be proven. Mark such an agent provisional in its description until a real use
confirms it. This exception is for **agents only**, and only when criterion 1 (General) is
beyond doubt; skills and tools still follow the prove-local-first flow.

> First application: the **art-director** agent (general, but unproven) was authored straight
> into `plugin/agents/` under this exception.
