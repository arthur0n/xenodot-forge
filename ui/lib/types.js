// Shared JSDoc typedefs — no runtime code. Referenced cross-file with
// `@type {import('../lib/types.js').Name}`. This is how the plain-JS UI gets
// type-checked by `npm run check` (tsconfig `checkJs`) without a build step
// or .ts files. The WebSocket protocol mirrored here is documented in
// PROTOCOL.md — keep the two in sync.

// ---------- /api/state (project inventory) ----------
/** @typedef {{ path: string, title: string }} DesignDoc */
/** @typedef {{ path: string, title: string, type: string | null, description: string | null }} LibraryEntry */
/** @typedef {{ name: string, model: string | null }} AgentEntry */
/** Browser-safe Hermes config (no API key — `hasKey` only). @typedef {{ enabled: boolean, apiUrl: string | null, model: string, hasKey: boolean, models: string[] }} HermesPublicConfig */
/** Verdict from probing a Hermes gateway (`POST /api/hermes/check`). @typedef {{ ok: boolean, reachable: boolean, authOk: boolean, status?: number, models?: string[], tools?: string[], error?: string }} HermesCheck */
/** Browser-safe Codex config (no secrets — auth lives in the local `codex` CLI). `vendored` =
 * the optional plugin has been cloned on disk. @typedef {{ enabled: boolean, vendored: boolean }} CodexPublicConfig */
/** Verdict from probing the local Codex install (`POST /api/codex/check`). @typedef {{ ok: boolean, enabled: boolean, cli: boolean, version?: string, authOk: boolean, authMode?: string, authMethod?: "chatgpt" | "apiKey", model?: string, vendored: boolean, caveat?: string, error?: string }} CodexCheck */
/** Browser-safe Godot-docs MCP config (no secrets — it queries the public docs site).
 * @typedef {{ enabled: boolean }} DocsPublicConfig */
/**
 * @typedef {object} ProjectState
 * @property {string} name
 * @property {string} dir
 * @property {boolean} found - whether dir holds a Godot project (has project.godot)
 * @property {DesignDoc[]} designDocs
 * @property {LibraryEntry[]} library
 * @property {string[]} scenes
 * @property {string[]} scripts
 * @property {AgentEntry[]} agents
 * @property {string[]} skills
 * @property {HermesPublicConfig} hermes - external Hermes researcher config (key-free)
 * @property {CodexPublicConfig} codex - optional Codex reviewer config (secret-free)
 * @property {DocsPublicConfig} docs - optional Godot-docs MCP config (secret-free)
 */

/** @typedef {{ id: string, title: string, when: string }} RecentSession */

// ---------- Agent SDK event payloads (the subset the UI reads) ----------
/** Arbitrary tool-call input; known fields are read, the rest is opaque JSON.
 * @typedef {object} ToolInput
 * @property {string} [file_path]
 * @property {string} [command]
 * @property {string} [pattern]
 * @property {string} [skill]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [subagent_type]
 * @property {boolean} [run_in_background] - hive backgrounds this Xenodot (Task/Agent input)
 * @property {Todo[]} [todos]
 * @property {Question[]} [questions]
 */
/** @typedef {{ type: string, text?: string, id?: string, name?: string, input?: ToolInput, tool_use_id?: string }} ContentBlock */
/**
 * @typedef {object} SdkEvent
 * @property {string} type
 * @property {string} [subtype]
 * @property {string} [model]
 * @property {string | null} [parent_tool_use_id]
 * @property {string} [subagent_type] - sub-agent label on messages it produced
 * @property {number} [total_cost_usd]
 * @property {number} [duration_ms]
 * @property {{ input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number, cache_read_input_tokens?: number }} [usage]
 * @property {{ status?: string, utilization?: number, rateLimitType?: string, resetsAt?: number }} [rate_limit_info] - rate_limit_event: claude.ai plan utilization
 * @property {{ content?: ContentBlock[] }} [message]
 * @property {string} [task_id] - background-task lifecycle events (task_started/updated/notification)
 * @property {string} [tool_use_id] - the spawning Task tool_use id a task event ties back to
 * @property {string} [status] - task_notification: completed | failed | stopped
 * @property {string} [summary] - task_notification/progress: the worker's result/progress text
 * @property {string} [last_tool_name] - task_progress: tool the worker is currently running
 * @property {{ status?: string, is_backgrounded?: boolean }} [patch] - task_updated changed fields
 */

// ---------- Forms & questions ----------
/** @typedef {{ label: string, description?: string }} ChoiceOption */
/** @typedef {{ question: string, options?: (string | ChoiceOption)[], multiSelect?: boolean }} Question */
/** @typedef {"text" | "textarea" | "number" | "checkbox" | "select" | "multiselect" | "note"} FieldType */
/**
 * @typedef {object} FormField
 * @property {string} id
 * @property {string} [label]
 * @property {FieldType} type
 * @property {ChoiceOption[]} [options]
 * @property {string} [placeholder]
 * @property {boolean} [required]
 * @property {string | number | boolean | string[]} [value]
 */
/** @typedef {{ title?: string, description?: string, submitLabel?: string, fields?: FormField[] }} FormSpec */
/** @typedef {{ content: string, status: "pending" | "in_progress" | "completed" }} Todo */

