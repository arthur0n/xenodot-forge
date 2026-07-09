<!-- GENERATED from history.json by `npm run token-history` — DO NOT EDIT; edit via the CLI. -->

# Token history — spend trend

> PERMANENT append-only time-series (opposite of the ephemeral framework-audit ledger). Each run covers different sessions, so raw covered cost is NOT the trend — the comparable signals are the NORMALIZED columns (hitRate, $/turn) and the **global** snapshot line.

## Trend (newest first)

| date | #sess | covered $ | tok | hit% | $/sess | $/turn | global $ | global tok | global hit% |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 2026-07-09 | 3 | 27.5328 | 2574k | 96 | 9.1776 | 0.1343 | 6535.0619 | 75259k | 97 |
| 2026-07-08 | 7 | 3315.3861 | 32857k | 95 | 473.6266 | 0.4514 | 6507.5291 | 72685k | 97 |

## Opportunities (did the fix move the metric?)

| filed | id | est tok | landed | moved | Δtok | Δ$ | result |
|---|---|--:|:-:|:-:|--:|--:|---|
| 2026-07-08 | godot-docs-memoize | 55000 | ✓ | pending | — | — | Applied in-session dedup: ui-control.js docsDedupDecision denies a repeat get_class with a scroll-up stub (~20k→~30 chars/repeat), wired in makeCanUseTool; verified in session.test.js. Δ confirmed on next audit global snapshot. Permanent dated-trimmed cross-session cache = framework tech-debt D9-docs-cache-dated. |

