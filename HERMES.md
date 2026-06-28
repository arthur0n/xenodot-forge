# Hermes — the optional external researcher

Hermes is an **optional** external agent the **Hive** can delegate deep research to. It is
**off by default** — the framework runs fully without it. Turn it on only if you want to test
whether its web-search + memory + skills produce better capability/tooling research than the
built-in Xenodot researchers.

> **The one thing that trips everyone up:** Hermes is a **separate program with its own model
> and its own billing**. Your Anthropic plan does **not** cover it, and there is **no hosted
> Hermes endpoint** — you install and run it on your own machine, then point Xenodot at it.

## Two keys, one URL (read this first)

| Thing                               | What it is                                           | Where it comes from                                                                                                          |
| ----------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Provider key** (billable)         | The LLM key that powers Hermes' brain                | You sign up (Nous Portal / OpenRouter / Anthropic) and paste it **inside Hermes** via `hermes setup`. Xenodot never sees it. |
| **`API_SERVER_KEY`** (not billable) | A password **you invent** to lock your local gateway | You make it up, put it in `~/.hermes/.env`, and paste the same value into Xenodot's ⚙ Settings → "Server key".               |
| **Server URL**                      | Your **local** gateway                               | `http://localhost:8642` — exists only while `hermes gateway` is running.                                                     |

## Fastest path — one guided command

```bash
npm run hermes:setup
```

Or click **⚙ Settings → Hermes → Set up Hermes**, which runs this same command for you (then
restart the session to activate; you still finish the one-time Nous Portal auth with `hermes portal`).

This installs Hermes if it's missing, turns the local API server on in `~/.hermes/.env`
(generating the `API_SERVER_KEY` for you), **sets the provider and restricts the toolset
directly** via `hermes config set`, installs the Xenodot "partner" persona into `~/.hermes/SOUL.md`
(only if it's absent or the stock template — a customized SOUL is never overwritten; source:
`ui/server/integrations/hermes/hermes-soul.md`), strips any stale `mcp_servers.xenodot` callback
left by older Xenodot versions, echoes what Hermes persisted, and wires Xenodot's config.
It **never launches an interactive Hermes command** (`hermes setup`/`model`/`tools`) — those
pickers are exactly what trap you. Flags:

```bash
npm run hermes:setup -- --yes                              # no prompts (auto-install)
npm run hermes:setup -- --provider=anthropic --model=anthropic/claude-opus-4.6
npm run hermes:setup -- --toolsets=web,search,memory       # override the tool allowlist
npm run hermes:setup -- --no-portal                        # don't print the Nous Portal note
npm run hermes:setup -- --reset                            # undo the setup (test the flow from scratch)
```

`--reset` removes Xenodot's `hermes` block, the `API_SERVER_*` lines from `~/.hermes/.env`,
and the `platform_toolsets.api_server` edit in `config.yaml`. It leaves Hermes itself, your
model/provider and Portal auth untouched — so you can re-run setup on a clean slate.

Defaults: **Nous via Portal**, toolset `web, search, memory, skills` — research plus Hermes' **own
brain** (`memory` + `skills` self-improvement), and **no machine access** (no
`terminal`/`file`/`code_execution`/`browser`; see "Restrict the toolset" and "Self-improvement"
below for why that one line is the whole guardrail). Two things it leaves to you: the Nous Portal
sign-in (a browser OAuth — run `hermes portal open`, _not_ the wizard) and leaving `hermes gateway`
running.

> **Got stuck in `hermes setup` (or `--portal`) before?** Hit **Ctrl+C**. You never need that
> wizard — the script sets every value non-interactively. For Portal auth use `hermes portal`,
> and to pick an exact model use `hermes model`. See "Choosing model & tools" below.

Prefer to do it by hand, or it didn't work? The manual steps are below.

## Step 1 — install & run Hermes (on your machine, one time)