// ---------- Tasks (persistent orchestrator to-do board) ----------
/**
 * A task in the right-rail board, persisted to <project>/.xenodot/tasks.json.
 * @typedef {object} Task
 * @property {string} id - short slug, e.g. "t3"
 * @property {string} title
 * @property {"agent" | "user"} owner - who must do it
 * @property {"pending" | "in_progress" | "done"} status
 * @property {string} [note] - optional one-line detail
 * @property {string} [agent] - internal: creating agent ("main" | "background" | a subagent_type), used to close a sub-agent's tasks when it finishes
 * @property {"question"} [kind] - a question filed via mcp__ui__ask (async human-gate); renders an answer input instead of a status tick
 * @property {string[]} [options] - question only: suggested answers the user can one-click
 * @property {string} [answer] - question only: the user's answer (set via task_update; the orchestrator relays it)
 * @property {string} created - ISO timestamp
 */

// ---------- Promotions (project-local → framework plugin) ----------
/**
 * A promotion request, persisted to <project>/.xenodot/promotions.json — the
 * deterministic record of a capability asked to be promoted into the plugin.
 * @typedef {object} Promotion
 * @property {string} id - short slug, e.g. "p3"
 * @property {"tools" | "skills" | "agents"} kind
 * @property {string} name - the capability's project-local name (tools/ file, skill dir, or agent .md)
 * @property {string} [reason] - one line: why it's broadly useful beyond this project
 * @property {"requested" | "approved" | "rejected" | "promoted"} status
 * @property {string} [by] - requesting agent label
 * @property {string} at - ISO timestamp of the last state change
 */

// ---------- Autonomous Mode ----------
/** A standing "Main Goal" the hive self-drives toward, with a recurring check loop.
 * Persisted in .xenodot/autonomous.json; mirrored to the client store for the header flag.
 * @typedef {object} Autonomous
 * @property {boolean} active        - the ON/OFF flag the header badge reflects
 * @property {string} goal           - the Main Goal text
 * @property {number} intervalMs     - check cadence (default 5 min)
 * @property {string | null} startedAt   - ISO when turned on
 * @property {string | null} lastCheckAt - ISO of the last check tick
 * @property {number} checks         - how many check ticks have fired
 * @property {string | null} status  - "running" | "paused" | "complete" | latest progress note
 * @property {string | null} report  - final report once the goal is judged met
 */

// ---------- WebSocket messages ----------
/** @typedef {{ role: "user" | "assistant", text: string }} HistoryItem */
/** One in-flight sub-agent in the authoritative running-strip snapshot. The server
 * owns this set (its `runningByTask` map); the client reconciles `state.running`
 * against it so a missed lifecycle event self-heals on the next snapshot.
 * @typedef {{ taskId: string, toolUseId: string, label: string, desc: string, started: number, background: boolean }} RunningAgentWire */
/**
 * Server -> browser. Discriminated on `type`.
 * @typedef {(
 *   | { type: "status", text: string }
 *   | { type: "event", message: SdkEvent }
 *   | { type: "ask", id: number, input: { questions?: Question[] }, agent?: string }
 *   | { type: "form", id: number, input: FormSpec, agent?: string }
 *   | { type: "permission", id: number, toolName: string, input: ToolInput, agent?: string }
 *   | { type: "policy", value: string }
 *   | { type: "history", items?: HistoryItem[] }
 *   | { type: "tasks", tasks: Task[] }
 *   | { type: "running", agents: RunningAgentWire[] }
 *   | { type: "promotions", items: Promotion[] }
 *   | { type: "permission_denied", toolName: string, agent?: string, reason?: string, background?: boolean }
 *   | { type: "context", percentage: number, totalTokens: number, maxTokens: number }
 *   | { type: "hermes", phase: "start" | "progress" | "done", runId?: string, text: string, persona?: string }
 *   | { type: "autonomousMode", payload: Autonomous }
 *   | { type: "session", id: string | null }
 *   | { type: "idle" }
 * )} ServerMsg */

/** A row in the activity log. `color` (optional) is an inline pill color — used by Hermes
 * persona rows to tint `--hermes-pill` per persona without a CSS class each.
 * @typedef {{ kind: string, agent: string, child?: string, verb?: string, text?: string, detail?: string, color?: string }} LogEntry */

// ---------- Server-internal plumbing ----------
/** A reply from the browser to a paused interaction (ask / form / permission).
 * @typedef {{ answers?: Record<string, string>, values?: Record<string, unknown>, cancelled?: boolean, allow?: boolean, always?: boolean }} Reply */
/** An outgoing server -> browser message; logged then serialized.
 * @typedef {{ type?: string, message?: { type?: string, subtype?: string }, [key: string]: unknown }} OutMsg */
/** Browser -> server messages.
 * @typedef {(
 *   | { type: "user_input", text: string }
 *   | { type: "reply", id: number, payload: Reply }
 *   | { type: "policy", value: string }
 *   | { type: "task_update", op: "update" | "remove", id: string, status?: string, answer?: string }
 *   | { type: "promotion_decide", id: string, decision: "approved" | "rejected" }
 *   | { type: "promotion_run", id: string }
 *   | { type: "stop" }
 *   | { type: "stop_task", taskId: string }
 *   | { type: "compact" }
 *   | { type: "autonomous_mode", action: "start" | "stop", goal?: string }
 * )} ClientMsg */
/** Pauses the session, sends the prompt, resolves when the browser replies.
 * @typedef {(type: string, payload: Record<string, unknown>) => Promise<Reply>} WaitFor */
/** A single line from a Claude Code .jsonl transcript (the subset we read).
 * @typedef {{ type?: string, isSidechain?: boolean, message?: { content?: string | Array<{ type?: string, text?: string }> } }} TranscriptEntry */

export {};
