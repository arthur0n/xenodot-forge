# Self-improvement — the forge-local command loop

The **agent** self-improvement loop (`bug-triage`, `skill-researcher`, `godot-refactor` closing the
friction→root-cause→skill-update loop) is the one `README.md` sells to users. This doc maps the other
half: the **command** loop the framework maintainer runs _on the framework itself_ — a set of
forge-local slash-commands + one agent, all coordinating through a **single shared ledger**.

Everything here is **forge-local (not shipped)**: the commands live in `.claude/commands/`, the
`framework-nobrainer-fixer` agent in `.claude/agents/`, the ledger in `.claude/framework-audits/`
(`/apply-nobrainers` is a maintainer skill that drives that agent). None of it materializes into a
game — it audits the plugin spine, not the game.

## The loop

```
              APPEND findings                        APPLY findings
   ┌───────────────────────────────┐        ┌──────────────────────────────┐
   │ /framework-audit   (cold scan)│        │ /apply-nobrainers  (bucket 3) │
   │ /framework-feedback (this chat)│  ───▶  │   → framework-nobrainer-fixer │
   │ /harvest-sessions  (logs)     │ LEDGER │ /framework-audit-fix (by id)  │
   └───────────────────────────────┘  .json └──────────────────────────────┘
                                    (human gate: pick ids)
```

Never auto-applies. Every command either **appends** proposed findings or **removes** applied ones;
the human picks which ids get fixed. Report → pick ids → fix.

## Shared state — the ledger

`.claude/framework-audits/LEDGER.json` is the **single source of truth** (a `findings[]` array + meta).
`LEDGER.md` / `ledger.html` are **generated views** — never hand-edit; run `npm run ledger` after any
write. Schema + editing rules: [`.claude/framework-audits/README.md`](../../.claude/framework-audits/README.md).

Each finding carries a `bucket` (3 no-brainer · 4 improvement · 5 later · 6 skip) → `verdict`
(`fix-now` = 3/4 · `later` = 5 · `skip` = 6). The ledger is **ephemeral working state, not history**:
applied findings are **deleted** (git + the commit message are the fix record), never stamped `done`.
Only `open`/`later` rows + `skip` tombstones persist.

## Commands

| Command / agent             | Kind    | Role   | Ledger interaction                                                                                                                         |
| --------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/framework-audit`          | command | append | Cold scan of agents/skills/orchestrator/commands across 9 dimensions (D1–D9); records findings, proposes fixes, critiques itself.          |
| `/framework-feedback`       | command | append | Distils **this conversation** into one/few findings.                                                                                       |
| `/harvest-sessions`         | command | append | Mines `logs/session-*.ndjson` for recurring friction — the automated sibling of `/framework-feedback`.                                     |
| `/apply-nobrainers`         | skill   | apply  | Applies bucket-3 no-brainers one-by-one via the Sonnet `framework-nobrainer-fixer` agent; verifies + prunes each; stages one human commit. |
| `framework-nobrainer-fixer` | agent   | apply  | Applies exactly ONE bucket-3 finding by id; refuses anything needing judgement (escalates to `/framework-audit-fix`).                      |
| `/framework-audit-fix`      | command | apply  | Applies the exact ids the human passes (any bucket judged `fix-now`), verifies the gate green, removes the applied rows.                   |

All are **manual, human-run**. `append` commands never apply; `apply` commands never invent findings.

## Token audit — a parallel ledger

`/token-audit` runs the same report-only shape against a **separate** ledger
(`.claude/token-audits/LEDGER.md`): it scans the newest session logs for agent/LLM turns that could be
made deterministic, records offenders, and files a task per opportunity. Same discipline (report +
propose, human decides), different target (token cost, not framework quality).

## See also

- [`.claude/framework-audits/README.md`](../../.claude/framework-audits/README.md) — ledger schema, buckets, regenerate the views.
- [`self-improvement-cross-check.md`](../self-improvement-cross-check.md) — how this loop maps to the 5-pillar self-improving-system framework (where forge is already more mature, where the real gaps are).
- [`promotion.md`](./promotion.md) — the game-local → plugin promotion flow (the _other_ human-gated write path into the framework).
