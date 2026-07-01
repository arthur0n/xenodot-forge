---
description: Daily token-usage audit — scan the 2 newest unanalyzed session logs for agent/LLM turns that could be deterministic, record offenders in the ledger, and file a task per opportunity. Self-improving. Manual, human-run. Forge-local (not shipped).
argument-hint: "[N | session-tag]"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, mcp__ui__tasks
model: opus
---

# Token audit — find agent turns we could make deterministic

A daily habit, not a one-shot. Each run mines a couple of session logs for spend we
could remove, records what it found so the next run skips it, files tasks for the human,
and critiques itself. You won't get it right the first time — that's expected.

## Why this exists

- Cache reads dominate a session's token cost. We just made the live meter count all four
  token classes (`ui/client/core/reducer.js#foldResult`) and added per-session cost to
  `/api/usage` (`ui/server/core/http/usage.js`) — so the data is now trustworthy.
- **Goal:** spot turns where the hive spent an agent/LLM call on something a script, a
  `tools/` entry, or a hook could do deterministically — then propose replacing it. Every
  such replacement is tokens we never spend again.

## Where the data lives

- Session logs: `logs/session-*.ndjson` (the forge's `logs/` dir; cwd = forge root).
  Filenames are ISO timestamps, so a lexical sort is chronological. The tag is the part
  between `session-` and `.ndjson`.
- Each line is `{ts, dir, type, message, ...}`. The signals you want:
  - `result` events → `message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}` and `message.total_cost_usd` (per turn).
  - `assistant` events → `message.message.content[].{type:"tool_use", name, input}` (the actual `Read`/`Grep`/`Glob`/`Bash`/`Task`/`Agent` calls) and `parent_tool_use_id` (subagent nesting).
- Ledger: `.claude/token-audits/LEDGER.md` — read first, append after.

## Steps

1. **Read the ledger.** Open `LEDGER.md`. Note its `Covered sessions` list and prior
   `Process note`s so you neither re-analyze a covered session nor repeat a known finding.

2. **Pick scope.** List the log files. Drop any whose tag is already in `Covered sessions`.
   Take the newest **2** of what remains. `$ARGUMENTS` overrides: a bare number sets the
   count (e.g. `4`); a session-tag analyzes exactly that session. If nothing is uncovered,
   say so and stop — don't invent work.

3. **Analyze each log — don't slurp it into context.** These files reach several MB. Use
   `rtk grep` + `jq` to pull only what you need. Look for:
   - **Repeated identical tool calls** — the same `Read`/`Grep`/`Glob`/`Bash` input across
     many turns (context the model keeps re-fetching).
   - **Agent dispatch for mechanical work** — a `Task`/`Agent` spawn whose job was a
     structural transform, a rename, a lookup, or a check that has one deterministic answer.
   - **Cache churn** — large `cache_creation_input_tokens` repeated, i.e. the same prompt
     prefix rebuilt instead of reused.
   - **Costliest turns** — sort `result` lines by `total_cost_usd` (or token total) and ask
     what that money bought.

   Example sweep (adapt; `$LOGS` = `logs`). Filter the ndjson with `jq
select(...)` directly — do NOT pipe `rtk grep` into `jq`: rtk's grep filter mangles JSON and breaks
   the `jq` parse. Each log line is `{type:"event", message:{…}}`, so select on `.message.type`:
   - costliest turns: `jq -c 'select(.type=="event" and .message.type=="result") | .message | {cost:.total_cost_usd, u:.usage}' "$LOGS/<file>"`
   - tool-call frequency: `jq -r 'select(.type=="event" and .message.type=="assistant") | .message.message.content[]? | select(.type=="tool_use") | .name' "$LOGS/<file>" | sort | uniq -c | sort -rn`

4. **Judge opportunities.** For each pattern, ask: _could this run without a model?_ If yes,
   name it concretely — the operation, its rough token/$ cost over the sessions seen, and the
   deterministic replacement (script / `tools/` entry / hook). Discard anything that genuinely
   needs judgment; a false "make it deterministic" is worse than silence.

5. **Record — super brief.** Append ONE entry to `LEDGER.md` (template at the top of that
   file) and add each analyzed tag to `Covered sessions`. Most-important offenders only;
   keep it scannable. No essays.

6. **File a task per real opportunity.** `mcp__ui__tasks` with
   `{ "op": "add", "tasks": [ { "title": "<deterministic fix in one line>", "owner": "user", "note": "<the agent call it replaces + rough saving>" } ] }`.
   `owner: "user"` so it persists for the human (don't `complete_open` these). Put the
   returned task id in the ledger entry's `Opportunity` line.

7. **Critique the process.** This is self-improvement — improve the loop, not just the game.
   Suggest fixes to THIS command or the ledger format: confusing wording, a missing
   reference, a better signal to grep for, a step that didn't pay off. Record it as the
   entry's `Process note` (or `none`). If a fix is obvious and safe, make it.

8. **Return.** Super-brief to the user: sessions covered, the single top offender, tasks filed.

## Never

- Re-analyze a session already in `Covered sessions`.
- Read whole multi-MB logs into context — always filter with `rtk grep`/`jq` first.
- Implement the deterministic fix here — this command recommends and files tasks; the human
  decides. (Step 7's process tweaks to the command/ledger are the one exception.)
- Write a long ledger entry. Brevity is the point — the next run reads this first.
