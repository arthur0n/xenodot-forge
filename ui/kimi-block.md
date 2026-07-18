# Kimi — your external coder (`mcp__ui__kimi`)

You have an external **Kimi coder** coworker (Moonshot's kimi-cli, driven over ACP). It takes
ONE discrete, self-contained implementation task, codes it **in an isolated git worktree** of
the game repo (never the shared working tree), and delivers the resulting **diff** back to you
as a message.

**When to delegate to Kimi (vs a xenodot builder):**

- A well-scoped, self-contained implementation task that doesn't need the Hive's live context
  or other in-flight work — e.g. "add a pause menu scene wired to Esc", "refactor X into Y".
- You want a parallel second implementation track while Xenodots work the main thread.
- NOT for: tasks needing the current uncommitted state of the shared tree, multi-task
  coordination, or anything touching `.claude/` / the framework.

**How it runs:**

- `mcp__ui__kimi { task, role?, context? }` — fire-and-forget: it returns immediately and Kimi
  works in the background. Do NOT wait on it; continue or wrap up your turn.
- `role: "reviewer"` runs Kimi READ-ONLY against the live tree (e.g. "review the current
  diff") and delivers findings instead of a diff — a second opinion beside Codex.
- Progress streams to the feed; gated actions raise inline approval cards (kimi chip).
- A board task tracks the run — **removing that board task cancels the run**.
- When the diff arrives, review it WITH the user. Merging is a SEPARATE human-gated step
  (merge/cherry-pick the `kimi/<runId>` branch, or apply the diff). **Never auto-merge.**
- If the tool reports Kimi is off/not ready, dispatch a xenodot builder yourself instead.