```bash
# Installs python/node/ripgrep + the global `hermes` command
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
# reload your shell

# Pick a model + provider (see "Choosing model & tools" below). For Nous models:
hermes portal open           # one-time Portal sign-in (NOT `hermes setup` — that's the wizard)

# Turn the local API server on — add to ~/.hermes/.env :
#   API_SERVER_ENABLED=true
#   API_SERVER_KEY=pick-any-secret      # you invent this; it's the "Server key" in Xenodot
#   (API_SERVER_PORT defaults to 8642)

# Run it — serves http://localhost:8642
hermes gateway
```

Leave `hermes gateway` running in its own terminal. Cost is roughly **$0.25–$2.50 per deep run**,
billed by whatever provider you chose.

## Choosing model & tools (no wizard needed)

`npm run hermes:setup` does all of this. To do it by hand: **scalars** go through
`hermes config set`; **lists** (the toolset) must be edited in `config.yaml` directly —
`hermes config set` stores a list as a broken quoted string. Inspect state with
`hermes config show` (note: there is **no** `hermes config get`), or edit with
`hermes config edit`. The file lives at `hermes config path`.

**Model / provider** — scalars, so `config set` works:

```bash
hermes config set model.provider nous     # or: anthropic | openrouter | openai | gemini | custom
hermes config set model.default <model-id>
```

Nous (Portal) models need a one-time browser sign-in — use the dedicated auth command, **not**
the wizard: `hermes portal open` (then `hermes portal status` to confirm). Pick the exact model
with `hermes model` (it only lists models for a provider you're already authed to — that's why
nothing showed before sign-in). Other providers just need their key (`hermes auth add`).

**Restrict the toolset.** ⚠️ Critical: the API server runs as its **own platform, `api_server`**,
and per the gateway's `/v1/capabilities`, **its tools execute on _your machine_** (`tool_execution:
server`, no sandbox). It does **not** read `platform_toolsets.cli` or the top-level `toolsets:` —
it reads **`platform_toolsets.api_server`**, and with no entry there it defaults to **everything on**
(terminal, file, code_execution, browser …). So this is the key that matters for the Xenodot bridge:

```yaml
platform_toolsets:
  api_server: [web, search, memory, skills] # research + Hermes' OWN brain (memory + self-evolving
  # skills, written to ~/.hermes — NOT your code); still NO terminal/file/code on your machine
```

`npm run hermes:setup` writes exactly this (default `web, search, memory, skills`). Widen only if
you knowingly want machine access: `--toolsets=web,search,memory,skills,terminal,file`. Individual
toolsets: `web, search, memory, skills, terminal, file, browser, vision, image_gen, todo, tts,
cronjob, moa`. `memory` + `skills` are self-improvement (see below) and stay on your machine inside
`~/.hermes`; `terminal`/`file`/`code_execution`/`browser` are the ones that could touch the game or
this framework, so they stay off.

**Confirm what's actually live** (the only sure check) — `npm run hermes:check` queries the
gateway's `GET /v1/toolsets` and prints the enabled tools, loudly flagging any machine-access ones:

```
API-path tools enabled: web, search, memory, skills
✓ no machine-access tools (terminal/file/code) on the API path.
```

(`memory` and `skills` are Hermes' own brain, not machine access — the check only flags
`terminal`/`file`/`code_execution`/`browser`.)

Avoid `agent.disabled_toolsets` — a known bug
([#33924](https://github.com/NousResearch/hermes-agent/issues/33924)) can make a bundle name
there silently kill _all_ tools on the gateway path.

## Self-improvement: Hermes' own brain, not your code

Hermes' headline feature is **self-improvement** — after a non-trivial task it writes/updates its
own reusable **skills** (`skill_manage` → `~/.hermes/skills/`) and a background review refreshes its
**memory** (`MEMORY.md`, `USER.md`). We leave both on (`memory` + `skills` in the toolset above) on
purpose: the more Hermes researches for this team, the better it gets at it. You'll see
`🧠 Hermes is updating its own skills/memory` lines in the activity feed when it happens.

**Two separate spheres — this is the whole guardrail.**

- **Hermes' brain** (`~/.hermes/skills`, `~/.hermes/MEMORY.md`) — Hermes grows this freely. It's
  _its_ procedural/episodic memory, not yours.
- **Your project** (the game + this framework) — Hermes **never** touches it. The toolsets that
  could (`terminal`/`file`/`code_execution`/`browser`) stay **off**, so Hermes physically cannot
  edit, build, or write your files. Adopting anything Hermes _found_ into your project is a
  separate, human-gated step: a `xenodot:*-researcher` writes the verdict + `plugin/library/` entry,
  you approve, and `promote` globalizes it. Hermes self-improving and your codebase changing are
  **different things**, and only the second one is gated by you.

The trade-off we accept: Hermes' brain and our `plugin/library` drift apart over time ("two
brains"). That's fine here — Hermes investigates, humans adopt; nothing Hermes "learns" reaches your
project except through the researcher → library → promote gate.

## Step 2 — point Xenodot at it

**From the UI (recommended):** `npm start` → ⚙ **Settings** →

1. Expand "First time?" for these same steps.
2. Enable Hermes · URL `http://localhost:8642` · Server key = the `API_SERVER_KEY` you invented.
3. Click **Test connection** — it probes `GET /v1/models` (no model run, no charge) and tells you
   if the gateway is reachable and the key is accepted.
