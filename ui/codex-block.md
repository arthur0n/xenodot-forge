## Codex · Code reviewer

Codex is an on-demand OpenAI code-review model, loaded as an optional second plugin and active
this session (Settings → Codex). It **reviews** code — it never edits, stages, or commits. It
runs on OpenAI's own model with its **own billing** (NOT the user's Anthropic plan), and a real
review takes time. Surfaces as `/codex:review`, `/codex:adversarial-review`, and the
`codex:codex-rescue` subagent.

### You can run it yourself — it is NOT user-only

The `/codex:*` slash commands are thin wrappers around one Node CLI, and you can call that CLI
directly with `Bash`. **No user keystroke is required.** Do not tell the user "I can't launch
Codex, type `/codex:review` yourself" — that is false. You can launch it.

What IS true: slash commands only fire when the user types them, and — because Codex bills
separately and is slow — the framework's policy is that a review is **consent-gated**. So:
**offer first** ("Want me to run a Codex review?") and run it only after the user agrees. Never
fire a review unprompted. That is a billing/UX guardrail, **not** a capability limit.

### How to run it (after the user agrees)

`{{CODEX_COMPANION}}` is the vendored companion CLI (absolute path; the same script the slash
commands wrap). Reviews run against the current working tree — your cwd is the game.

A review **blocks until it finishes**, so launch it in a background `Bash`, then read the output
when it completes (the `--background`/`--wait` flags are parsed but a review always runs in the
foreground of its own process — the background-ness comes from `Bash`, not the flag):

```js
// Standard working-tree review — run in the background so your turn isn't blocked:
Bash({ command: `node "{{CODEX_COMPANION}}" review`, run_in_background: true });
// …against a base branch, or a fixed scope:
Bash({
  command: `node "{{CODEX_COMPANION}}" review --base main --scope branch`,
  run_in_background: true,
});
// Adversarial pass (challenges the approach; takes focus text):
Bash({
  command: `node "{{CODEX_COMPANION}}" adversarial-review "focus on the save/load path"`,
  run_in_background: true,
});
```

Then read it with `BashOutput` on that shell once it's done; return Codex's output to the user
verbatim. For a clearly tiny review (1–2 files) you may run it foreground with `--wait` instead.

For an arbitrary Codex turn (e.g. a quick question or a write task), use `task`, which DOES
self-detach with `--background` and gives a job id you can poll:

```bash
node "{{CODEX_COMPANION}}" task --background --write --model gpt-5.5 "PROMPT"   # returns a job id
node "{{CODEX_COMPANION}}" status --all --json                                  # poll
node "{{CODEX_COMPANION}}" result <job-id> --json                              # read
node "{{CODEX_COMPANION}}" cancel <job-id>                                     # stop, if needed
```

For a targeted **fix-it** pass over Codex's findings, delegate to the `codex:codex-rescue`
subagent via the Task tool (it's scoped to that job). The user can still type `/codex:review`
themselves — but you don't have to wait for them.

### When to use

- After `xenodot:godot-dev` lands a significant feature or refactor and a second pair of eyes helps.
- When the user explicitly asks for a code review, a security check, or a quality audit.
- Before a game-local skill/agent is promoted to the framework — catch issues before they're permanent.

### Limits

- Read-only and advisory: Codex never writes files, stages commits, or runs the build (a `task --write` can edit, but that's the rescue/fix path, not a review).
- Findings surface as inline comments in the UI; you and `xenodot:godot-dev` decide what to act on.
- Keep Codex for non-trivial reviews — trivial single-function tweaks don't warrant the cost/time.
- If the `codex` CLI isn't installed/authed, the companion errors out (install: `npm i -g @openai/codex`, then `codex login`). That's an install/auth gate, not an interactive one.
