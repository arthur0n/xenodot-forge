---
description: Apply agreed framework-audit fixes by finding-id. Reads the audit ledger, applies ONLY the ids you pass, verifies, marks them done. Manual, human-run. Forge-local (not shipped).
argument-hint: "<id[,id...]> | all-agreed"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit, Agent, Skill, mcp__ui__ask
model: opus
---

# Apply framework-audit fixes — only the ids the human agreed

The companion to `/framework-audit`. The audit **reports**; this command **acts**, on exactly
the findings you name. It never invents new findings, never fixes an id you didn't pass, and
never deletes/overwrites beyond the recorded fix. Run it caveman.

## Inputs

- `$ARGUMENTS` = finding ids to apply: `D2-greybox,D1-combat` (comma or space separated).
- `all-agreed` = every ledger finding whose verdict is `fix-now` and status `open`. Still
  itemize what it will touch before applying.

## Where the data lives (repo-relative; cwd = forge root)

- **Ledger:** `.claude/framework-audits/LEDGER.md` — the source of truth for ids, fixes, status.
- **Targets:** `plugin/skills/*/SKILL.md`, `plugin/agents/*.md`, `ui/orchestrator.md`,
  `plugin/commands/*.md`, `plugin/library/{transcripts,verdicts}/`.
- Editing a plugin file directly **is** the sanctioned path for a general improvement
  (`plugin/docs/process/promotion.md`: "General improvement → edit the file directly in the
  plugin"). A skill stays game-agnostic; the game's own FACTS live GAME-LOCAL (the game repo), NOT
  in `plugin/library/` (it symlinks/ships to every game). `plugin/library/` is for AGNOSTIC records.
- **Search with the Grep TOOL or `/opt/homebrew/bin/rg` (full path), NEVER bash `grep`** — the `rtk`
  hook silently drops/mangles matches, so a rename/re-tag sweep done with bash grep WILL miss refs.
  Don't reach for `graphify query` for a fix sweep either: it stores STRUCTURE, not prose, so the
  literal string you're replacing isn't in the graph — it can't enumerate every occurrence. graphify
  is for conceptual questions; a fix's literal sweep needs `rg`'s completeness.

## Steps

1. **Resolve ids.** Read the ledger. For each requested id find its row. If an id is missing,
   already `done`, or is `later`/`skip` (not `fix-now`), **skip it and say so** — do not apply.
2. **Itemize before acting.** List each id → the exact files it will change and the operation.
   For destructive or wide-blast ops (a rename touching many refs, a file move/delete, an agent
   split), confirm with `mcp__ui__ask` first if available; otherwise state it plainly and
   proceed (the human already agreed by passing the id).
3. **Apply per dimension playbook:**
   - **D1 (over-cap agent → split):** create the new specialized agent(s) `plugin/agents/<new>.md`
     (copy a sibling's frontmatter shape + the caveman trigger line), move the sub-domain skills by
     editing each skill's `agents:` tag, and set each new/renamed agent's frontmatter `skills:` to its
     core + domain set. ALSO (don't forget — this is where the blast radius bites): add the new
     name(s) to the `BUILDERS` alias in `ui/server/features/skills/skill-registry.js`; and rewrite the
     genre/routing PROSE that named the old agent — sibling `description`s (godot-dev routing hints,
     player/visuals cross-refs), lineage notes ("split off from …"), and `set-skill-tool` / hook
     examples. `rtk npm run validate` (gen-skill-scope) catches the wiring; sweep the prose with the
     Grep tool.
   - **D2 (decontaminate skill):** rewrite the skill passage generically — strip it to the METHOD
     (no game/character/arena/binary names, no hardcoded paths). The game's specific FACTS already
     live game-local (check the game repo's `design/`/scenes FIRST); do NOT copy the worked example
     into `plugin/library/` (it ships to every game = re-contamination). Apply to agent prompts +
     cache namespaces too, not just skills.
   - **D3 (rename for honest scope):** rename the skill dir + `name:` frontmatter + title, then sweep
     EVERY reference with the **Grep tool** (not bash grep) — agents' frontmatter `skills:` AND body
     refs, the skill's `agents:` tag, cross-skill Requirements, `plugin/library/` records, game-repo
     files, and any archived raw file carrying the old name. Wide blast radius — verify zero of the
     old name remains. (For a PARADIGM-scope fix, don't rename: just tighten the skill's
     `description`/intro to declare its paradigm, e.g. "top-down/orthographic only".)
   - **D4 (add data-driven variant):** add the Resource / `.tres` / `@export`-driven section the
     finding named; keep the existing canonical path, add the data-driven one beside it.
   - **D5 (extract shared block → skill):** create the new shared skill (`agents:` = the consuming
     agents), add it to each agent's frontmatter `skills:` AND a load line at conversation start
     (right after the caveman trigger, so it loads RELIABLY — not just listed), then delete the
     duplicated prose from each agent body.
   - **D6 (orchestrator):** apply the recorded edit to `ui/orchestrator.md` (centralize a
     duplicated directive, move dense prose into a skill, or trim).
   - **D7 (command):** edit the target `plugin/commands/*.md` per the finding.
4. **Verify.** If any framework file changed: `rtk npm run validate` (tsc + eslint, zero
   warnings — this also runs the skill-scope check, catching D1/D3/D5 wiring mistakes) and
   `rtk npx prettier --write` on the touched files. Report the result honestly; if validate
   fails, fix or revert that id and say so — never leave the gate red.
5. **Record.** Mark each applied id `done <YYYY-MM-DD>` in the ledger; leave untouched ids as-is.
   If applying these clears the LAST `open`/`fix-now` row (the pass is fully resolved), PRUNE the
   ledger back to its single "Last audit" line — it's ephemeral working state, not a history log
   (the fixes live in the files + git).
6. **Report — terse.** Per id: applied / skipped (+why), files changed, validate result. End
   with anything still `open` the human may want next.

## Never

- Fix an id the human didn't pass, or invent findings not in the ledger.
- Apply a `later`/`skip` finding, or one already `done`.
- Leave `npm run validate` failing — green gate or revert.
- Put game-specific content into a skill — strip it; the game holds its facts game-local
  (`plugin/library/` is for AGNOSTIC records, NOT game facts).
- Search with bash `grep` — it's `rtk`-filtered and drops matches; use the Grep tool / full-path `rg`.
- Run shell without `rtk`.
