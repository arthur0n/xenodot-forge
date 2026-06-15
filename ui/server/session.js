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
import { makeAskTool } from "./ask-tool.js";
import { makePromoteTool } from "./promote-tool.js";
import { readPromotions, decide } from "./promotions-store.js";
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
  ASK_TOOL,
  PROMOTE_TOOL,
  AUTO_ALLOW_TOOLS,
  MODEL,
  EFFORT,
  ORCHESTRATOR_PROMPT,
  POLICIES,
  PROJECT_DIR,
  FRAMEWORK_PLUGIN_DIR,
  ASSET_LIBRARY,
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
    if (toolName === ASK_TOOL) {
      // UI-control tool: files an async question on the board, never pauses —
      // auto-allow. Stamp the calling agent (`_by`) so the question owner is known.
      return { behavior: "allow", updatedInput: { ...input, _by: agent } };
    }
    if (toolName === PROMOTE_TOOL) {
      // UI-control tool: files a promotion request, never pauses — auto-allow.
      // Stamp the requesting agent (`_by`) for the record.
      return { behavior: "allow", updatedInput: { ...input, _by: agent } };
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

/** Surface an SDK headless/auto-deny to the browser. When a backgrounded
 * (headless) sub-agent calls a tool that needs an interactive decision, the SDK
 * can't reach our canUseTool approver and auto-denies — see SDKPermissionDeniedMessage,
 * decision_reason_type "asyncAgent". Without this it dies as a silent is_error
 * deep in a sub-agent transcript; here it becomes a visible activity-log row (and
 * a banner for background denials) so the friction is identifiable, not silent.
 * @param {import("@anthropic-ai/claude-agent-sdk").SDKPermissionDeniedMessage} message
 * @param {{ agentByTool: Map<string, string>, send: (obj: OutMsg) => void }} deps */
function surfaceDenial(message, { agentByTool, send }) {
  // A backgrounded worker's tool_use may not be in agentByTool (it runs detached,
  // so its assistant messages don't all cross the parent stream) — fall back to a
  // "background" label rather than mislabeling the denial as the orchestrator.
  const background = message.decision_reason_type === "asyncAgent";
  const agent = agentByTool.get(message.tool_use_id) ?? (background ? "background" : "main");
  send({
    type: "permission_denied",
    toolName: message.tool_name,
    agent,
    reason: message.decision_reason_type,
    background,
  });
}

/** Per-message bookkeeping on the SDK stream: track tool_use→agent, bridge
 * background workers onto the board, deterministically close each sub-agent's own
 * tasks when it finishes, surface auto-denials, and sweep stragglers at turn end.
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
  } else if (message.type === "system" && message.subtype === "permission_denied") {
    surfaceDenial(message, { agentByTool, send });
  } else if (message.type === "result") {
    sweepStragglers({ runningByTask, send });
  }
}

/** Session-teardown settle: when the SDK stream ends or errors (the whole CLI
 * subprocess — and thus every in-flight background worker — is gone), remove each
 * bridged background board task and close each still-running sub-agent's tasks, so
 * the board doesn't keep a dead worker as in_progress forever.
 * @param {{ bgBoard: Map<string, string>, runningByTask: Map<string, string>, send: (obj: OutMsg) => void }} deps */
function settleAllBackground({ bgBoard, runningByTask, send }) {
  for (const taskId of [...bgBoard.keys()]) {
    bridgeSettle({ taskId, status: "stopped" }, { bgBoard, send });
  }
  for (const taskId of [...runningByTask.keys()]) {
    settleAgentTasks(taskId, { runningByTask, send });
  }
}

/** Read the session's live context-window usage and push it to the UI meter.
 * Best-effort: getContextUsage is a streaming-mode control request and can throw
 * if the turn raced the session teardown — a missing meter update is harmless, so
 * swallow errors rather than killing the message loop.
 * @param {{ getContextUsage?: () => Promise<{ totalTokens: number, maxTokens: number, percentage: number }> }} q
 * @param {(obj: OutMsg) => void} send */
async function emitContextUsage(q, send) {
  try {
    const u = await q.getContextUsage?.();
    if (!u) return;
    send({
      type: "context",
      percentage: u.percentage,
      totalTokens: u.totalTokens,
      maxTokens: u.maxTokens,
    });
  } catch {
    // session ended or control request unsupported — skip this meter update
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
  /** @type {Set<string>} */
  const bgSpawns = new Set(); // tool_use ids spawned with run_in_background
  /** @type {Map<string, string>} */
  const bgBoard = new Map(); // sdk task_id -> bridged board task id
  /** @type {Map<string, string>} */
  const runningByTask = new Map(); // sdk task_id -> subagent_type (in-flight sub-agents)
  void (async () => {
    try {
      send({ type: "policy", value: policy });
      // Paint the persisted task board + promotions board immediately (fresh or resumed).
      send({ type: "tasks", tasks: readTasks() });
      send({ type: "promotions", items: readPromotions() });
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
          // The framework's agents/skills/hooks come from the plugin (single source
          // of truth), not from copies in the game — so the game folder stays pure.
          // Plugins load regardless of cwd. noMcp: the UI owns its MCP tools (below),
          // so don't wire the plugin's own MCP. Capabilities namespace as `xenodot:`.
          plugins: [{ type: "local", path: FRAMEWORK_PLUGIN_DIR, skipMcpDiscovery: true }],
          // The framework knowledge base (plugin/library) and skill/agent sources live
          // in the plugin, OUTSIDE the game cwd. Mount the plugin as an extra working
          // root so researcher agents can read it AND write new knowledge / promoted
          // capabilities back into the framework (the self-improvement loop). ASSET_LIBRARY
          // (the external shared-asset dir, mounted in the game as res://x-shared-assets) is
          // also outside cwd, so mount it too — asset-advisor reads/verifies sourced files
          // there and godot-dev imports them. All still gated by the permission policy + hooks.
          additionalDirectories: [FRAMEWORK_PLUGIN_DIR, ASSET_LIBRARY],
          // Pick up the game's CLAUDE.md + any game-local .claude/ (game-specific
          // agents/skills the user hasn't promoted to the framework yet).
          settingSources: ["user", "project", "local"],
          // Bare-name pre-approval for the read/research/exec toolset, so a
          // BACKGROUNDED (headless) sub-agent — which has no approver and so auto-denies
          // anything not pre-approved — can actually research. Argument-scoped settings
          // rules (Bash(**), Read(**)) do NOT reach headless sub-agents; only bare names
          // do (see config.js). Bash stays safe via the destructive-* PreToolUse hooks.
          allowedTools: AUTO_ALLOW_TOOLS,
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
                makeAskTool(send),
                makePromoteTool(send),
              ],
            }),
          },
        },
      });
      session.query = q;
      for await (const message of q) {
        trackMessage(message, { agentByTool, bgSpawns, bgBoard, runningByTask, send });
        send({ type: "event", message });
        // Turn ended — read the live context-window usage and push it to the UI's
        // session meter, so the user can see the orchestrator transcript growing and
        // compact/reset before it gets expensive (each turn re-reads the whole prefix).
        if (message.type === "result") void emitContextUsage(q, send);
      }
      send({ type: "status", text: "session ended" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      send({ type: "status", text: `session error: ${reason}` });
    } finally {
      // Every exit path lands here — normal end, an SDK error, or the iterator
      // ending early. The client clears `busy` and the running strip only on a
      // `result` event; an abnormal turn/session end never emits one, leaving the
      // UI stuck on "agent running". Settle dead background workers off the board,
      // then signal idle so the client clears busy + every chip.
      settleAllBackground({ bgBoard, runningByTask, send });
      send({ type: "idle" });
    }
  })();
}

