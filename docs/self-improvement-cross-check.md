# Self-improvement cross-check — the 5 pillars vs Xenodot Forge

Maps the **5-pillar self-improving-system framework** (`../5-pillars-self-improvement.md`, distilled
from Karpathy / Anthropic / a community walkthrough) against what this forge already does. The forge
is, by its own description, **already a self-improvement framework** (`.claude/commands/framework-audit.md:10`:
"Xenodot is a self-improvement framework") — so the question is never "adopt all" or "adopt none."
It is: **where is forge already more mature, and where is there a real gap worth filling?**

**Bottom line:** forge runs a **more mature, more conservative** version of pillars **1, 4, 5**.
Pillars **2 and 3** share **one real gap** — forge never harvests its _own Claude session history_
for learnings. Net new capability worth building: **one** (a session-harvest pipeline feeding the
existing audit loop), plus a small feedback-capture reflex. Two transcript ideas are **rejected on
purpose**: the silent auto-approve bucket, and personal-data (email/Granola/life-story) ingestion —
both wrong-shape for a framework that **ships to every game**.

---

## Verdict matrix

| Pillar                                                           | Forge today (evidence)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Verdict                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 BASE** — `raw/`+`wiki/` KB + repetitive-task skills          | `plugin/library/` = "warm knowledge, never auto-loaded" with **role-typed homes** (records / sources / skills / tools), each carrying its own index — not a flat raw/wiki dump (`plugin/library/README.md:1-18`). The `transcripts/` drop-zone → `library/transcripts/<slug>.md` digest → `transcripts/archive/` flow **is** raw→wiki→raw-backup (`plugin/agents/transcript-researcher.md:26-28`). `CLAUDE.md` "## Skills" = the hot index. 45 `godot-*` skills + meta. `add-new-resource` ≈ **transcript-researcher**.                                                                                                 | **ALREADY — arguably better.** Typed, token-cost-aware homes beat a flat dump (the KB is explicitly the stuff that should NOT cost tokens every task). No action — cite as the mature form of Pillar 1.                                                                    |
| **2 UPLOAD** — bulk-ingest AI inputs / ecosystem / life-story    | Ingests **external technique sources** (transcripts, addons, skill collections) + manually-authored skill-eval `verdicts/`. Has usage **telemetry** (`plugin/hooks/rtk-usage-log.sh`, `plugin/library/token-audits/LEDGER.md`) but does **not** mine its own Claude session history for learnings. No email/Granola/life-story — correctly, that's builder-personal, not framework knowledge.                                                                                                                                                                                                                           | **PARTIAL — one real gap.** Borrow ONLY the **"AI inputs / session history"** place. **Reject** email / ecosystem / life-story: builder-personal data has no home in a framework that ships to games.                                                                      |
| **3 INFLOW** — tested ingestion skills as automatic "rivers"     | Skill-driven ingestion is **mature**: transcript-researcher (source-push) + skill-researcher (demand-pull) + addon/cli-researcher, each a tested path with a durable digest, "cutting is the default" = the transcript's _less-is-more_ rule (`plugin/agents/transcript-researcher.md:19-24,50`). BUT every path is **on-demand** (human/orchestrator-triggered), not a recurring river. No `sync-sessions` pipeline.                                                                                                                                                                                                   | **PARTIAL.** The _skills_ exist and are good; the **recurrence ("rivers") + a session-harvest pipeline** is the gap. Highest-value borrow.                                                                                                                                 |
| **4 LOOP** — `improve-system` 3-bucket + routines + human review | `/framework-audit` = improve-system, but with **9 dimensions D1–D9** and it **never auto-applies** — reports + proposes, human picks ids, `/framework-audit-fix` applies the agreed subset (`.claude/commands/framework-audit.md:16-19`). `LEDGER.md` = the review file, richer than checkboxes (id/bucket/verdict/status + a 6-bucket present-to-human + `mcp__ui__form` multiSelect). Promotion "**never auto-promotes**" (`plugin/docs/process/promotion.md`). An autonomous-main-goal loop + `schedule`/CronCreate exist (`plugin/skills/autonomous-main-goal/SKILL.md`), but the audit is **deliberately manual**. | **ALREADY — stronger + safer.** **Reject** the silent **auto-approve** bucket: on a framework that ships to every game, silent drift is the exact failure mode promotion/audit are built to prevent. Optional: a _scheduled cadence_ — owner's call; manual is deliberate. |
| **5 DRIVE** — slow / you-lead / compress-loops / bias-to-action  | "You lead / delete what doesn't help" = promotion "**Default: stay local** … or is dropped" + audit "the human decides every change". "Not that serious / bias to action" = D4 "expect most flags to be false positives" + D9 "strip stale scaffolding" (`.claude/commands/framework-audit.md:96-101,129-139`). **"Compress feedback loops"** is the one piece **not formalized** (the scene `plugin/library/tools/feedback.md` is an unrelated render tool).                                                                                                                                                           | **MOSTLY ALREADY (ethos).** One borrow: a lightweight **in-session "compress the loop" capture** — "turn this conversation into a proposed skill/agent improvement → audit ledger."                                                                                        |

