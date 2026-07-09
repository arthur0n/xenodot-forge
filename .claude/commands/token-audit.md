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

3. **Analyze each log — don't slurp it into context.** These files reach several MB. Filter
   with `jq select(...)` directly — do NOT pipe `rtk grep` into `jq` (rtk's grep filter mangles
   JSON and breaks the parse). Look for:
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
   - **result-bytes by tool (the primary sweep — surfaces the real offender that raw freq counts hide):** map `tool_use_id`→name from assistant events, then sum tool*result char-length per tool. A tool with few calls but huge avg payload (e.g. an MCP docs lookup dumping 20k chars of \_immutable* reference per call) is the prize. Also: freq counts of Bash `.input.command` are unreliable — multi-line heredocs make `uniq -c` count physical lines, not commands; trust the byte-by-tool aggregate instead.
     `jq -rc 'select(.type=="event" and .message.type=="assistant")|.message.message.content[]?|select(.type=="tool_use")|[.id,.name]|@tsv' "$LOGS/<file>" > /tmp/ids.tsv`
     `jq -rc 'select(.type=="event" and .message.type=="user")|.message.message.content[]?|select(.type=="tool_result")|[.tool_use_id,(((.content//"")|if type=="array" then (map(.text//"")|join("")) else tostring end)|length)]|@tsv' "$LOGS/<file>" > /tmp/res.tsv`
     `awk -F'\t' 'NR==FNR{n[$1]=$2;next}{k=n[$1];k=(k==""?"?":k);t[k]+=$2;c[k]++}END{for(x in t)printf "%-30s calls=%-5d chars=%d avg=%d\n",x,c[x],t[x],t[x]/c[x]}' /tmp/ids.tsv /tmp/res.tsv | sort -t= -k3 -rn`

4. **Judge opportunities.** For each pattern, ask: _could this run without a model?_ If yes,
   name it concretely — the operation, its rough token/$ cost over the sessions seen, and the
   deterministic replacement (script / `tools/` entry / hook). Discard anything that genuinely
   needs judgment; a false "make it deterministic" is worse than silence.
   - **Check the token MECHANISM, not just the call count.** Tokens are the PAYLOAD that enters
     context, not the number of calls. Fewer calls ≠ fewer tokens if each call returns the same
     bytes — a memo/cache that re-returns an identical payload saves latency, NOT tokens. To move
     the metric the replacement must shrink the payload (smaller/filtered result), DEDUP it (return
     a stub on a repeat), or stop it re-entering context. (Learned from `godot-docs-memoize`:
     "memoize get_class" was mis-scoped — a cache hit still re-dumps 20k chars; the real fix was a
     canUseTool dedup that denies the repeat.)
   - **Prefer a fix that emits a COUNTABLE PROOF over one you can only confirm by global drift.** A
     replacement whose effect shows ONLY as cost drift across different future sessions is
     near-unmeasurable — the covered set changes every run, so the trend is noisy and rarely
     attributable. Favour a fix that emits a per-event signal you can later COUNT: e.g. the shipped
     docs-dedup denial logs `policy:"docs-dedup"` once per blocked repeat, so a future audit tallies
     `denials × ~5k tok` for a DETERMINISTIC actual saving instead of hoping the line moves. When an
     opportunity can be built either way, prefer the instrumented one; and when you file it (steps
     5–6), NAME the signal it should emit — the log marker + the per-event token unit — so
     `/token-audit-fix` instruments it and a later run tallies it (`pending` → hard actual).

5. **Record — super brief (prose) + deterministic numbers.**
   - Prose: append ONE entry to `LEDGER.md` (template at the top of that file) and add each
     analyzed tag to `Covered sessions`. Most-important offenders only; scannable; no essays.
   - Numbers: capture the run in the PERMANENT time-series — the numbers come from the SCRIPT,
     not a prose guess:
     `node ui/server/cli/token-history.js append --sessions <tag,tag,…> --offender "<top offender>" --opp <opp-id>:<estTok> --note "<one line>"`
     (repeat `--opp` per opportunity; `--date` defaults to today). This writes `history.json` and
     regenerates `history.md`. See `.claude/token-audits/README.md` for the loop + file roles.

