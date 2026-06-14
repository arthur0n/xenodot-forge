// One WebSocket connection == one Claude Code session. The old ~140-line
// connection handler is decomposed here into small single-purpose helpers
// (logger, inbox, waitFor, canUseTool, run, client-message, close) so each
// stays well under the complexity/size limits.
import { createWriteStream } from "node:fs";
import path from "node:path";
import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import { parseJSON } from "../lib/json.js";
import { sessionHistory } from "./transcripts.js";
import { makeFormTool } from "./form-tool.js";
import { makeTaskTool } from "./task-tool.js";
import { makeAssetTool } from "./asset-tool.js";
import {
  readTasks,
  applyOp,
  pruneDoneTasks,
  addBackgroundTask,
  closeOpenByAgent,
  closeStragglerTasks,
} from "./tasks-store.js";
import {
  DEFAULT_POLICY,
  EDIT_TOOLS,
  FORM_TOOL,
  TASK_TOOL,
  ASSET_TOOL,
  MODEL,
  EFFORT,
  ORCHESTRATOR_PROMPT,
  POLICIES,
  PROJECT_DIR,
  LOG_DIR,
} from "./config.js";

/** @typedef {import("../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("../lib/types.js").Reply} Reply */
/** @typedef {import("../lib/types.js").ClientMsg} ClientMsg */
/** @typedef {import("../lib/types.js").WaitFor} WaitFor */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */
/** @typedef {Map<number, { type: string, resolve: (value: Reply) => void }>} Pending */

/** Per-connection NDJSON logger + the `send` that mirrors every outgoing
 * message into it. @param {import("ws").WebSocket} ws */