---

## Borrow / reject — per pillar, with the _why_

- **Pillar 1 — keep as-is.** Forge's typed library + `CLAUDE.md` hot index is a more disciplined
  Karpathy KB. Nothing to add.
- **Pillar 2 — borrow one third, reject two.** Borrow the **session-history** harvest. Reject
  **email/ecosystem/life-story**: the _why_ — those are a single builder's personal data; the forge
  is a framework that materializes into _many_ games, so personal data has no general home and would
  contaminate the shipped plugin (exactly what audit dimension **D2** exists to catch).
- **Pillar 3 — borrow the river, keep the discipline.** Forge already nails _skill-driven_
  ingestion and _less-is-more_; what's missing is a **recurring session pipeline**. Build that one.
- **Pillar 4 — reject the auto-approve bucket.** The _why_ — the transcript's own warning (the
  "only trains chest" drift) is **amplified** when the system ships to every game. Forge's
  human-gated `report → pick ids → fix` is the correct, stronger answer. Keep it. Scheduling is
  optional and orthogonal.
- **Pillar 5 — borrow the feedback-capture reflex.** The _why_ — it's the cheapest, highest-rep
  improvement channel and the only Drive strategy forge hasn't formalized.

---

## Roadmap — sequenced gaps worth filling (no code yet)

1. **Session-harvest pipeline (Pillar 2+3 — highest value).** A forge-local capability that reads
   forge's own Claude Code session history, distills recurring friction/wins, and writes them as
   **`/framework-audit` ledger findings** — **NOT auto-applied**; they enter the existing
   human-gated bucket flow. _Reuses:_ the audit ledger format (`.claude/framework-audits/LEDGER.md`),
   the 6-bucket present-to-human, and transcript-researcher's distill → verify → map shape.
   _Smallest viable:_ a `/harvest-sessions` command that mirrors `/framework-audit`'s "report +
   propose only" contract and appends `<Dn>-<slug>` findings.
2. **Feedback-capture reflex (Pillar 5).** A tiny skill/command: _"based on this conversation,
   propose a skill/agent improvement"_ → append one finding to the audit ledger. Compresses the
   loop with zero new infrastructure; it's just a fast on-ramp into the existing flow.
3. **Optional cadence (Pillar 4 — owner's call).** IF recurrence is wanted, wire the existing
   `schedule` / CronCreate to run harvest + audit on a cadence — but keep the **manual human-gate on
   every applied change**. Default: stay manual.
4. **Explicitly rejected (recorded so nobody re-proposes them):**
   - **Silent auto-approve bucket** — drift danger on a shipped framework; violates audit's
     "human decides every change."
   - **Email / Granola / Slack / life-story personal ingestion** — builder-personal data, no
     general home, would re-contaminate the plugin (D2).

---

_Source pillars: `../5-pillars-self-improvement.md`. This doc is forge-local analysis (not shipped
in `plugin/`)._
