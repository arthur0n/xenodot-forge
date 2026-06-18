## Hermes · Research coworker

Hermes is your external research coworker: a separate agent with its own model, web search, and a private brain (`~/.hermes` — skills + memory it grows across runs). It investigates; it never edits the game or framework.

### Dispatch

For capability/tooling/knowledge-gap _investigation_, call `mcp__ui__hermes` with a focused `task` + `context` (and a `persona`: `researcher` by default, or `critic` to adversarially stress-test a claim/plan/findings) — only you (the Hive) may call it; sub-agents never do.

It is **fire-and-forget**: the call returns immediately; Hermes works in the background, streams progress to the feed, and later delivers its findings as a **new message** (tagged `[Hermes … delivered its findings]`). Do NOT wait on it — finish or wrap up the turn.

When that findings message arrives, treat it as its OWN lead — not a footnote to whatever was already in flight: the server has **already filed a board task** for it the moment it landed, so surface it to the user promptly and let them READ the findings before you put any decision in front of them. Hand it to the matching researcher below to own the human verdict + the library write — and for the route/adopt decision prefer the async board (`mcp__ui__ask`) over a blocking `AskUserQuestion`/`mcp__ui__form`, since a modal can surface **before** the long findings render, leaving it unanswerable in isolation. If it reports Hermes is off/not-configured (or errors), dispatch that researcher directly instead. Each Hermes call is gated (allow/deny).

**Ground before you dispatch.** For any benchmark / audit / improve-what-we-HAVE task, Hermes and the `*-researcher`s cannot read this repo — so FIRST establish the actual current implementation yourself (cite real files: which systems exist, the render path, etc.) and pass it in `context`. Never let a researcher infer our design from genre assumptions or from possibly-stale project docs; an ungrounded benchmark invents gaps that don't exist. Same rule when dispatching a `*-researcher` directly.

### Feedback

After the matching `xenodot:*-researcher` has reviewed the findings and written the verdict to `library/verdicts/`, call `mcp__ui__hermes_feedback` with:

- `runId` — the run id from the findings message header (`run <id>`)
- `verdict` — one of: `"useful"` (cited, actionable, novel); `"partial"` (some findings helped, others were stale/off-topic); `"not-useful"` (off-topic, uncited, or no value found)
- `notes` — 1–3 lines on what was good, missing, or wrong

This fires a short self-update run so Hermes can record the lesson in its own memory and skills. It is non-blocking (fire-and-forget, no findings delivered back). Call it once per delivery — even for "not-useful" runs, so Hermes learns what to avoid.
