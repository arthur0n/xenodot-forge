---
description: Harvest past session logs for recurring framework friction — mine logs/session-*.ndjson (human corrections, agent errors, ask-storms), distil into framework findings, append to the audit ledger as open findings. The automated sibling of /framework-feedback. Never auto-applies; the human applies via /framework-audit-fix. Manual, human-run. Forge-local (not shipped).
argument-hint: "[N | session-tag]"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, mcp__ui__ask
model: opus
---

# Harvest sessions — turn past session logs into framework findings (the river)

The automated, past-logs sibling of `/framework-feedback` (which distils the CURRENT conversation).
This one mines **finished session logs** for friction that recurs across sessions — a skill the human
keeps correcting, an agent that keeps stopping to ask, a rule that keeps getting re-stated, a tool
that keeps erroring — and turns the pattern into a framework finding. It is the Pillar 2+3 "river":
the loop only improves if the lake keeps filling, and your own sessions are the richest inflow.

This command is **forge-local and human-run**. It **reports + proposes only** — it does not auto-fix,
auto-file, schedule itself, or write under `plugin/`. Each finding gets a stable id; the human then
runs **`/framework-audit-fix <ids>`** to apply exactly the ones they agree to. Run it caveman.

## Why this exists

`/framework-audit` scans the spine cold (the files); `/framework-feedback` catches the conversation
you just had. Neither sees friction that only shows up as a **pattern across many past sessions**.
`/token-audit` already reads these same logs — but only for token _cost_. Nothing reads them for
framework _quality_. This command is that reader: logs → recurring friction → the same human-gated
bucket flow. No new infrastructure — it writes to the SAME `.claude/framework-audits/LEDGER.json` and
is applied by the SAME `/framework-audit-fix`.

## Where the data lives (repo-relative; cwd = forge root)

- **Logs:** `"$CLAUDE_PLUGIN_ROOT/../logs"/session-*.ndjson` (the forge's `logs/` dir — same source
  `/token-audit` mines). Filenames are ISO timestamps → a lexical sort is chronological; the **tag**
  is the part between `session-` and `.ndjson`. Sizes run 650 B → 16 MB — **never slurp one into
  context.**
- **Per-line schema** `{ts, dir, type, …}`. The friction signals are CHEAP to pull:
  - **`type=="user_input"` → `.text`** — the human's prompts, verbatim (often <10 lines in a
    multi-thousand-line session). A re-prompt, a "no / not like that / actually do X", a correction
    right after an agent finished = a framework artifact underdelivered. **Primary signal.**
  - **`type=="event"` → `.message`** — the wrapped SDK message. Failures live here:
    `.message.type=="result"` with `.subtype!="success"`; `SCRIPT ERROR` / engine errors in text;
    a `tool_result` with `is_error`; hook failures. (Same `.message.*` shape `/token-audit` uses.)
  - **`type=="ask"`** — an agent stopped to ask the human. A storm of asks in one domain = ambiguity
    in a skill/rule worth tightening.
- **Ledger (write findings here):** `.claude/framework-audits/LEDGER.json` — the SOURCE OF TRUTH
  (a `findings[]` array); read FIRST (dedup), append AFTER (push objects, then `npm run ledger`).
  `LEDGER.md` / `ledger.html` are GENERATED VIEWS — never hand-edit. Its meta defines the
  **dimensions D1–D9**, **buckets** (3/4/5/6), **verdict** and **status**. Reuse them exactly —
  `/framework-audit-fix` resolves by id. Schema: `.claude/framework-audits/README.md`.
- **Coverage sidecar:** `.claude/framework-audits/harvested-sessions.txt` — one session-tag per line,
  the sessions already harvested. Read first so you never re-scan; append after. Create it if absent.

