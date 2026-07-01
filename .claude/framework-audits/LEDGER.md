<!-- GENERATED from LEDGER.json by `npm run ledger` — DO NOT EDIT; edit LEDGER.json. -->

# Framework audit ledger

**open (fix-now): 0 · later: 9 · skip: 1**

_Last audit:_ 2026-07-01 — fix-now backlog cleared; last applied: D7-loop-index (added docs/process/self-improvement.md mapping the self-improvement command loop + the shared ledger, indexed from the ledger README). Only later/skip findings parked; next cold scan pending.

> Source of truth is **`LEDGER.json`** — edit that, then `npm run ledger` (pre-commit also regenerates). This file + `ledger.html` are generated views. Applied findings are DELETED (git is the fix record), never stamped.

## Bucket 3 — no-brainers (0) · fix-now · mechanical (framework-nobrainer-fixer)

_none_

## Bucket 4 — improvements (0) · fix-now · needs judgment (/framework-audit-fix)

_none_

## Bucket 5 — later (9) · system / parked

- **D5-agent-restatement** · `D5` · _open_ — 3x-restatement pattern in transcript-researcher (archive policy, 'no spawn'), level-designer (handoff), bug-triage (no game code), skill-researcher (config gating) — state each constraint once.
- **D2-engine-version** · `D2` · _open_ — engine version drift across skills: 'Godot 4.6' (greybox, enemy-ai, godot-assets) vs '4.3+' (pixel-lighting) — framework-wide consistency pass.
- **D6-directive-verbose** · `D6` · _open_ — orchestrator data-driven directive (lines 3-10, 8 lines of prose) above routing — condense to ~4 bullets.
- **D7-fix-no-selfcritique** · `D7` · _open_ — framework-audit-fix.md has no self-critique/process-note step (framework-audit + token-audit do).
- **D9-gdscript-shadow-lint** · `D9` · _open_ — recurring runtime GDScript::reload warnings the gate never caught: SHADOWED*GLOBAL_IDENTIFIER (range, sign — ability_data.gd, directional_force_effect.gd, aim_line_resolver.gd) + CONFUSABLE_LOCAL_DECLARATION (next_pos — guard.gd). Harden: add a deterministic lint check (gdstyle rule / check*\* in tools/lib/checks.sh). Verify first whether gdstyle already covers it.
- **D7-display-clobber** · `D7` · _open_ — INVESTIGATE: human repeatedly reports the game's display/window settings reverting ('back to super small, mode !=2'). Determine whether a framework step (materialize/doctor/setup, or the screenshot/verify GD scripts) rewrites project.godot display settings instead of preserving the game's; if game-local config, drop.
- **D5-builder-restates-verify** · `D5` · _open_ — builder agents restate preloaded godot-verify content — the interactive-acceptance paragraph (godot-dev:73, godot-visuals:45 ≈ godot-verify:143-154) + tscn/Transform3D rules (godot-dev:61-63 ≈ godot-verify:160-163). COLLIDES with 'verify gates stay inline (reliability>DRY)' → the gate one-liner stays inline regardless; human decides if the LONG paragraph + technical-rule copies are redundant.
- **D9-audit-fanout** · `D9` · _open_ — STRIP (hypothesised, NEEDS measurement): framework-audit.md:61 'one sub-agent per dimension (parallel)' is context-anxiety scaffolding; under 1M-context Opus the plugin/ spine fits one context. Run /framework-audit all single-agent vs fan-out once, compare findings+tokens, keep fan-out only if it still wins.
- **D9-greybox-eye-harden** · `D9` · _open_ — HARDEN (partial): godot-greybox:47 ships a 'self-audit BY EYE' gate; a subset is deterministic (nav-graph reachability, dead-end count, missing NavigationRegion3D, cover-node count) — sibling godot-gridmap-level already hardened its by-eye out. Draft check_greybox_reachability; visual principles (sightline, mystery) stay by-eye.

## Bucket 6 — skip (1) · tombstones — recorded so they are not re-filed

- **D5-research-intake** · `D5` · _skip_ — NOT a clean extraction (verified): the shared research-intake core is only ~2 sentences (Hermes-intake principle + forge-facts rule) and each researcher tailors it — partial dedup + always-needed → inline (reliability > DRY). Kept as a tombstone so it isn't re-filed.

## Parking — dimension ideas (unactioned)

- skill-content-gap dimension — a skill missing a known technique/caveat maps to no clean D1–D9
- D10 'seam integrity' dimension — do the framework's own gates (promote/materialize/validate) enforce the conventions its docs state?
