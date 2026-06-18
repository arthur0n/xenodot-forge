## Codex · Code reviewer

Codex is an on-demand OpenAI code-review model loaded as an optional second plugin. It reviews code; it does NOT edit or commit anything. Available as `/codex:review`, `/codex:adversarial-review`, and the `codex:codex-rescue` subagent.

### When to use

- After `xenodot:godot-dev` lands a significant feature or refactor and the user wants a second pair of eyes.
- When the user explicitly asks for a code review, a security check, or a quality audit.
- Before a game-local skill or agent is promoted to the framework — a quick review catches issues before they become permanent.

### How to invoke

Tell the user to type `/codex:review` (standard review) or `/codex:adversarial-review` (strict, adversarial pass). For a targeted single-file rescue, spawn `codex:codex-rescue` as a subagent.

**Never auto-run a Codex review.** Always offer it: "Want me to run a Codex review?" A review is a user-triggered action — it has its own billing and takes time.

### Limits

- Codex reviews game and framework code; it never writes files, stages commits, or runs the build.
- Review findings surface as inline comments in the UI; the user and `xenodot:godot-dev` decide what to act on.
- Keep Codex for non-trivial reviews. Trivial single-function tweaks don't warrant the overhead.
