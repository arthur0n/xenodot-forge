---
description: Framework self-audit — score agents/skills/orchestrator/commands across 10 quality dimensions, record findings in the ledger, propose fixes, critique itself. Manual, human-run. Forge-local (not shipped).
argument-hint: "[D1..D10 | all]"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Agent, Skill, mcp__ui__form, mcp__ui__tasks, mcp__ui__ask
model: opus
---

# Framework self-audit — keep the spine clean as it grows

A deliberate habit, not a one-shot. Xenodot is a **self-improvement framework**: each run
inspects the framework's own spine — agents, skills, orchestrator, and **its own commands** —
finds quality drift, proposes concrete fixes, records what it found so the next run skips it,
and critiques itself. It loads caveman itself (step 0) and runs best high-effort (type
`ultrathink`, or invoke on a high-effort turn). You won't catch everything in one pass — that's expected.

This command is **forge-local and human-run**. It **reports + proposes only** — it does not
auto-fix, auto-file, schedule itself, or write under `plugin/`. Each finding gets a stable id;
the human picks which to fix, then the companion **`/framework-audit-fix <ids>`** applies only
the agreed subset. The human decides every change.

## Why this exists

The framework ships to every game. A skill dirty with one game's names, an agent grown past
its remit, a misleading skill name, or a bloated prompt all degrade every game silently.
Catching these on a cadence keeps the framework general, lean, and data-driven — the
properties the promotion rubric (`plugin/docs/process/promotion.md`) demands.

## Where the data lives (paths are repo-relative; cwd = forge root)

- **Agents:** `plugin/agents/*.md` — frontmatter `skills:` list + the prompt body.
- **Skills:** `plugin/skills/*/SKILL.md` — frontmatter `name`/`description`/`agents` + body.
- **Orchestrator:** `ui/orchestrator.md`.
- **Commands:** `plugin/commands/*.md` and ALL forge-local self-improvement commands —
  glob `.claude/commands/*.md`, never a hardcoded list (it goes stale; token-audit.md was
  silently missed by one).
- **Library (AGNOSTIC records only — ships to every game):** `plugin/library/{transcripts,verdicts,findings}/`. A game's specific FACTS live GAME-LOCAL (the game repo), never here.
- **Ledger:** `.claude/framework-audits/LEDGER.json` — the SOURCE OF TRUTH (a `findings[]` array);
  read FIRST, append findings AFTER (push objects to `findings[]`, dedup by `id`). `LEDGER.md` /
  `ledger.html` are GENERATED VIEWS — never hand-edit; run `npm run ledger` after any write. Full
  schema: `.claude/framework-audits/README.md`.

**Search with the Grep TOOL or `/opt/homebrew/bin/rg` (full path) — NOT bash `grep`.** A hook routes
bash `grep`/`rg` through `rtk`, which silently DROPS and MANGLES matches (it rewrote the literal word
`quick`→`n`, and missed `DiceOfFate` in files that contained it). Bash grep is unreliable for this
audit — use the Grep tool, full-path `rg`, the Read tool, or a sub-agent that has the Grep tool. Use
`wc` / `rg --files` for sizes/listings. Don't slurp every file into context.

**Grep vs graphify — pick by question shape.** This repo ships a knowledge graph (`graphify-out/`).
For CONCEPTUAL gather — "how does routing connect", "how does the verify flow span agents" (D6/D8) —
a `graphify query "<question>"` returns a scoped subgraph cheaply; reach for it first. But for a
LITERAL contamination/rename sweep (D2/D3) use full-path `rg`: graphify stores STRUCTURE (god nodes,
communities, edges), NOT prose — the string you're sweeping isn't in the graph (`shared_apartment`
returns nothing from `graph.json`), so graphify CANNOT enumerate every occurrence, and a sweep that
misses one ref leaves contamination behind. Completeness → `rg`; concepts → graphify.

## Steps

0. **Load caveman first.** Before anything else, invoke the `caveman` skill — this command
   reports in caveman mode (terse; all technical substance kept, only fluff dropped).

1. **Read the ledger.** Parse `LEDGER.json` (a real JSON parse of `findings[]`, not a table scan) —
   pruned after each pass, so it holds the last-audit date (`lastAudit`) plus any findings still
   `open`/`later`. Don't re-surface a finding already in `findings[]` open/later (or one `lastAudit`
   says was resolved); otherwise audit fresh against the current files.