**Filter with `jq select(...)` directly (grep only on jq's text output) to pull only the lines you need — NEVER read a whole multi-MB log.**
(For a literal contamination sweep you'd use full-path `rg`, but here you're extracting a few typed
lines, which `rtk grep`/`jq` handle.)

## Steps

1. **Read coverage + ledger.** Open `harvested-sessions.txt` (the covered tags) and parse `LEDGER.json`
   (its `findings[]` still `open`/`later` + the `lastAudit` line). So you neither re-scan a covered
   session nor re-file a finding already recorded.

2. **Pick scope.** List `logs/session-*.ndjson`, drop tags already in the coverage file, take the
   newest **2** of what remains. `$ARGUMENTS` overrides: a bare number sets the count (e.g. `4`); a
   session-tag harvests exactly that session. Skip the tiny stub logs (a few hundred bytes = a session
   that opened and closed with no work). If nothing uncovered remains, say so and stop — don't invent.

3. **Extract the cheap slices with `jq` — don't slurp, and do NOT pipe `rtk grep` into `jq`.** `jq`
   reads ndjson line-by-line and emits only the fields you ask for, so it never loads the transcript
   into context. Do **not** prefilter with `rtk grep` — rtk's grep filter mangles JSON and breaks
   `jq` parse (verified). Filter with `jq select(...)` directly. Per chosen log (`$L` = the file):
   - human turns: `jq -r 'select(.type=="user_input") | .text' "$L"`
   - failures: `jq -c 'select(.type=="event" and .message.type=="result" and .message.subtype!="success") | .message.subtype' "$L" | sort | uniq -c`
   - text errors: `jq -r 'select(.type=="event") | (.message|tostring)' "$L" | grep -iE 'SCRIPT ERROR|is_error' | head` (grep on `jq`'s TEXT output is fine — never on raw JSON lines)
   - ask volume: `jq -s '[.[]|select(.type=="ask")]|length' "$L"`
     Read those slices, not the transcript.

4. **Distil recurring friction.** From the human turns + failures, find where a FRAMEWORK artifact
   underdelivered: a correction that implies a skill's steps were wrong/missing; the same instruction
   repeated across turns/sessions (a rule that isn't loading or isn't clear); an agent erroring or
   asking on something a skill should have settled. Phrase each as ONE actionable statement tied to a
   real file. Weight **recurrence** — a one-off is noise; a pattern across turns/sessions is signal.
   Aim for the handful that matter (usually 1–3), not a transcript paraphrase.

5. **Filter OUT game-specific friction — the load-bearing guard.** A finding is valid here only if it
   improves the FRAMEWORK (general to any game). Friction about THIS game's content/names/scenes/
   one-off facts is NOT a framework finding: say so and point it game-local (the game repo's
   `.claude/` / `design/` / its own `library/`). Never route a game fact into a `plugin/` skill or
   `plugin/library/` — it ships to every game (promotion rubric; audit **D2**). Drop these from the
   ledger write.

6. **Map + write an explicit fix; dedup; append.** For each surviving finding: tag the **nearest
   dimension** `<Dn>` (D1 over-cap agent · D2 contamination · D3 name↔scope · D4 data-driven · D5
   bloat/dup · D6 orchestrator · D7 commands · D8 verify-flow · D9 harness) so `/framework-audit-fix`'s
   playbook applies; write the **fix concretely** (target `file` + before→after / block to add);
   assign **bucket**/`verdict`/**id** `<Dn>-<slug>` (reuse an existing id for the same issue). Push
   ONE `open` object per finding to `LEDGER.json`'s `findings[]` — `{ id, dim, bucket, verdict,
status: "open", finding }` (`dim` = the id's `D`-prefix) — then run `npm run ledger`. Don't
   duplicate an id already in `findings[]`. Keep each `finding` one line.

7. **Record coverage.** Append every scanned tag to `harvested-sessions.txt` (even ones that yielded
   no finding — they're covered). The next run skips them.

8. **Present — terse, then hand off.** Per finding: id · the one-line fix · verdict. Sessions covered,
   top recurring friction. Then tell the human to run **`/framework-audit-fix <ids>`** with the ids
   they agree to (recommend which). If nothing framework-general survived step 5, say so plainly and
   write no findings (still record coverage). **Never auto-apply.**

9. **Self-critique.** This is self-improvement — improve the loop, not just the findings. Suggest one
   tweak to THIS command or the ledger format (a better signal to grep, a missing case), recorded as
   the entry's `Process note` (or `none`). If a fix is obvious and safe, make it.

## Never

- Read a whole multi-MB log into context — always filter to the typed slices with `jq select(...)` directly (grep only on jq's text output).
- Re-scan a session whose tag is in `harvested-sessions.txt`.
- Auto-apply a fix, or write under `plugin/` — this command records; `/framework-audit-fix` applies
  the agreed ids; the human decides. (Step 9's tweak to this command / ledger is the one exception.)
- File a **game-specific** learning as a framework finding — strip it; it lives game-local
  (`plugin/library/` is for AGNOSTIC records, NOT game facts).
- Re-file a finding already `open`/`later`, or invent friction the logs don't actually show.
- Search with bash `grep` (it's `rtk`-filtered and drops matches; use `rtk grep`/`jq` or full-path
  `rg`), or run shell without `rtk`.
- Write a long ledger entry. Brevity is the point — the next run reads this first.