function createLogger(ws) {
  const sessionTag = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(LOG_DIR, `session-${sessionTag}.ndjson`);
  const logStream = createWriteStream(logFile, { flags: "a" });
  /** @param {string} dir @param {OutMsg} obj */
  const log = (dir, obj) => {
    logStream.write(JSON.stringify({ ts: new Date().toISOString(), dir, ...obj }) + "\n");
    const m = obj.message;
    const brief =
      obj.type === "event"
        ? `${m?.type ?? ""}${m?.subtype ? "/" + m.subtype : ""}`
        : (obj.type ?? "");
    console.log(`[${sessionTag}] ${dir} ${brief}`);
  };
  /** @param {OutMsg} obj */
  const send = (obj) => {
    log("out", obj);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  console.log(`session log: ${logFile}`);
  return { log, send, end: () => logStream.end() };
}

/** The user side of the session: an async iterable the SDK consumes, fed by
 * the browser's user_input messages. */
function createInbox() {
  /** @type {SDKUserMessage[]} */
  const queue = [];
  /** @type {(() => void) | null} */
  let wake = null;
  let closed = false;
  const iterable = (async function* () {
    while (!closed) {
      let next;
      while ((next = queue.shift())) yield next;
      await new Promise((resolve) => {
        wake = () => {
          resolve(undefined);
        };
      });
    }
  })();
  return {
    iterable,
    /** @param {SDKUserMessage} msg */
    push(msg) {
      queue.push(msg);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
  };
}

/** @param {(obj: OutMsg) => void} send @param {Pending} pending @returns {WaitFor} */
function makeWaitFor(send, pending) {
  let nextId = 1;
  return (type, payload) => {
    const id = nextId++;
    send({ type, id, ...payload });
    return new Promise((resolve) => {
      pending.set(id, { type, resolve });
    });
  };
}

/**
 * @param {{ session: { policy: string }, sessionAllowed: Set<string>, waitFor: WaitFor, log: (dir: string, obj: OutMsg) => void, agentByTool: Map<string, string>, formAgentQueue: string[] }} deps
 * @returns {import("@anthropic-ai/claude-agent-sdk").CanUseTool}
 */
function makeCanUseTool({ session, sessionAllowed, waitFor, log, agentByTool, formAgentQueue }) {
  return async (toolName, input, opts) => {
    // Which agent raised this call (main loop or a sub-agent), so the UI can
    // label concurrent approvals. opts.toolUseID is set by the SDK.
    const agent = agentByTool.get(opts.toolUseID) ?? "main";
    if (toolName === "AskUserQuestion") {
      const answers = await waitFor("ask", { input, agent });
      return { behavior: "allow", updatedInput: { ...input, ...answers } };
    }
    if (toolName === FORM_TOOL) {
      // The tool handler does the waiting; hand it this call's agent (FIFO,
      // since canUseTool and the handler run 1:1 and order-aligned per tool).
      // Forms come only from FOREGROUND interview agents — backgrounded
      // (autonomous) Xenodots never call mcp__ui__form (orchestrator rule), so
      // no two forms overlap and the FIFO stays 1:1 even with a worker in flight.
      formAgentQueue.push(agent);
      return { behavior: "allow", updatedInput: input };
    }
    if (toolName === TASK_TOOL) {
      // UI-control tool: mutates the task board, never pauses — auto-allow.
      // Stamp the calling agent (`_by`) so the server can deterministically close
      // this agent's open tasks when it finishes (see closeOpenByAgent). The
      // server overrides any model-supplied `_by`.
      return { behavior: "allow", updatedInput: { ...input, _by: agent } };
    }
    if (toolName === ASSET_TOOL) {
      // UI-control tool: files a user-owned asset request, never pauses — auto-allow.
      return { behavior: "allow", updatedInput: input };
    }
    if (
      session.policy === "all" ||
      (session.policy === "edits" && EDIT_TOOLS.has(toolName)) ||
      sessionAllowed.has(toolName)
    ) {
      log("auto", { type: "permission", toolName, policy: session.policy });
      return { behavior: "allow", updatedInput: input };
    }
    const { allow, always } = await waitFor("permission", { toolName, input, agent });
    if (allow && always) sessionAllowed.add(toolName);
    return allow
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "Denied from the web UI" };
  };
}

/** Bridge a backgrounded sub-agent onto the persistent board as an in_progress
 * agent task, so background work shows in the right rail (not just the running
 * strip). Only run_in_background spawns are bridged; foreground sub-agents are
 * not (they'd clutter the board). Idempotent per task_id.
 * @param {{ taskId?: string, toolUseId?: string, desc?: string }} t
 * @param {{ bgSpawns: Set<string>, bgBoard: Map<string, string>, send: (obj: OutMsg) => void }} deps
 */
function bridgeStart(t, { bgSpawns, bgBoard, send }) {
  if (!t.taskId || !t.toolUseId || !bgSpawns.has(t.toolUseId) || bgBoard.has(t.taskId)) return;
  const title = (t.desc ?? "background task").slice(0, 200);
  const { list, id } = addBackgroundTask(title, "background worker", new Date().toISOString());
  bgBoard.set(t.taskId, id);
  send({ type: "tasks", tasks: list });
}

/** Settle a bridged background task when its worker finishes: completed → mark
 * done (auto-pruned next turn); failed/stopped → remove it.
 * @param {{ taskId?: string, status?: string }} t
 * @param {{ bgBoard: Map<string, string>, send: (obj: OutMsg) => void }} deps
 */
function bridgeSettle(t, { bgBoard, send }) {
  if (!t.taskId) return;
  const boardId = bgBoard.get(t.taskId);
  if (!boardId) return;
  bgBoard.delete(t.taskId);
  const now = new Date().toISOString();
  const list =
    t.status === "completed"
      ? applyOp({ op: "update", id: boardId, status: "done" }, now)
      : applyOp({ op: "remove", id: boardId }, now);
  send({ type: "tasks", tasks: list });
}

/** Close a finished sub-agent's own open tasks (its scratchpad), keyed by the
 * agent label recorded at task_started. task_notification fires for foreground
 * AND background sub-agents, so this deterministically restores the inline close
 * that the background change removed for foreground work — no LLM cooperation
 * needed. @param {string | undefined} taskId
 * @param {{ runningByTask: Map<string, string>, send: (obj: OutMsg) => void }} deps */
function settleAgentTasks(taskId, { runningByTask, send }) {
  if (!taskId) return;
  const label = runningByTask.get(taskId);
  runningByTask.delete(taskId);
  if (!label) return;
  send({ type: "tasks", tasks: closeOpenByAgent(label) });
}

/** Turn-end backstop: close any open sub-agent task whose owner is no longer
 * running — a foreground straggler whose task_notification never arrived (e.g. a
 * hard interrupt). Live sub-agents (incl. background workers) and the
 * orchestrator's own cross-turn board are preserved.
 * @param {{ runningByTask: Map<string, string>, send: (obj: OutMsg) => void }} deps */
function sweepStragglers({ runningByTask, send }) {
  const list = closeStragglerTasks(new Set(runningByTask.values()));
  if (list) send({ type: "tasks", tasks: list });
}

/** Record each tool_use → the agent that raised it (so canUseTool can label
 * concurrent approvals) and note which spawns are backgrounded.
 * @param {import("@anthropic-ai/claude-agent-sdk").SDKAssistantMessage} message
 * @param {{ agentByTool: Map<string, string>, bgSpawns: Set<string> }} deps */
function trackToolUses(message, { agentByTool, bgSpawns }) {
  const label = message.subagent_type ?? "main";
  for (const b of message.message?.content ?? []) {
    if (b.type === "tool_use" && b.id) {
      agentByTool.set(b.id, label);
      const inp = /** @type {{ run_in_background?: boolean } | undefined} */ (b.input);
      if (inp?.run_in_background) bgSpawns.add(b.id);
    }
  }
}

/** Per-message bookkeeping on the SDK stream: track tool_use→agent, bridge
 * background workers onto the board, deterministically close each sub-agent's own
 * tasks when it finishes, and sweep stragglers at turn end.
 * @param {import("@anthropic-ai/claude-agent-sdk").SDKMessage} message
 * @param {{ agentByTool: Map<string, string>, bgSpawns: Set<string>, bgBoard: Map<string, string>, runningByTask: Map<string, string>, send: (obj: OutMsg) => void }} deps
 */
function trackMessage(message, { agentByTool, bgSpawns, bgBoard, runningByTask, send }) {
  if (message.type === "assistant") {
    trackToolUses(message, { agentByTool, bgSpawns });
  } else if (message.type === "system" && message.subtype === "task_started") {
    // Remember which sub-agent owns this spawn, so settleAgentTasks can close
    // exactly its tasks when its notification arrives.
    if (message.task_id) runningByTask.set(message.task_id, message.subagent_type ?? "");
    bridgeStart(
      { taskId: message.task_id, toolUseId: message.tool_use_id, desc: message.description },
      { bgSpawns, bgBoard, send },
    );
  } else if (message.type === "system" && message.subtype === "task_notification") {
    bridgeSettle({ taskId: message.task_id, status: message.status }, { bgBoard, send });
    settleAgentTasks(message.task_id, { runningByTask, send });
  } else if (message.type === "result") {
    sweepStragglers({ runningByTask, send });
  }
}

/**
 * Drive the Claude Code session and stream its messages to the browser.
 * @param {{ resumeId: string | null, policy: string, inbox: ReturnType<typeof createInbox>, send: (obj: OutMsg) => void, canUseTool: import("@anthropic-ai/claude-agent-sdk").CanUseTool, abort: AbortController, waitFor: WaitFor, agentByTool: Map<string, string>, formAgentQueue: string[], session: { policy: string, query?: { interrupt?: () => Promise<void>, stopTask?: (taskId: string) => Promise<void> } } }} deps
 */
function runSession({
  resumeId,
  policy,
  inbox,
  send,
  canUseTool,
  abort,
  waitFor,
  agentByTool,
  formAgentQueue,
  session,
}) {
  void (async () => {
    try {
      send({ type: "policy", value: policy });
      // Paint the persisted task board immediately (fresh or resumed session).
      send({ type: "tasks", tasks: readTasks() });
      if (resumeId) {
        send({ type: "history", items: sessionHistory(resumeId) });
        send({ type: "status", text: `resumed session ${resumeId.slice(0, 8)}…` });
      } else {
        send({ type: "status", text: `session starting in ${PROJECT_DIR}` });
      }
      const q = query({
        prompt: inbox.iterable,
        options: {
          ...(resumeId ? { resume: resumeId } : {}),
          cwd: PROJECT_DIR,
          // Pick up the project's .claude/ (agents, skills) and CLAUDE.md.
          settingSources: ["user", "project", "local"],
          model: MODEL,
          // Orchestrator routes more than it reasons; sub-agents override via their
          // own `effort:` frontmatter while active. Skill discovery stays default
          // ("all") so sub-agents can still invoke + preload the project's skills.
          effort: EFFORT,
          // Keep Claude Code's tooling behavior, append the orchestrator role.
          systemPrompt: { type: "preset", preset: "claude_code", append: ORCHESTRATOR_PROMPT },
          canUseTool,
          abortController: abort,
          mcpServers: {
            ui: createSdkMcpServer({
              name: "ui",
              version: "0.1.0",
              tools: [
                makeFormTool(waitFor, formAgentQueue),
                makeTaskTool(send),
                makeAssetTool(send),
              ],
            }),
          },
        },
      });
      session.query = q;
      /** @type {Set<string>} */
      const bgSpawns = new Set(); // tool_use ids spawned with run_in_background
      /** @type {Map<string, string>} */
      const bgBoard = new Map(); // sdk task_id -> bridged board task id
      /** @type {Map<string, string>} */
      const runningByTask = new Map(); // sdk task_id -> subagent_type (in-flight sub-agents)
      for await (const message of q) {
        trackMessage(message, { agentByTool, bgSpawns, bgBoard, runningByTask, send });
        send({ type: "event", message });
      }
      send({ type: "status", text: "session ended" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      send({ type: "status", text: `session error: ${reason}` });
    }
  })();
}

/**
 * @param {import("ws").RawData} raw
 * @param {{ log: (dir: string, obj: OutMsg) => void, send: (obj: OutMsg) => void, inbox: ReturnType<typeof createInbox>, pending: Pending, session: { policy: string, query?: { interrupt?: () => Promise<void>, stopTask?: (taskId: string) => Promise<void> } } }} deps
 */
function handleClientMessage(raw, { log, send, inbox, pending, session }) {
  /** @type {ClientMsg} */
  let msg;
  try {
    msg = /** @type {ClientMsg} */ (parseJSON(raw));
  } catch {
    return;
  }
  log("in", msg);
  if (msg.type === "user_input") {
    // A new user turn — prune completed agent tasks so the board reflects live
    // work instead of accumulating a graveyard of done items across the session.
    const pruned = pruneDoneTasks();
    if (pruned) send({ type: "tasks", tasks: pruned });
    inbox.push({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "text", text: msg.text }] },
    });
  } else if (msg.type === "reply") {
    const entry = pending.get(msg.id);
    if (entry) {
      entry.resolve(msg.payload);
      pending.delete(msg.id);
    }
  } else if (msg.type === "policy" && POLICIES.includes(msg.value)) {
    session.policy = msg.value;
  } else if (msg.type === "task_update") {
    // User toggled a status or removed a task from the UI — mutate the store
    // and broadcast the new list back.
    send({ type: "tasks", tasks: applyOp(msg, new Date().toISOString()) });
  } else if (msg.type === "stop") {
    // Interrupt the current turn — stops in-flight sub-agents but keeps the
    // session alive for the next input.
    void session.query?.interrupt?.();
    send({ type: "status", text: "stopping the current turn — interrupting running agents…" });
  } else if (msg.type === "stop_task") {
    // Stop ONE backgrounded Xenodot by its task id; the hive turn and any other
    // background workers keep running. The SDK emits a task_notification:stopped.
    void session.query?.stopTask?.(msg.taskId);
    send({ type: "status", text: `stopping background agent ${msg.taskId}…` });
  }
}

