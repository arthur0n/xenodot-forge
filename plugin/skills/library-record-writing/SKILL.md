---
name: library-record-writing
agents: [addon-researcher, cli-researcher]
domain: universal
description: How a *-researcher writes a durable `library/<kind>/` record — the machine-face frontmatter rule, the index-append step, the one-page limit, and the post-adopt/post-build 4-field Lesson section. Use whenever an addon / cli researcher writes its verdict doc (`library/addons/<slug>.md`, `library/tools/<slug>.md`) so the record is queryable, indexed, and agnostic. Owns the shared record-writing METHOD; each agent still owns its own per-kind template (frontmatter fields + doc structure).
---

# Writing a library record (the shared method)

A researcher's durable artifact is a `library/<kind>/<slug>.md` record — written on EVERY verdict, including "build it ourselves" / "build thin", so the next session doesn't re-research. Your agent prompt owns the per-kind template (its `type:`, frontmatter fields, and doc body). This skill owns the method that is the SAME across kinds.

## Machine-face frontmatter

The frontmatter is the record's machine face (OKF-style — the UI sidebar and the kind index read it; `library/README.md` documents the convention). Keep `description` a **one-line verdict** (adopt/reject/park + the deciding reason), not a summary of the body.

## Append to the kind index

After writing the doc, append its line to that kind's `library/<kind>/index.md`, **sorted by filename**:

```
- [<title>](<slug>.md) — <description>
```

## One page, no more

Keep the record under a page. A catalog/registry nobody reads is research nobody reuses.

## The Lesson section (post-adopt / post-build)

Once the thing you evaluated is actually installed/built and USED, append a tiny **Lesson** section to this SAME doc (never fork a new file) — 4 fields, plain and AGNOSTIC:

- **What** — the one fact worth remembering.
- **Why** — why it matters / what it prevents next time.
- **Gotcha** — the trap that bit us (a broken assumption, a sharp edge).
- **Universal vs game** — generalizes to any game, or specific to THIS one? Concrete game facts (scene names, exact numbers, this game's own bugs) use the placeholder standard (`docs/process/promotion.md`, criterion 1) or stay in the GAME's own local library — never in `library/` (it ships to every game).