/** Board mutations that simply mutate a store and rebroadcast: a task status/removal
 * (task_update) or a promotion approve/reject (promotion_decide). Split out of
 * handleClientMessage to keep its branch complexity in check. Returns true if handled.
 * @param {ClientMsg} msg @param {(obj: OutMsg) => void} send @returns {boolean} */
function handleBoardMessage(msg, send) {
  if (msg.type === "task_update") {
    send({ type: "tasks", tasks: applyOp(msg, new Date().toISOString()) });
    return true;
  }
  if (msg.type === "promotion_decide") {
    send({ type: "promotions", items: decide(msg.id, msg.decision, new Date().toISOString()) });
    return true;
  }
  return false;
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
  } else if (handleBoardMessage(msg, send)) {
    // A board mutation (task status/removal, or a promotion approve/reject) —
    // handled and rebroadcast inside the helper.
  } else {
    handleControlMessage(msg, { send, inbox, session });
  }
}

/** Session-control messages: compact (trim transcript in place), stop (interrupt
 * the turn), stop_task (kill one background worker). Split out of handleClientMessage
 * to keep its branch complexity in check.
 * @param {ClientMsg} msg
 * @param {{ send: (obj: OutMsg) => void, inbox: ReturnType<typeof createInbox>, session: { query?: { interrupt?: () => Promise<void>, stopTask?: (taskId: string) => Promise<void> } } }} deps */
function handleControlMessage(msg, { send, inbox, session }) {
  if (msg.type === "compact") {
    // Trim the orchestrator's transcript in place: push the /compact slash command
    // as a user turn (the SDK processes slash commands). This summarizes history and
    // sheds the bulk while keeping the SAME session alive — plugin, skills, warm
    // cache and the task board all survive (unlike "+ new", a full cold restart).
    inbox.push({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "text", text: "/compact" }] },
    });
    send({
      type: "status",
      text: "compacting the session — trimming transcript, keeping context…",
    });
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