/**
 * Settle every pending interaction so canUseTool / the form handler return and
 * the CLI can finish its turn — an unresolved promise here leaves an orphaned
 * process holding the session, and its transcript ends mid-tool_use (which
 * 400s any later resume). Then stop the session and close the log.
 * @param {{ inbox: ReturnType<typeof createInbox>, pending: Pending, abort: AbortController, endLog: () => void }} deps
 */
function handleClose({ inbox, pending, abort, endLog }) {
  inbox.close();
  for (const { type, resolve } of pending.values()) {
    resolve(type === "permission" ? { allow: false } : { cancelled: true });
  }
  pending.clear();
  abort.abort();
  endLog();
}

/** Wire up one browser connection as a Claude Code session.
 * @param {import("ws").WebSocket} ws @param {import("node:http").IncomingMessage} req */
export function handleConnection(ws, req) {
  const resumeId = new URL(req.url ?? "/", "http://localhost").searchParams.get("resume");
  const { log, send, end } = createLogger(ws);
  const inbox = createInbox();
  /** @type {Pending} */
  const pending = new Map();
  /** @type {{ policy: string, query?: { interrupt?: () => Promise<void>, stopTask?: (taskId: string) => Promise<void> } }} */
  const session = { policy: DEFAULT_POLICY };
  /** @type {Set<string>} */
  const sessionAllowed = new Set(); // tools approved with "Always" this session
  const abort = new AbortController(); // tears the CLI down on disconnect
  /** @type {Map<string, string>} */
  const agentByTool = new Map(); // tool_use id -> agent label (main | subagent_type)
  /** @type {string[]} */
  const formAgentQueue = []; // FIFO: agent label per pending mcp__ui__form call
  const waitFor = makeWaitFor(send, pending);
  const canUseTool = makeCanUseTool({
    session,
    sessionAllowed,
    waitFor,
    log,
    agentByTool,
    formAgentQueue,
  });

  runSession({
    resumeId,
    policy: session.policy,
    inbox,
    send,
    canUseTool,
    abort,
    waitFor,
    agentByTool,
    formAgentQueue,
    session,
  });

  ws.on("message", (raw) => {
    handleClientMessage(raw, { log, send, inbox, pending, session });
  });
  ws.on("close", () => {
    handleClose({ inbox, pending, abort, endLog: end });
  });
}