6. **File a task per real opportunity.** `mcp__ui__tasks` with
   `{ "op": "add", "tasks": [ { "title": "<deterministic fix in one line>", "owner": "user", "note": "<the agent call it replaces + rough saving>" } ] }`.
   `owner: "user"` so it persists for the human (don't `complete_open` these). Put the
   returned task id in the ledger entry's `Opportunity` line — and use that SAME id as the
   `--opp <id>` in step 5 so the task, the ledger, and `history.json` all key off one id (the
   human later applies it with `/token-audit-fix <id>`). **Fallback:** `mcp__ui__tasks` only
   exists inside a forge web session — from a plain terminal run it's unavailable. Then record
   the task inline in the ledger entry (a `**TASK (owner:user)**:` line) and say so.

7. **Adapt on the trend, then critique the process.** This is self-improvement — improve the
   loop, not just the game.
   - Adapt: read the last few `history.json` records (or `history.md`). Note the `global.hitRate`
     / `$/turn` trend, and for any prior opportunity now `landed` check whether it `moved` — a
     `moved:false` says the last fix didn't pay off; factor that into what you propose next. This
     is the loop learning from its own objective signal, independent of the framework.
   - **Confirm every open pending — a forward-looking fix must not rot unmeasured.** Enumerate them
     deterministically: `node ui/server/cli/token-history.js pending` (add `--json` to consume the
     list). For EACH id it prints, try to confirm this run — don't skip one just because it's noisy:
     - **Countable signal** (step 4 named a marker): count it across the sessions you just covered —
       `jq -rc 'select(.type=="event" and .message.type=="assistant")|.message.message.content[]?|select(.policy=="<marker>")' <logs> | wc -l` —
       and if it fired, multiply by the per-event token unit and flip to a hard actual with
       `token-history.js land --opp <id> --moved true --delta-tok <count×unit>`. A direct count is
       deterministic confirmation; it retires a `pending` without waiting on noisy global drift.
     - **No countable signal** (e.g. a cross-session cache fix like `godot-docs-memoize`): compare
       the relevant `history.json` metric (global `$/turn`, `hitRate`, or the offender's per-call
       tokens) BEFORE vs the sessions since it landed. Moved clearly → `land --opp <id> --moved true|false`
       with the Δ; still ambiguous → leave it `pending` but SAY SO in the return + `Process note` so
       the next run re-checks it (the `pending` verb resurfaces it every run — that's the anti-rot guarantee).
   - Critique (in a subagent): dispatch this critique to a throwaway subagent so its reasoning never
     becomes main-window context debt — hand it the run's notes and have it propose one fix to THIS
     command, the CLI, or the ledger/history format (confusing wording, a missing reference, a better
     signal, a step that didn't pay off), and if a fix is obvious and safe apply it there. It RETURNS
     ONLY the one-line verdict — record that as the entry's `Process note` (or `none`). Keep the
     verdict, not the critique transcript. (The Adapt bullets above stay in the main window — they
     feed the decision; only the critique reasoning moves out.)

8. **Return.** Super-brief to the user: sessions covered, the single top offender, tasks filed,
   and one line on the trend. To APPLY an opportunity, point them at `/token-audit-fix <id>`.

## Domain separation (positive rule)

- Token findings live ONLY in the token loop: `LEDGER.md` + `history.json` + `mcp__ui__tasks`.
  The two self-improvement loops link by REFERENCE, never auto-route.
- If a session reveals a framework-quality issue (a convention/agent/skill defect, not a spend
  pattern), hand it to the human to file on `.claude/framework-audits/LEDGER.json` — manual only.

## Do this

- **Scan only fresh sessions** — skip any already in `Covered sessions`.
- **Filter logs with `jq select(...)` first** — never pipe `rtk grep` into `jq` (it mangles JSON),
  and never read whole multi-MB logs into context.
- **Recommend and file tasks; let the human decide.** This command surfaces opportunities and files
  tasks; the deterministic fix lands via `/token-audit-fix` (step 7's process tweaks to the
  command/ledger are the one exception).
- **Write one-line ledger entries** — brevity is the point; the next run reads this first.