4. **Save.** Takes effect immediately — no server restart.

**From the CLI (equivalent):**

```bash
npm run hermes -- --hermes --hermes-url=http://localhost:8642 --hermes-key=pick-any-secret
npm run hermes:check     # probes the saved config, prints a one-line verdict
npm run hermes -- --hermes-off   # turn it back off
```

## Step 3 — try it

Start a session and give the Hive a **capability / tooling / knowledge-gap** task
(e.g. _"research the best Godot 4 approach for X"_) — optionally naming a persona ("have the
**critic** stress-test …"). When the Hive calls `mcp__ui__hermes`, **approve it in the permission
gate**. It's **fire-and-forget**: the call returns at once and you keep working — Hermes runs in
the background and a watcher streams progress to the feed (the **Hermes** lines, colored per
persona). There is **no callback**: when the run finishes, the watcher **reads** the result from the
runs API (`GET /v1/runs/{id}`) and delivers it as a new message. The Hive then hands those findings
to the matching `xenodot:*-researcher` → your adopt/reject verdict. If Hermes is off, unreachable,
or the run fails/times out, the Hive just dispatches the researcher itself — same result, no Hermes.

## Can I install Hermes from the UI?

Not fully — and on purpose. Installation is a `curl … | bash`, and choosing a billable provider
(esp. the Nous Portal OAuth) belongs in your terminal, not a web form. The closest to one-click
is the CLI `npm run hermes:setup`, which now sets the model, provider and toolset for you
non-interactively. The UI gives you the copy-paste runbook (⚙ Settings → "First time?") and the
**Test connection** button for instant feedback once the gateway is up.

> **Note on the UI "model" field:** it's a **label only** — it records which model you pointed
> Hermes at, it does **not** change Hermes' actual model. The real model lives in Hermes'
> `config.yaml` (`hermes config set model.default …`, or `npm run hermes:setup`). Changing the
> dropdown alone does nothing on the Hermes side.

## Troubleshooting

- **"No response within 8s — is `hermes gateway` running?"** → the gateway isn't up, or the URL/port
  is wrong. Confirm `hermes gateway` is running and the port matches `API_SERVER_PORT`.
- **"server key was rejected"** → the Xenodot "Server key" ≠ the `API_SERVER_KEY` in `~/.hermes/.env`.
- **Hive says "Hermes is off or not configured"** → enable it in ⚙ Settings (or `npm run hermes -- --hermes`).
- **It works but research isn't better** → that's the real question this POC answers. Compare on a
  real gap task against the native researcher before widening the seam.
