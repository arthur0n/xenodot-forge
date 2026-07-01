<!-- GENERATED from LEDGER.json by `npm run ledger` — DO NOT EDIT; edit LEDGER.json. -->

# Framework audit ledger

**open (fix-now): 8 · later: 14 · skip: 1**

_Last audit:_ 2026-07-01 — weekly cold scan (D1,D4 clean) + human-steered promotion/authoring-seam deep-dive. Applied+removed this cycle: D2-enemy-ai-codenames, D7-scope-stale-four, D7-fix-targets-plugin-only, D7-fix-prunes-on-done, D7-tool-domains-doc, D7-agnostic-authoring-convention, D7-promote-board-vapor, D7-lesson-record-template, D9-contamination-check, D8-smoke-misassigned, D8-verify-gate-gap, D6-symptom-route-triplication, D8-runtime-smoke-wiring-stale, D8-capabilities-registry-drift, D7-harvest-grep-contradiction (record → git).

> Source of truth is **`LEDGER.json`** — edit that, then `npm run ledger` (pre-commit also regenerates). This file + `ledger.html` are generated views. Applied findings are DELETED (git is the fix record), never stamped.

## Bucket 3 — no-brainers (0) · fix-now · mechanical (framework-nobrainer-fixer)

_none_

## Bucket 4 — improvements (8) · fix-now · needs judgment (/framework-audit-fix)

- **D2-blockout** · `D2` · _open_ — pixel-lighting:21,30,43,61 asserts blockout_01.tscn 'already carries the rig' as an existing fact — teach the rig values directly instead.
- **D2-roadmap** · `D2` · _open_ — pixel-lighting:25,79,86 cites docs/roadmap/first_game.md / a Phase-5 gate as scope authority — give an agnostic technical (pixel-readability) rationale instead.
- **D2-library-records** · `D2` · _open_ — shipped library/addons + tools/\*.md digests are game-COUPLED throughout (scene names, Main/SubViewportContainer/SubViewport, 640x360, pixel-art rig; 'DiceOfFate' in sprint-view-model-feel.md; pushable_enemy.gd in library/addons/enemy-ai.md) yet plugin/library/ is AGNOSTIC-only. ~10 files. DECIDE: (a) genericize keeping the reusable verdict/caveat, or (b) move game-local.
- **D5-asset-advisor-bloat** · `D5` · _open_ — asset-advisor (largest agent) restates per-medium facts 4x — collapse Classification+Checklist into one table, trim 2 worked examples (~25-30%).
- **D3-ranged-combat** · `D3` · _open_ — agent named 'ranged-combat' owns godot-effect-composition (melee/traps/buffs/dots) — the name mis-signals routing; consider rename (godot-weapons-abilities). Weigh churn (just split).
- **D8-render-tools-missing** · `D8` · _open_ — godot-verify frames render-health as a 'godot-dev build / contract' (:71) yet names tools/verify_arena_render.gd 'mandatory' (:79) + gives a copy-paste Layer-4 tools/verify_render_action.gd command (:85); NEITHER ships (only spread-only verify_render.gd). A builder running Layer 4 hits file-not-found. Fix: ship both OR mark 'build per contract (not shipped)' + stop presenting the Layer-4 command as runnable.
- **D8-enemy-smoke-orphan-naming** · `D8` · _open_ — godot-enemy-ai-headless-smoke names its examples check*nav_bake.gd/test_enemy_health.gd (:35,:58,:138), but the gate glob only runs smoke*_/play\__ (checks.sh:285) — so check*\*/test*_ NEVER join the gate, contradicting the skill's own ':128 smoke\__.gd auto-joins'. Rename examples to smoke_nav_bake.gd/smoke_enemy_health.gd.
- **D5-handoff-restates-agent-report** · `D5` · _open_ — 4 builder agents re-spell the preloaded agent-report skill's steps verbatim (godot-visuals:49, godot-assets:51, godot-player:46, godot-dev:79) — 'write full report gate-first to handoff file, relay only <path> — gate PASS/FAIL' duplicates agent-report:15,17,31. Preloaded + known step (handoff) → trim each to 'For handoffs, follow the preloaded agent-report skill.'

## Bucket 5 — later (14) · system / parked

