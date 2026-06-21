# UI conventions & protocol

## Conventions

- **No build step.** `index.html` (structure) + `agent-ui.css` (all styling) + the `client/` ES modules (all behavior, entry `client/core/main.js`), served by the `server/` modules (entry `server/core/index.js`). Shared, env-agnostic helpers live in `lib/`. The browser loads the client as native ES modules (`<script type="module">`) and Node runs the server as ES modules — no bundler. If a change needs one, it's out of scope for this POC. Static files are re-read per request: edit and refresh.
- **Design tokens** live as CSS variables in `:root` of `agent-ui.css` (`--accent`, `--bg`, `--panel*`, `--border*`, `--text*`, `--green`, `--amber`, `--red`, `--blue`, `--purple`, layout `--sidebar-w`/`--activity-w`). Use them; don't hardcode colors.
- **Agent colors**: `client/features/agents/agents.js` assigns each agent a color from a curated, well-separated palette on first appearance (stable per page load), so several agents running at once stay distinct; `paint()` sets `--agent-color` on the node. `main` keeps the ember accent.
- **One session per WebSocket connection.** Refresh = new Claude Code session. Sessions run in the project directory passed to `server/core/index.js` and load its `.claude/` (agents, skills, CLAUDE.md).
- **Resume**: connect with `ws://host?resume=<session-id>` (the page does this via `/?resume=<id>`, used by the sidebar's recent-sessions list) to continue a previous session with full context.
- **The server holds no state.** Project inventory is scanned from disk per request; the browser holds per-session chat state only.

## HTTP

| Route                    | Returns                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                  | the UI page                                                                                                                                                                                                                           |
| `GET /api/state`         | live project inventory (JSON, scanned on every call — never cached, never stale)                                                                                                                                                      |
| `GET /api/sessions`      | recent sessions from the NDJSON logs: `[{ id, title, when }]` — `id` is the Claude Code session id                                                                                                                                    |
| `POST /api/settings`     | merge a settings block into `.xenodot.json` (currently `{ hermes }`); replies with the key-free `{ hermes }` public view. Takes effect immediately — config is re-read per Hermes call, no restart                                    |
| `POST /api/hermes/check` | probe the Hermes gateway (URL/key from the body, or saved config) and reply with a reachability/auth/models/capabilities verdict. `GET /v1/models` only — no model run, no billing. See ui/server/integrations/hermes/hermes-check.js |

`/api/state` shape:

```json
{
  "name": "...", // from project.godot config/name
  "dir": "/abs/path",
  "designDocs": [{ "path": "design/x.md", "title": "first # heading" }],
  "library": [
    {
      "path": "library/x.md",
      "title": "first # heading",
      "verdict": "adopted <name> | rejected — … | parked | null"
    }
  ],
  "scenes": ["scenes/main.tscn"],
  "scripts": ["tools/verify_scene.gd"],
  "agents": [{ "name": "godot-dev", "model": "sonnet" }], // model from agent frontmatter
  "skills": ["godot-verify", "..."],
  // external Hermes researcher config — key-free (hasKey only); never returns the API key.
  // `model`/`models` are cosmetic labels (the effective model is chosen server-side in Hermes);
  // `apiUrl` defaults to the gateway's API server on :8642.
  "hermes": {
    "enabled": false,
    "apiUrl": "http://localhost:8642",
    "model": "nousresearch/hermes-4-70b",
    "hasKey": false,
    "models": [
      "nousresearch/hermes-4-405b",
      "nousresearch/hermes-4-70b",
      "nousresearch/hermes-4.3-36b"
    ]
  }
}
```

## WebSocket messages

### Server → browser

| `type`              | Payload                                                                                                                                                                                                                                                                                          | Meaning                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`            | `text`                                                                                                                                                                                                                                                                                           | lifecycle/info line                                                                                                                                                                                                                                                                                                                         |
| `event`             | `message` (raw Agent SDK message: `system`/`assistant`/`result`/…)                                                                                                                                                                                                                               | session stream                                                                                                                                                                                                                                                                                                                              |
| `ask`               | `id`, `input` (AskUserQuestion input: `questions[]` with `question`, `options[]`, `multiSelect`), `agent?`                                                                                                                                                                                       | agent is interviewing the user; **session is paused until replied**                                                                                                                                                                                                                                                                         |
| `form`              | `id`, `input` (form tool input: `title`, `description?`, `submitLabel?`, `fields[]` — each `{ id, label, type, options?, placeholder?, required?, value? }`, `type` ∈ text \| textarea \| number \| checkbox \| select \| multiselect \| note; note is read-only and returns no value), `agent?` | main agent composed a typed form (`mcp__ui__form`); **session is paused until replied**                                                                                                                                                                                                                                                     |
| `permission`        | `id`, `toolName`, `input`, `agent?`                                                                                                                                                                                                                                                              | tool call awaiting approval; **session is paused until replied**                                                                                                                                                                                                                                                                            |
| `policy`            | `value`                                                                                                                                                                                                                                                                                          | current permission policy (sent at session start and on change)                                                                                                                                                                                                                                                                             |
| `tasks`             | `tasks[]` (each `{ id, title, owner: agent\|user, status: pending\|in_progress\|done, note?, created, kind?: "question", options?, answer? }`)                                                                                                                                                   | the persistent task board; sent at session start and after every mutation. A `kind:"question"` item is an async question filed via `mcp__ui__ask` and renders an inline answer input                                                                                                                                                        |
| `running`           | `agents[]` (each `{ taskId, toolUseId, label, desc, started, background }`)                                                                                                                                                                                                                      | authoritative running-agents snapshot; sent on (re)connect and after every sub-agent spawn/settle. The client reconciles its running strip against this set, so a missed `task_started`/`task_notification` self-heals on the next snapshot (no stale chips). Chips spawned within a short grace window are kept even if not yet in the set |
| `permission_denied` | `toolName`, `agent?`, `reason?` (SDK `decision_reason_type`, e.g. `asyncAgent`\|`rule`\|`mode`), `background?`                                                                                                                                                                                   | a tool call was auto-denied with no interactive prompt (e.g. a headless/background sub-agent the approver can't reach). Logged to the activity stream; a `background` denial also raises a chat banner                                                                                                                                      |
| `context`           | `percentage`, `totalTokens`, `maxTokens`                                                                                                                                                                                                                                                         | live context-window usage, read via `query.getContextUsage()` after each `result`. Drives the session panel meter (green→amber→red) so the user can compact/reset before a long session gets expensive                                                                                                                                      |
| `hermes`            | `phase`: `start` \| `progress` \| `done`, `runId?`, `text`, `persona?` (coworker id: `researcher`\|`critic`)                                                                                                                                                                                     | relayed progress from an external Hermes coworker run (`mcp__ui__hermes`, Hive-only). `persona` names + colors the activity pill. Folded into the activity log; `start`/`progress` also drive the thinking indicator, `done` clears it                                                                                                      |
| `idle`              | —                                                                                                                                                                                                                                                                                                | the SDK stream ended (normal, error, or early end) — clears `busy`, the thinking indicator and the whole running strip. The backstop for a turn/session that ended without a `result` event                                                                                                                                                 |

### Browser → server

| `type`        | Payload                                                | Meaning                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_input`  | `text`                                                 | user message into the session                                                                                                                                                                                                                                                                            |
| `reply`       | `id`, `payload`                                        | answer to an `ask` (`{ answers: { [question]: "label" } }`), a `form` (`{ values: { [fieldId]: string \| number \| boolean \| string[] } }`, or `{ cancelled: true }` for Skip), or a `permission` (`{ allow: boolean, always?: boolean }` — `always` auto-allows that tool for the rest of the session) |
| `policy`      | `value`: `ask` \| `edits` \| `all`                     | set this session's permission policy                                                                                                                                                                                                                                                                     |
| `task_update` | `op`: `update` \| `remove`, `id`, `status?`, `answer?` | user advanced a task's status, removed it, or answered a `kind:"question"` item (`answer` records the reply and marks the question done); the server mutates `.xenodot/tasks.json` and broadcasts a fresh `tasks` message                                                                                |
| `stop`        | —                                                      | interrupt the hive's current turn (`query.interrupt()`); the session stays alive. Wired to the running strip's group ■ Stop                                                                                                                                                                              |
| `stop_task`   | `taskId`                                               | stop ONE backgrounded Xenodot (`query.stopTask(taskId)`); the hive turn and other background workers keep running. Wired to a worker chip's ✕                                                                                                                                                            |
| `compact`     | —                                                      | trim the orchestrator transcript in place by pushing `/compact` as a user turn (the SDK processes slash commands); the SAME session, plugin, skills, warm cache and task board survive — unlike `+ new` (a full cold restart). Wired to the session panel's `compact` button                             |

Notes:

- **Background Xenodots.** When the orchestrator spawns a sub-agent with the Task tool's `run_in_background: true`, the call returns immediately and the hive turn ends, so the user can keep messaging the hive while the worker runs. The client drives the running-agents strip for these from the SDK's `system` events (forwarded as `event`): `task_started` (binds `task_id`↔`tool_use_id`), `task_progress`, `task_updated` (`patch.is_backgrounded`/`status`), and `task_notification` (`status: completed|failed|stopped`, `summary`) which ends the chip. A backgrounded worker's immediate "running in the background" `tool_result` does NOT end its chip — only the `task_notification` does. Interview agents are never backgrounded (they block on `mcp__ui__form`). On top of these per-event folds, the strip is reconciled against the server's authoritative `running` snapshot (above): the server holds the live sub-agent set and re-emits it on every spawn/settle, so any chip no longer in the set is retired — the backstop for a dropped or id-mismatched lifecycle event.
- `permission` cards only appear for tools not already allowed by the project/user settings — an allowlisted Bash command never prompts.
- Custom free-text answers to `ask` are sent the same way as option labels.
- `mcp__ui__form` is an in-process MCP tool defined in `server/mcp-tools/form-tool.js` (`makeFormTool`); its handler waits for the `reply` and returns the values as the tool result (JSON keyed by field id).
- `mcp__ui__tasks` is an in-process MCP tool defined in `server/mcp-tools/task-tool.js` (`makeTaskTool`); the orchestrator calls it with `op: add | update | remove` to manage its task board. Unlike the form tool it does **not** pause the session — it mutates `.xenodot/tasks.json` (via `server/features/tasks/tasks-store.js`), broadcasts the new `tasks` list, and returns a one-line summary. Like the form tool it bypasses the permission policy.
- `mcp__ui__ask` is an in-process MCP tool defined in `server/mcp-tools/ask-tool.js` (`makeAskTool`); the **async** counterpart to `mcp__ui__form` for background/autonomous workers that can't pause for a reply. It files the question onto the board as an `owner:"user"`, `kind:"question"` item (via `addQuestion`), broadcasts `tasks`, and returns **immediately** (never pauses). The user answers it inline (a `task_update` with `answer`); the orchestrator reads the answer on a later turn and relays/acts on it.
- **Auto-deny visibility.** A backgrounded (headless) sub-agent's tool call can be auto-denied by the SDK with no interactive prompt (no approver to reach). The server forwards the SDK's `permission_denied` system message as a `permission_denied` UI message so the friction is visible in the activity log (and, for background, a banner) instead of dying silently as an `is_error` inside a sub-agent transcript. Fix by granting the agent a `permission-mode` (e.g. `acceptEdits`) or a static allow rule.
- The task board persists in `<project>/.xenodot/tasks.json` (the server's only on-disk session state), so it survives across sessions and resumes — the file is the source of truth the agent can also read directly.

## Permission policy

Per-session, switchable live from the header dropdown:

| Policy          | Behavior                                                             |
| --------------- | -------------------------------------------------------------------- |
| `ask` (default) | every un-allowlisted tool call shows an Allow/Deny card              |
| `edits`         | Edit/Write/MultiEdit/NotebookEdit auto-allowed; everything else asks |
| `all`           | every tool auto-allowed                                              |

`AskUserQuestion` and the `mcp__ui__form` form tool always reach the user regardless of policy — questions are the product, not a permission.

Server default for all new sessions: `node ui/server/core/index.js <project> --allow=edits` (or `all`).

## Logs

- One NDJSON file per session in `logs/` (gitignored): every message in both directions plus auto-allowed permissions, timestamped. `{ts, dir: "in"|"out"|"auto", ...message}`.
- Compact per-event lines on the server's stdout.
- Full agent transcripts: UI sessions are real Claude Code sessions — `claude --resume` in the project dir lists them.