2. **Pick scope.** Default `all`. `$ARGUMENTS` overrides: a **dimension id** (`D3`) audits just
   that one; a **finding id** (`D7-scope-stale-four`) re-verifies that single open ledger finding
   against current files — refine/confirm it for the human to apply, not a fresh scan. Skip any
   dimension audited recently unless its area changed since (check git).

3. **Audit each dimension.** Prefer one sub-agent per dimension (parallel) for the gather;
   you judge. Signals:

   - **D1 — Agents with too many skills.** Don't recount by hand — run `rtk npm run validate` and
     read the `gen-skill-scope` skill-scope warnings: its index-expansion count is authoritative
     (it caught over-cap agents a frontmatter-only count missed). The cap is **per-audience**:
     **builders 15** (they carry a 7-skill SHARED CORE — `caveman` + `tasks-mcp` + the five
     `[builders]` skills — so ~8 DOMAIN skills is the real budget), **everyone else 10**. For a
     flagged agent, judge whether its DOMAIN skills cluster into a sub-domain deserving its own
     specialized agent; name the split. (Wiring: `skill-registry.js` `BUILDERS` + the cap in
     `gen-skill-scope.js`.)

   - **D2 — Game/path contamination in skills.** A skill must be game-agnostic. Grep
     `plugin/skills/*/SKILL.md` **and the shipped library prose `plugin/library/{addons,tools,transcripts,verdicts}/*.md`**
     (it ships to every game too) for: game proper nouns, character/mechanic/enemy/arena names,
     binary names, hardcoded paths (`../game`, absolutes, specific `.tscn`/`.gd` files),
     "game-local" self-declarations. Quote `file:line`. **skill = METHOD, game = FACTS:** strip the
     skill to the agnostic method. The game's specific facts already live GAME-LOCAL (the game repo's
     `design/`, scenes, `.claude/`) — do NOT copy the worked example into `plugin/library/` (it
     symlinks/ships to every game = re-contamination; that folder is for AGNOSTIC records only). Apply
     this to AGENT prompts too (`description:` / `name:` / body / cache namespaces), not just skills —
     and to game-PARADIGM lock-in (see D3). **Roadmap citations are the same bug:** `docs/roadmap/*.md`
     is forge-local project history (a specific game's plan, retired once that game ships/POCs) —
     grep for `docs/roadmap/`, `Phase-N`/`Phase N`/`phase A3`-style ids, and phase-gate language
     ("the Phase-5 gate") in any shipped file. Citing it as scope/reference authority is D2
     contamination; give the agnostic technical rationale instead and drop the citation entirely.
     `docs/roadmap/*.md` itself is NEVER an audit target — it's allowed to be as game-specific as it
     likes; only flag a SHIPPED file (skill/agent/library) that points at it.

   - **D3 — Name vs scope.** Does each skill's `name` match what it actually covers? Flag
     names too broad for narrow content or too narrow for broad content (the classic: a
     `combat` skill/agent that's really only ranged/melee/dot — resolved here by splitting). Propose a
     truer name; apply the same lens to agent names. **Scope includes PARADIGM/GENRE fit:** flag a
     skill silently locked to one paradigm the framework spans more than one of — orthographic vs
     perspective camera, top-down vs FPS, etc. The fix is usually to SCOPE it in the description
     ("top-down/orthographic only"), mirroring an existing sibling split
     (`godot-first-person-controller` vs `godot-orthographic-follow-camera`) — not to force one skill
     to cover both.

   - **D4 — Data-driven orientation.** Does each skill teach **data-driven** systems
     (Resources / `.tres` / `@export` tunables / dictionaries / config) or a hardcoded
     one-off? BUT judge PROPORTION (the framework's own rule): **`@export` tunables ARE data-driven**
     (designer-tunable, no code change), and a SINGLE-instance rig (one player / camera / lighting)
     with `@export`s does NOT need a Resource — forcing one is the over-engineering the framework
     warns against. Values in a scene / material / shader-uniform also count as data. Flag ONLY
     MULTI-instance systems (enemies, abilities, items) that hardcode per-instance instead of
     authoring data. Expect most D4 flags to be false positives — say so.

   - **D5 — Agent prompt bloat / duplication.** `wc -l -w plugin/agents/*.md`; flag the largest +
     prose blocks repeated verbatim across agents. Extract to a shared skill ONLY when BOTH hold:
     (a) duplicated across MULTIPLE agents (a skill exists to SHARE — a single-consumer block stays
     inline), AND (b) it can load RELIABLY (list in frontmatter + a load line at conversation start,
     like the caveman trigger). Always-needed rules that can't tolerate a missed load (the `rtk`
     rule, verify gates, the caveman terse rule itself) stay INLINE — reliability over DRY (the
     caveman-trigger lesson). The clean win to look for: a verbatim block across ≥3 agents that's
     only needed at a known step (e.g. the researchers' 6-bucket → `research-presenting`).

   - **D6 — Orchestrator.** Read `ui/orchestrator.md`. Flag: directives duplicated across
     agents that should be centralized; dense step-by-step prose that belongs in a reusable
     skill; philosophy/tone that dilutes routing. Propose the move/trim.

   - **D7 — The framework's own commands.** Audit `plugin/commands/*.md` AND all forge-local
     self-improvement commands (glob `.claude/commands/*.md` — never assume a fixed list) for
     stale references
     (paths/files that moved), scope creep, dead steps, and whether each command still
     self-critiques. Apply D2/D3/D5 lenses to commands too. **Enumeration drift:** flag any command
     that hardcodes a list of sibling files where a glob (`.claude/commands/*.md`) would stay
     current — such lists silently go stale as files are added.

   - **D8 — Verification flow completeness.** Does the verify/grade story hold end-to-end across
     builders, skills, and tools? Trace it (graphify D8): design **Acceptance** → builder gate
     (`plugin/tools/validate.sh` composing `plugin/tools/lib/checks.sh`; games see them
     materialized as `tools/`) → evaluator rubric (`plugin/tools/playgrade.sh`
     - `godot-playgrade` / `godot-playtester`). Flag a break: a builder listing `godot-verify` with
       no `## Verification (mandatory)` block; a gate step a skill claims but `validate.sh`/`checks.sh`
       doesn't run (or a check function nothing composes); a `tools/` script that ships but nothing
       invokes; a skill re-teaching another's job instead of pointing at it.

   - **D9 — Harness still load-bearing under the current model.** Scaffolding encodes assumptions
     about model limits that go STALE as models improve (the harness-design lesson: context-reset
     scaffolding was DROPPED Sonnet 4.5 → Opus 4.6). Cut both ways:
     - **Strip** — is a scaffold (a model-tier choice, a context-anxiety mitigation, sprint-style
       decomposition, a multi-step gate) still earning its context cost under the CURRENT model, or
       now overhead? Name what to remove/down-tier and the sample task that would prove it.
     - **Harden** — is there a FUZZY agent-judgment step a deterministic tool should replace (the
       determinism ratchet)? Name the `check_*` / tool to draft.
       Model-upgrade ritual: on a major model release, strip one scaffold on a sample task, measure,
       decide keep/strip/retier — record as D9 findings. Expect most D9 flags to need a real
       before/after measurement, not a hunch — say which are measured vs hypothesised.

   - **D10 — Abstraction-level / domain-layering.** Does each capability sit at ONE altitude — a
     GENERIC baseline (engine/quality/way-of-work: renderer defaults, folder layout, naming,
     warnings-as-errors, structural workflows) OR a DOMAIN/AESTHETIC payload — and never fuse the two
     into one un-swappable block? D2 catches one PROJECT's facts; D10 catches one DOMAIN's/art-style's
     payload smuggled into a capability whose name or role promises generality. The tell: a
     generic-tier capability (name/role says 'conventions', 'baseline', 'keystone', 'use FIRST') that
     hardcodes a domain constant as 'non-negotiable' — a pixel-art / SubViewport / Forward+ call
     stamped 'for this art style' inside a skill sold as the shared structural workflow. **The probe
     is the SECOND-DOMAIN TEST:** read the capability as a game this framework also spans that does
     NOT share the payload (an HD/PBR title where a pixel-art one taught) — does the generic half
     still apply cleanly and the payload half fall away as a swappable layer? Also flag
     DEPENDENCY-DIRECTION INVERSIONS: a generic workflow living INSIDE a domain-named capability so a
     second domain must depend on the first (the HD import skill inheriting the structural
     mesh-import flow FROM the pixel-art skill) — the generic core should be the base BOTH aesthetics
     import. Fix pattern: split the generic baseline into its own neutral capability; the payload
     becomes a thin layer on top. Expect false positives: a payload-tier capability SHOULD carry
     domain constants — only flag them where the declared tier is GENERIC. Origin:
     godot-project-conventions fused a quality baseline with 3D-pixel-art payload (fixed 322e4da);
     invisible to every single-domain loop (contamination gates catch one project's facts, session
     mining only sees the domain in use) — surfaced only by a fork's second-domain strip.

4. **Judge + id each finding.** EXPECT most findings to be false positives on inspection — they are
   hypotheses until checked against the actual files: generic industry vocabulary (tank/grunt/runner)
   ≠ contamination; `@export` ≠ hardcoded; a single-consumer or single-instance pattern ≠ something to
   extract or Resource-ify. Keep only opportunities that survive that scrutiny — a false "fix this" is
   worse than silence — and reclassify the rest to `skip`/`later` WITH the reason. (Real fixes this
   loop has found: cross-agent verbatim dup, game-name contamination, an over-broad agent, an opaque
   name, an orthographic-locked skill. Non-fixes correctly skipped: generic vocab, `@export` rigs,
   single-consumer orchestrator rules.) Give each surviving finding a **stable id** `<Dn>-<slug>`
   (e.g. `D1-combat`, `D2-greybox`, `D5-research-presenting`) — the fix command targets findings by
   this id, so reuse the same id across runs for the same issue.

5. **Record — brief, and KEEP THE LEDGER LEAN.** For each surviving finding, push ONE object to
   `LEDGER.json`'s `findings[]` (dedup by `id`): `{ id, dim, bucket, verdict, status, finding }`
   plus an optional `pattern` (one line — the good pattern to follow, a positive exemplar, not just
   the problem). `finding` is one line (problem + proposed fix), `dim` is the id's `D`-prefix. Update `lastAudit`,
   then run `npm run ledger` to regenerate `LEDGER.md` / `ledger.html` (never hand-edit those). The
   ledger is EPHEMERAL working state, not a history log: carry only findings still `open`/`later`.
   **Once a pass fully resolves (nothing left `open`), PRUNE `findings[]` empty and set `lastAudit`
   to a one-line summary of what the pass did** — the fixes live in the files + git, not here. Don't
   let it accumulate done/skip history.

6. **Present — the 6 buckets (skill-researcher convention).** Report like the **skill-researcher**
   agent does (`plugin/agents/skill-researcher.md`): never gate a finding with a bare
   fix/skip. Decompose the audit into the six buckets, put the verdict ON TOP, and let the
   human decide per finding:
   1. **The ideal** (from the idea) — what this dimension should look like (agnostic skills,
      lean agents, honest names, data-driven systems…).
   2. **Current state** (from the candidate) — what the audit actually found, with evidence
      (`file:line`, counts).
   3. **No-brainers** — mechanical, safe fixes to apply as-is. List each by `id`.
   4. **Improvements** — worth fixing but needs rework/judgment, and HOW. List each by `id`.
   5. **System / Later** — framework-level ideas to park (reuse the framework's existing
      "Later" parking; record in the ledger, don't fix now).
   6. **Skip** — looked like issues but aren't worth the churn; say why.
      Verdict sits on top: each finding is `fix-now` (bucket 3/4) / `later` (5) / `skip` (6).
      If `mcp__ui__form` is available, lead with a read-only `note` carrying the buckets +
      evidence, then a **multiSelect** of the bucket 3/4 ids so the human ticks which to fix —
      your recommendation first. Otherwise report the buckets terse and tell the human to run
      `/framework-audit-fix <ids>` with the ids they agree to. **Never auto-apply here.**

7. **Self-critique.** This is self-improvement — improve the loop, not just the findings.
   Suggest fixes to THIS command or the ledger format: a better signal to grep, a missing
   dimension, a step that didn't pay off. Record it as the entry's `Process note` (or `none`).
   If a fix is obvious and safe, make it here.

## Do this

- **Audit fresh ground** — check the ledger first and spend the pass on dimensions not covered
  recently (re-audit one only when its area changed).
- **Filter before reading** — pull just the slice you need with the Grep tool / full-path `rg` /
  `wc` / sub-agents (the `rtk` hook drops match content from bash `grep`/`rtk grep`, so those never
  see the real matches — see the search warning above).
- **Report; let the human apply.** This command surfaces buckets; `/framework-audit-fix` applies
  the agreed ids and the human decides. Writing under `plugin/` or auto-applying is never this
  command's job (step 7's tweaks to this command / ledger are the one exception).
- **Keep the framework agnostic** — a game's specific FACTS live GAME-LOCAL (the game repo).
  `plugin/library/` ships to every game, so it too holds AGNOSTIC records only — never a game fact.
- **Treat `docs/roadmap/*.md` as out of scope** — it's forge-local project history. Only flag a
  SHIPPED file that cites it as reference/authority (D2); the roadmap doc itself stays untouched.
- **Write one-line ledger entries** — brevity is the point; the next run reads them first.
