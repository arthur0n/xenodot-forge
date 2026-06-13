// Shared JSDoc typedefs — no runtime code. Referenced cross-file with
// `@type {import('../lib/types.js').Name}`. This is how the plain-JS UI gets
// type-checked by `npm run check` (tsconfig `checkJs`) without a build step
// or .ts files. The WebSocket protocol mirrored here is documented in
// PROTOCOL.md — keep the two in sync.

// ---------- /api/state (project inventory) ----------
/** @typedef {{ path: string, title: string }} DesignDoc */
/** @typedef {{ path: string, title: string, verdict: string | null }} LibraryEntry */
/** @typedef {{ name: string, model: string | null }} AgentEntry */
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
 * @property {{ input_tokens?: number, output_tokens?: number }} [usage]
 * @property {{ content?: ContentBlock[] }} [message]
 */

// ---------- Forms & questions ----------
/** @typedef {{ label: string, description?: string }} ChoiceOption */
/** @typedef {{ question: string, options?: (string | ChoiceOption)[], multiSelect?: boolean }} Question */
/** @typedef {"text" | "textarea" | "number" | "checkbox" | "select" | "multiselect"} FieldType */
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
 * @property {string} created - ISO timestamp
 */

// ---------- WebSocket messages ----------
/** @typedef {{ role: "user" | "assistant", text: string }} HistoryItem */
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
 * )} ServerMsg */

/** A row in the activity log.
 * @typedef {{ kind: string, agent: string, child?: string, verb?: string, text?: string, detail?: string }} LogEntry */

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
 *   | { type: "task_update", op: "update" | "remove", id: string, status?: string }
 * )} ClientMsg */
/** Pauses the session, sends the prompt, resolves when the browser replies.
 * @typedef {(type: string, payload: Record<string, unknown>) => Promise<Reply>} WaitFor */
/** A single line from a Claude Code .jsonl transcript (the subset we read).
 * @typedef {{ type?: string, isSidechain?: boolean, message?: { content?: string | Array<{ type?: string, text?: string }> } }} TranscriptEntry */

export {};
