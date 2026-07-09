---
description: Compress the feedback loop — distill THIS conversation into one (or few) concrete framework finding(s) and append them to the audit ledger as open findings. Never auto-applies; the human applies via /framework-audit-fix. Manual, human-run. Forge-local (not shipped).
argument-hint: "[hint — e.g. 'godot-enemy missed the navmesh rebake step']"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, mcp__ui__ask
model: opus
---

# Framework feedback — turn the conversation you just had into a ledger finding

The third sibling of `/framework-audit` (scans the spine cold) and `/framework-audit-fix` (applies
agreed ids). This one is the **fast on-ramp**: instead of a full cold sweep, it **distills the
current conversation** into a concrete, framework-general improvement and records it — so a learning
that surfaced mid-session doesn't evaporate. Run it caveman + the moment a learning lands ("that
skill's steps were wrong", "this agent over-reached", "that command's path was stale").

This command is **forge-local and human-run**. It **reports + proposes only** — it does not auto-fix,
auto-file, schedule itself, or write under `plugin/`. Each finding gets a stable id; the human then
runs **`/framework-audit-fix <ids>`** to apply exactly the ones they agree to. **The human decides
every change.** Writing the finding IS the whole job here.

## Why this exists

Pillar 5 of the self-improvement framework is "compress your feedback loops": the loop only learns if
you feed it the moment you learn — _"based on this conversation, improve this skill."_ `/framework-audit`
is the heavy cold scan; without a cheap on-ramp, the in-the-moment learning is lost until the next
audit (or forever). This command is that on-ramp — one conversation → one (or few) honest findings →
the existing human-gated bucket flow. No new infrastructure: it writes to the SAME ledger and is
applied by the SAME `/framework-audit-fix`.

## Where the data lives (repo-relative; cwd = forge root)

- **Ledger (write here):** `.claude/framework-audits/LEDGER.json` — the SOURCE OF TRUTH (a `findings[]`
  array); read FIRST (dedup), append AFTER (push objects, then `npm run ledger`). `LEDGER.md` /
  `ledger.html` are GENERATED VIEWS — never hand-edit. Its meta defines the **dimensions D1–D10**, the
  **buckets** (3 no-brainer · 4 improvement · 5 system/later · 6 skip), the **verdict** (`fix-now` 3/4 ·
  `later` 5 · `skip` 6) and **status** (`open` · `skip` — applied findings are REMOVED, never stamped
  `done`). Reuse them exactly — `/framework-audit-fix` resolves by id. Schema: its `README.md`.
- **Likely targets a finding points at:** `plugin/skills/*/SKILL.md`, `plugin/agents/*.md`,
  `ui/orchestrator.md`, `plugin/commands/*.md`, and the forge-local commands themselves.
- **Search with the Grep TOOL or `/opt/homebrew/bin/rg` (full path), NEVER bash `grep`** — the `rtk`
  hook silently drops/mangles matches, so a confirm-the-target sweep done with bash grep can miss the
  ref you're citing. Use the Grep tool / full-path `rg` / Read; don't slurp whole files.

## Steps

1. **Read the ledger.** Parse `LEDGER.json` (its `findings[]`). Note the findings still `open`/`later`
   and the `lastAudit` line — so you neither re-file a finding already recorded nor re-surface one
   already resolved.

2. **Distill the conversation's framework learnings.** Look back over THIS session for moments where a
   framework artifact under-delivered or a reusable lesson emerged — a skill whose steps were wrong /
   out of order / missing a step, an agent that over-reached or lacked a skill it needed, a command
   with a stale path or dead step, an orchestrator routing miss, a verify gap. Phrase each as ONE
   actionable statement tied to a real file. Aim for the **handful that matter** (usually 1–3), not a
   transcript of everything that happened.

3. **Filter OUT game-specific learnings — this is the load-bearing guard.** A finding is only valid
   here if it improves the FRAMEWORK (general to any game). If the learning is about THIS game's
   content, names, scenes, or one-off facts, it is **NOT** a framework finding: say so and point it
   game-local (the game repo's `.claude/` / `design/` / its own `library/`). Never route a game fact
   into a `plugin/` skill or `plugin/library/` — that ships to every game (promotion rubric;
   audit **D2**). Drop these from the ledger write entirely.

4. **Map + write an explicit fix.** For each surviving finding:
   - Tag the **nearest dimension** `<Dn>` so `/framework-audit-fix`'s per-dimension playbook applies
     (D1 over-cap agent · D2 contamination · D3 name↔scope · D4 data-driven · D5 bloat/dup · D6
     orchestrator · D7 commands · D8 verify-flow · D9 harness · D10 abstraction-level/domain-layering).
     If none fits cleanly, pick the
     closest and make the fix **self-contained** — it's what actually drives the apply.
   - Write the **fix concretely**: target `file` + the operation (before→after, or the block to add).
     A vague finding can't be applied; an explicit one can.
   - Assign **bucket** (3 mechanical / 4 needs-judgment / 5 later), **verdict** (`fix-now`/`later`),
     **id** `<Dn>-<slug>` (reuse an existing id if it's the same issue).

5. **Append to the ledger — brief, dedup.** Push ONE object per finding to `LEDGER.json`'s `findings[]`
   — `{ id, dim, bucket, verdict, status: "open", finding }` (`dim` = the id's `D`-prefix), plus an
   optional `pattern` (one line — the good pattern to follow, a positive exemplar, not just the
   problem) — then run
   `npm run ledger`. Don't duplicate an id already `open`. Keep each `finding` one line, no essays.
   The ledger is ephemeral working state; the fix lives in files+git once applied.

6. **Present — terse, then hand off.** Per finding: id · the one-line fix · verdict. Then tell the
   human to run **`/framework-audit-fix <ids>`** with the ids they agree to (recommend which). If a
   finding is genuinely ambiguous (needs a decision only the human can make), raise it with
   `mcp__ui__ask` rather than guessing. **Never auto-apply here.** If nothing framework-general
   survived step 3, say so plainly and write nothing — a false finding is worse than silence.

7. **Self-critique.** This is self-improvement — improve the loop, not just the finding. Suggest one
   tweak to THIS command or the ledger format (a clearer signal, a missing case), recorded as the
   entry's `Process note` (or `none`). If a fix is obvious and safe, make it.

## Do this

- **Record; let the human apply.** Push findings to the ledger; `/framework-audit-fix` applies the
  agreed ids and the human decides (step 7's tweak to this command / ledger is the one exception —
  no other `plugin/` writes).
- **Keep findings framework-general** — a game-specific learning lives game-local (`plugin/library/`
  = AGNOSTIC records only); strip it to the general lesson or drop it.
- **File only fresh, real findings** — dedup against ids already `open`/`later` (or ones the
  last-audit line marked resolved), and distill what the conversation actually surfaced, don't pad.
- **Search with the Grep tool / full-path `rg`, and prefix shell with `rtk`** — bash `grep` is
  `rtk`-filtered and drops matches.
- **Write one-line ledger entries** — brevity is the point; the next run reads this first.
