---
name: tasks-mcp
description: Use mcp__ui__tasks as a plan and scratchpad inside any agent run. Add tasks at start, update status as you work, then close them in one call (op complete_open) before you hand off or return. Visible in the UI right rail and persistent across sessions.
metadata:
  type: utility
---

# Tasks MCP — Plan & Scratchpad

`mcp__ui__tasks` is a persistent task board (`.xenodot/tasks.json`, shown in the UI right rail).
Calling it never pauses the session — call it freely between other tool calls. **Every result
lists the tasks still OPEN (with their ids)** — read it to see what's left and to get the `id`
you need for `update`/`remove`.

**Every run:** at START add your full plan as one batch; set each task `in_progress` before its
step and `done` after; then close anything still open in ONE call before you return.

```jsonc
{ "op": "add", "tasks": [ { "title": "Build scene", "owner": "agent" } ] } // batch at start
{ "op": "update", "id": "t3", "status": "in_progress", "note": "scratchpad" } // by id, from the OPEN list
{ "op": "update", "id": "t3", "status": "done" }
{ "op": "remove", "id": "t3" }                                               // step turned out unneeded
{ "op": "complete_open" }                                                    // close ALL your open tasks at once
```

- **`update`/`remove` target a task by `id`** (e.g. `t3`), NOT by title. The id comes from the
  add result / the OPEN list in every tool result. (Updating by title silently does nothing.)
- `owner`: `"agent"` (default), or `"user"` only for things the human must supply (an asset, a
  decision) — `user` tasks surface in the task / Get Assets modal. `note` is free-text scratchpad.

## Self-gate (before any handoff or return) — mandatory

The last thing you do before calling a handoff tool or ending your run:

```jsonc
{ "op": "complete_open" } // marks every task you own done, in one call
```

Then check the result: it must show **no OPEN tasks** of yours. `complete_open` is idempotent and
needs no ids — one call closes your whole scratchpad, so closing can never be half-done. (The
server also closes your tasks automatically when your run finishes, but call `complete_open`
yourself so the board is clean the instant you hand off, not a moment later.) Prefer one
`in_progress` task at a time and mark steps `done` as they finish, so the live board reflects
your real progress.
