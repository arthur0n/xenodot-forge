# Codex — optional, on-demand code review

Xenodot can use **OpenAI's Codex** as a second pair of eyes on code, for **both** the game
(GDScript under your project) and the framework itself. It's **off by default**, gated, and
lives **outside** the framework spine (`plugin/`) — nothing ships to games unless you turn it
on. This mirrors the [Hermes](HERMES.md) pattern: a separate program with its **own model and
its own billing** (your Anthropic plan does **not** cover it).

We don't reinvent the reviewer — we vendor OpenAI's official Claude Code plugin
[`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) and load it as an
**optional second local plugin**. You get its `/codex:review`, `/codex:adversarial-review`,
the `codex:codex-rescue` subagent, and its structured review output, unchanged.

> **On-demand only.** We deliberately do **not** enable the plugin's opt-in Stop-hook "review
> gate" (it can spin up long Claude↔Codex loops). Reviews run only when you ask for them.

## Prerequisites

- **Node.js ≥ 18.18** (the plugin's floor).
- The **`@openai/codex` CLI** installed (`npm i -g @openai/codex`).
- A **`codex login`** session — a **ChatGPT account (incl. the Free tier) _or_ an OpenAI API
  key**. Codex owns the credential (stored in `auth.json` under `CODEX_HOME`, default
  `~/.codex`); **Xenodot never sees or stores it**.

## Setup (one command)

```bash
npm run codex:setup     # checks the CLI (offers to install it), clones the review plugin
                        # into the gitignored vendor/ dir, and flips the codex switch on
codex login             # one-time browser sign-in or API key  (or, in a session:  ! codex login)
npm run codex:check     # verify: CLI present? logged in? plugin vendored?
```

`npm run codex:setup -- --reset` undoes it (disables the switch and removes the vendored
clone). Pin the plugin to a tag with `--ref=<tag>`; skip prompts with `--yes`.

You can also toggle it from **⚙ Settings → Codex** (an Enable checkbox + a **Test Codex**
button that runs the same readiness probe).

### How it wires up

- The clone lands in `vendor/codex-plugin-cc/` (gitignored). The loadable plugin root is
  `vendor/codex-plugin-cc/plugins/codex/`.
- `.xenodot.json` gets a `codex` block: `{ "enabled": true }`. That's the whole switch — no
  keys, no URLs. Override per-process with `CODEX_ENABLED=true|false`.
- `session.js` appends the plugin to the SDK `plugins` array **only** when `codex.enabled`
  **and** the plugin is actually vendored. Disabled or absent → nothing changes.

## Reviewing the **game**

In a game session (the web UI), once Codex is enabled, type a slash command in the input — it
expands against the game's working tree, just like in terminal Claude Code:

```
/codex:review --base main
/codex:adversarial-review "focus on the save/load path"
```

Codex posts its findings back into the session. The orchestrator can also delegate a fix-it
task to the `codex:codex-rescue` subagent. Everything is advisory — nothing auto-applies.

> Slash commands only run when **you** type them (the SDK can't invoke them on its own), so
> Codex never fires unprompted.

## Reviewing the **framework**

Framework work happens in a **terminal** Claude Code session on this repo, where slash commands
work natively. Install the plugin once:

```
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/codex:setup            # the plugin's own setup (CLI + auth check)
/codex:review --base main
```

(If you've already run `npm run codex:setup`, the CLI and your login are shared — terminal and
UI use the same local Codex.)

## Cost & safety

- **Billed to your ChatGPT/OpenAI account**, per Codex's pricing — not your Anthropic plan.
- Reviews are **read-only and advisory**; the review gate stays **off** (no auto-blocking, no
  Claude↔Codex loops). If you ever want the gate, it's the plugin's
  `/codex:setup --enable-review-gate` — opt in knowingly.
- Nothing about Codex is committed to the framework or shipped to games; it's vendored locally
  and gated off until you run setup.

## Troubleshooting

- `npm run codex:check` is the fast verdict: CLI on PATH? `codex login status` OK? plugin
  vendored? It prints exactly what's missing.
- "Switched on, but the plugin isn't vendored" in Settings → run `npm run codex:setup`.
- `codex` not found after install → open a new terminal so it's on `PATH`, then re-run setup.
