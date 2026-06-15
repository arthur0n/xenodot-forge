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

## Exception — clearly-general agents

An agent whose generality is unambiguous (it serves _any_ game, with zero game coupling) may be
authored **directly in the plugin as provisional**, skipping the local-prove step — because the
refactor that centralised agents removed the game-local `.claude/agents/` path where an agent
would otherwise be proven. Mark such an agent provisional in its description until a real use
confirms it. This exception is for **agents only**, and only when criterion 1 (General) is
beyond doubt; skills and tools still follow the prove-local-first flow.

> First application: the **art-director** agent (general, but unproven) was authored straight
> into `plugin/agents/` under this exception.
