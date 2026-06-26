---
name: research-presenting
agents: [addon-researcher, cli-researcher, skill-researcher, transcript-researcher]
description: How a *-researcher presents a finding/verdict to the human — the 6-bucket framework. Use whenever an addon / cli / skill / transcript researcher is about to present an adopt/reject/keep verdict: never gate on a bare verdict — decompose into the six buckets first, put the verdict ON TOP, and (where the agent has `mcp__ui__form`) have the `select` reference them so the human decides per bucket.
---

# Presenting a research finding — the 6 buckets

Never gate a finding with a bare adopt/reject. First decompose it into these six buckets in the read-only `note`, then put the adopt/reject verdict ON TOP of them and have the `select` question reference them, so the human decides per bucket:

1. **From the source/idea** — the concept being pursued (what the transcript / request / gap reaches for).
2. **From the candidate** — what the thing under evaluation (prompter skill / addon / external tool / source) actually offers.
3. **No-brainers** — adopt as-is.
4. **Improvements** — adopt but rework, and HOW.
5. **Not now, but SYSTEM improvements** — framework-level (NOT game-specific) ideas to park; route these to the existing "Later" section, never into game work.
6. **Definitely skip.**

The adopt/reject/subset verdict still happens — it sits on top of the buckets as your recommendation. Bucket 5 is framework/system only; anything game-specific routes through the normal build handoff, not here.

For an agent with NO `select` in its tools (e.g. transcript-researcher): the block still applies — structure the returned verdict + digest "Recommended next" / "Later" into the 6 buckets (bucket 5 → its existing Later section, buckets 3/4 → Recommended next). Reuse each agent's existing "Later" / park language for bucket 5; don't add a second parking mechanism.