- **D8-smoke-bloat** · `D8` · _open_ — godot-runtime-smoke ~425L = 3-4 capabilities (smoke-author + input-bot playthrough + log-capture + navigability) — split input-bot to its own skill, demote machine-verified empirics to library/findings/; sweep its firing_yard/cycle_level contamination during the split.
- **D5-agent-restatement** · `D5` · _open_ — 3x-restatement pattern in transcript-researcher (archive policy, 'no spawn'), level-designer (handoff), bug-triage (no game code), skill-researcher (config gating) — state each constraint once.
- **D2-engine-version** · `D2` · _open_ — engine version drift across skills: 'Godot 4.6' (greybox, enemy-ai, godot-assets) vs '4.3+' (pixel-lighting) — framework-wide consistency pass.
- **D3-greybox-fps** · `D3` · _open_ — godot-greybox framed entirely as 'Godot 4.6 FPS arena' — discloses the lock but is genre-locked; product call whether the framework is FPS-maker or genre-general.
- **D3-fps-enemy** · `D3` · _open_ — godot-fps-enemy-combat hit/death contract is shooter-generic (camera-agnostic); 'fps' over-narrows — rename to godot-shooter-enemy-combat someday.
- **D6-directive-verbose** · `D6` · _open_ — orchestrator data-driven directive (lines 3-10, 8 lines of prose) above routing — condense to ~4 bullets.
- **D7-fix-no-selfcritique** · `D7` · _open_ — framework-audit-fix.md has no self-critique/process-note step (framework-audit + token-audit do).
- **D7-loop-index** · `D7` · _open_ — forge-local self-improvement COMMAND loop (framework-audit → framework-feedback → framework-audit-fix → token-audit) is indexed nowhere; README.md:15 names only the AGENT loop. Fix: add docs/process/self-improvement.md mapping the commands + the LEDGER as shared state.
- **D9-gdscript-shadow-lint** · `D9` · _open_ — recurring runtime GDScript::reload warnings the gate never caught: SHADOWED*GLOBAL_IDENTIFIER (range, sign — ability_data.gd, directional_force_effect.gd, aim_line_resolver.gd) + CONFUSABLE_LOCAL_DECLARATION (next_pos — guard.gd). Harden: add a deterministic lint check (gdstyle rule / check*\* in tools/lib/checks.sh). Verify first whether gdstyle already covers it.
- **D7-display-clobber** · `D7` · _open_ — INVESTIGATE: human repeatedly reports the game's display/window settings reverting ('back to super small, mode !=2'). Determine whether a framework step (materialize/doctor/setup, or the screenshot/verify GD scripts) rewrites project.godot display settings instead of preserving the game's; if game-local config, drop.
- **D3-verify-subviewport-lock** · `D3` · _open_ — godot-verify Layer 3/4 capture 'the SubViewport (the pixel-art rig)' (:79,:95,:116-119); the framework also spans HD (godot-mesh-import-hd/-hd-material-import) where a non-pixel game renders 3D to the root viewport → the capture silently assumes a pixelation rig. Scope: SubViewport when the game uses a pixelation rig, else root. Park for the HD-vs-pixel branch.
- **D5-builder-restates-verify** · `D5` · _open_ — builder agents restate preloaded godot-verify content — the interactive-acceptance paragraph (godot-dev:73, godot-visuals:45 ≈ godot-verify:143-154) + tscn/Transform3D rules (godot-dev:61-63 ≈ godot-verify:160-163). COLLIDES with 'verify gates stay inline (reliability>DRY)' → the gate one-liner stays inline regardless; human decides if the LONG paragraph + technical-rule copies are redundant.
- **D9-audit-fanout** · `D9` · _open_ — STRIP (hypothesised, NEEDS measurement): framework-audit.md:61 'one sub-agent per dimension (parallel)' is context-anxiety scaffolding; under 1M-context Opus the plugin/ spine fits one context. Run /framework-audit all single-agent vs fan-out once, compare findings+tokens, keep fan-out only if it still wins.
- **D9-greybox-eye-harden** · `D9` · _open_ — HARDEN (partial): godot-greybox:47 ships a 'self-audit BY EYE' gate; a subset is deterministic (nav-graph reachability, dead-end count, missing NavigationRegion3D, cover-node count) — sibling godot-gridmap-level already hardened its by-eye out. Draft check_greybox_reachability; visual principles (sightline, mystery) stay by-eye.

## Bucket 6 — skip (1) · tombstones — recorded so they are not re-filed

- **D5-research-intake** · `D5` · _skip_ — NOT a clean extraction (verified): the shared research-intake core is only ~2 sentences (Hermes-intake principle + forge-facts rule) and each researcher tailors it — partial dedup + always-needed → inline (reliability > DRY). Kept as a tombstone so it isn't re-filed.

## Parking — dimension ideas (unactioned)

- skill-content-gap dimension — a skill missing a known technique/caveat maps to no clean D1–D9
- D10 'seam integrity' dimension — do the framework's own gates (promote/materialize/validate) enforce the conventions its docs state?
