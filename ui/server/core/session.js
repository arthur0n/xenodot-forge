// One WebSocket connection == one Claude Code session. The old ~140-line
// connection handler is decomposed here into small single-purpose helpers
// (logger, inbox, waitFor, canUseTool, run, client-message, close) so each
// stays well under the complexity/size limits.
import { existsSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseJSON } from "../../lib/json.js";
import { sessionHistory } from "../features/transcripts/transcripts.js";
import { buildUiServer } from "../mcp-tools/ui-server.js";
import { uiControlAllow } from "./ui-control.js";
import { runningChip, emitRunning, runWithRetry } from "./stream.js";
import {
  bridgeStart,
  bridgeSettle,
  settleAgentTasks,
  sweepStragglers,
  settleAllBackground,
  sweepStaleAgents,
} from "./agent-settle.js";
import { getLive } from "./registry.js";
import {
  createLogger,
  createInbox,
  makeWaitFor,
  buildSessionHooks,
  teardown,
  evaluateGrace,
  flushBuffer,
  replayPending,
  onSocketDetach,
} from "./connection.js";
import { readPromotions, decide, markPromoted } from "../features/promotions/promotions-store.js";
import { promoteOne } from "../features/promotions/promote-run.js";
import { readAutonomous } from "../features/autonomous/autonomous-store.js";
import {
  handleAutonomousControl,
  makeCheckLoop,
} from "../features/autonomous/autonomous-control.js";
import { applyOp, pruneDoneTasks, findOpenQuestion } from "../features/tasks/tasks-store.js";
import { resolveSessionSkills } from "../features/skills/skills.js";
import {
  DEFAULT_POLICY,
  EDIT_TOOLS,
  FORM_TOOL,
  AUTO_ALLOW_TOOLS,
  MODEL,
  EFFORT,
  ORCHESTRATOR_PROMPT,
  HERMES_BLOCK,
  CODEX_BLOCK,
  DOCS_BLOCK,
  getHermesConfig,
  POLICIES,
  PROJECT_DIR,
  FRAMEWORK_PLUGIN_DIR,
  CODEX_PLUGIN_DIR,
  getCodexConfig,
  getDocsConfig,
  DOCS_MCP_ENTRY,
  ASSET_LIBRARY,
} from "./config.js";

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("../../lib/types.js").Reply} Reply */
/** @typedef {import("../../lib/types.js").ClientMsg} ClientMsg */
/** @typedef {import("../../lib/types.js").WaitFor} WaitFor */
/** @typedef {import("../../lib/types.js").Task} Task */
/** @typedef {import("../../lib/types.js").RunningAgentWire} RunningChip */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */
/** @typedef {import("./connection.js").Pending} Pending */
/** @typedef {import("./connection.js").Conn} Conn */
/** @typedef {import("./connection.js").Inbox} Inbox */
/** @typedef {import("./connection.js").LiveSession} LiveSession */
/** Per-connection mutable session state, shared between runSession and the client-message
 * handlers. `autonomousLoop` is set by runSession once the check loop is built.
 * @typedef {{ policy: string, query?: { interrupt?: () => Promise<void>, stopTask?: (taskId: string) => Promise<void> }, autonomousLoop?: { arm: (fireNow?: boolean) => void, disarm: () => void }, autonomousActive?: boolean }} SessionState */

/** One-channel guard for inline asks: if any question in an `AskUserQuestion` call
 * matches an already-open board question (filed via `mcp__ui__ask`), return a deny
 * result pointing at it; else null. Stops a second, divergent record (t224/t140).
 * Exported for tests (session.test.js), like makeCanUseTool/trackMessage below.
 * @param {unknown} input @returns {{ behavior: "deny", message: string } | null} */
export function denyIfQuestionOpen(input) {
  if (!input || typeof input !== "object") return null;
  const raw = /** @type {{ questions?: unknown }} */ (input).questions;
  const questions = /** @type {Array<{ question?: unknown }>} */ (Array.isArray(raw) ? raw : []);
  for (const q of questions) {
    const text = q && typeof q.question === "string" ? q.question : "";
    const open = text ? findOpenQuestion(text) : undefined;
    if (open) {
      return {
        behavior: /** @type {const} */ ("deny"),
        message:
          `A question on this decision is already open on the board (${open.id}: "${open.title}"). ` +
          "Don't ask inline — its answer will arrive as a turn. Wait for it, or act on your best judgment.",
      };
    }
  }
  return null;
}

/** Handle an inline `AskUserQuestion`: deny it when the decision is already open on
 * the board (one-channel guard), otherwise pause for the user's pick. Extracted so
 * makeCanUseTool's arrow stays under the complexity cap. @param {unknown} input
 * @param {string} agent @param {WaitFor} waitFor */
async function handleAskQuestion(input, agent, waitFor) {
  const denied = denyIfQuestionOpen(input);
  if (denied) return denied;
  const answers = await waitFor("ask", { input, agent });
  const base = /** @type {Record<string, unknown>} */ (input);
  return { behavior: /** @type {const} */ ("allow"), updatedInput: { ...base, ...answers } };
}

/**
 * @param {{ session: SessionState, sessionAllowed: Set<string>, waitFor: WaitFor, log: (dir: string, obj: OutMsg) => void, agentByTool: Map<string, string>, formAgentQueue: string[] }} deps
 * @returns {import("@anthropic-ai/claude-agent-sdk").CanUseTool}
 */
export function makeCanUseTool({
  session,
  sessionAllowed,
  waitFor,
  log,
  agentByTool,
  formAgentQueue,
}) {
  return async (toolName, input, opts) => {
    // Which agent raised this call (main loop or a sub-agent), so the UI can
    // label concurrent approvals. opts.toolUseID is set by the SDK.
    const agent = agentByTool.get(opts.toolUseID) ?? "main";
    if (toolName === "AskUserQuestion") return handleAskQuestion(input, agent, waitFor);
    if (toolName === FORM_TOOL) {
      // The tool handler does the waiting; hand it this call's agent (FIFO,
      // since canUseTool and the handler run 1:1 and order-aligned per tool).
      // Forms come only from FOREGROUND interview agents — backgrounded
      // (autonomous) Xenodots never call mcp__ui__form (orchestrator rule), so
      // no two forms overlap and the FIFO stays 1:1 even with a worker in flight.
      formAgentQueue.push(agent);
      return { behavior: "allow", updatedInput: input };
    }
    // UI-control tools (tasks/ask/promote/asset/autonomous): auto-allow, never pause.
    const uiAllow = uiControlAllow(toolName, input, agent);
    if (uiAllow) return uiAllow;
    if (session.autonomousActive) {
      // hive self-drives — auto-allow all tools
      log("auto", { type: "permission", toolName, policy: "autonomous" });
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
 * `lastSeen` tracks each agent's last sign of life so sweepStaleAgents can retire a finished one whose task_notification never arrived.
 * @param {import("@anthropic-ai/claude-agent-sdk").SDKMessage} message
 * @param {{ agentByTool: Map<string, string>, bgSpawns: Set<string>, bgBoard: Map<string, string>, runningByTask: Map<string, RunningChip>, lastSeen: Map<string, number>, send: (obj: OutMsg) => void }} deps
 */
export function trackMessage(
  message,
  { agentByTool, bgSpawns, bgBoard, runningByTask, lastSeen, send },
) {
  if (message.type === "assistant") {
    trackToolUses(message, { agentByTool, bgSpawns });
  } else if (message.type === "system" && message.subtype === "task_started") {
    // Record this sub-agent as live (label + display fields): settleAgentTasks closes its
    // tasks on notification, and the running snapshot carries it to the strip.
    if (message.task_id) {
      runningByTask.set(message.task_id, runningChip(message, bgSpawns));
      lastSeen.set(message.task_id, Date.now());
      emitRunning(runningByTask, send);
    }
    bridgeStart(
      { taskId: message.task_id, toolUseId: message.tool_use_id, desc: message.description },
      { bgSpawns, bgBoard, send },
    );
  } else if (message.type === "system" && message.subtype === "task_progress") {
    // A live sub-agent's heartbeat — bump liveness so the sweep never culls a working agent.
    if (message.task_id) lastSeen.set(message.task_id, Date.now());
  } else if (message.type === "system" && message.subtype === "task_notification") {
    bridgeSettle({ taskId: message.task_id, status: message.status }, { bgBoard, send });
    settleAgentTasks(message.task_id, { runningByTask, send });
    if (message.task_id) lastSeen.delete(message.task_id);
    emitRunning(runningByTask, send);
  } else if (message.type === "system" && message.subtype === "permission_denied") {
    surfaceDenial(message, { agentByTool, send });
  } else if (message.type === "result") {
    sweepStragglers({ runningByTask, send });
  }
}

/** Build the SDK query factory for a session: `makeQuery(resume)` returns a streaming query that
 * runWithRetry rebuilds each 529-retry with the live session id (resuming the SAME conversation;
 * options are identical across attempts). Extracted from runSession to keep it under its line cap.
 * @param {{ inbox: Inbox, canUseTool: import("@anthropic-ai/claude-agent-sdk").CanUseTool, abort: AbortController, waitFor: WaitFor, formAgentQueue: string[], send: (obj: OutMsg) => void, checkLoop: { disarm: () => void } }} deps
 * @returns {(resume: string | null) => ReturnType<typeof query>} */
function buildMakeQuery({ inbox, canUseTool, abort, waitFor, formAgentQueue, send, checkLoop }) {
  // The OPTIONAL Codex reviewer is a SECOND local plugin (OpenAI's `codex-plugin-cc`, vendored
  // on disk), appended ONLY when the user enabled it AND it's actually been cloned — a
  // disabled/absent Codex changes nothing. Gating is array inclusion (the SDK has no per-plugin
  // enable flag, and `plugins` only accepts `{ type: "local" }`). Extracted to a typed const so
  // the options object below stays readable.
  /** @type {import("@anthropic-ai/claude-agent-sdk").SdkPluginConfig[]} */
  const codexPlugin =
    getCodexConfig().enabled && existsSync(CODEX_PLUGIN_DIR)
      ? [{ type: "local", path: CODEX_PLUGIN_DIR, skipMcpDiscovery: true }]
      : [];
  /** @param {string | null} resume */
  return (resume) =>
    query({
      prompt: inbox.iterable,
      options: {
        ...(resume ? { resume } : {}),
        // Every agent — orchestrator and all sub-agents, foreground or background — runs in this
        // one working tree. No per-agent git-worktree isolation, BY DESIGN: faster and simpler.
        // The trade-off: concurrent builders editing overlapping/adjacent files can race (one's
        // half-applied edit fails the other's godot-verify, or clobbers its writes). We accept that
        // residual and mitigate it in the orchestrator's dispatch rules (orchestrator.md →
        // "Concurrent builders share one working tree"), not with isolation here.
        cwd: PROJECT_DIR,
        // The framework's agents/skills/hooks come from the plugin (single source of truth), not
        // from copies in the game — so the game folder stays pure. Plugins load regardless of cwd.
        // The xenodot spine is always loaded; the Codex reviewer (codexPlugin) is appended only
        // when enabled. skipMcpDiscovery: the UI owns its MCP tools (below). Its slash commands
        // (`/codex:review`) expand from the user's prompt; `codex:codex-rescue` becomes delegable.
        plugins: [
          { type: "local", path: FRAMEWORK_PLUGIN_DIR, skipMcpDiscovery: true },
          ...codexPlugin,
        ],
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
        // own `effort:` frontmatter while active.
        effort: EFFORT,
        // Skill index = a tight allowlist (resolveSessionSkills): the framework meta floor
        // (caveman, autonomous-main-goal, graphify) + the built-ins the user enabled via the skill wizard
        // (skillOverrides). DOMAIN skills are excluded — both the framework `godot-*` skills
        // and the game's own `.claude/skills` — because the orchestrator only routes; those
        // belong to the implementer agents. A context filter, not a sandbox: unlisted skills
        // stay on disk and remain loadable by the agents that list them.
        skills: resolveSessionSkills(),
        // Keep Claude Code's tooling behavior, append the orchestrator role.
        // Hermes and Codex blocks are injected only when those integrations are active,
        // so the orchestrator's routing instructions match the actual team each session.
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            ORCHESTRATOR_PROMPT +
            (getHermesConfig().enabled ? "\n\n" + HERMES_BLOCK : "") +
            (getCodexConfig().enabled && existsSync(CODEX_PLUGIN_DIR) ? "\n\n" + CODEX_BLOCK : "") +
            (getDocsConfig().enabled && DOCS_MCP_ENTRY ? "\n\n" + DOCS_BLOCK : ""),
        },
        canUseTool,
        abortController: abort,
        mcpServers: {
          ui: buildUiServer({
            waitFor,
            formAgentQueue,
            send,
            hermesPush: inbox.push,
            compactPush: inbox.push,
            disarm: checkLoop.disarm,
          }),
          // Godot docs as a source of truth — the official-docs MCP, mounted only when the
          // user enabled it (Settings toggle / DOCS_ENABLED / .xenodot.json `docs` block) AND
          // the bundled package resolved. Launched as the compiled esm/ build via node (its bin
          // is broken — see DOCS_MCP_ENTRY); surfaces as mcp__godot-docs__*.
          ...(getDocsConfig().enabled && DOCS_MCP_ENTRY
            ? { "godot-docs": { type: "stdio", command: "node", args: [DOCS_MCP_ENTRY] } }
            : {}),
        },
      },
    });
}

/**
 * Drive the Claude Code session and stream its messages to the browser.
 * @param {{ resumeId: string | null, inbox: Inbox, send: (obj: OutMsg) => void, canUseTool: import("@anthropic-ai/claude-agent-sdk").CanUseTool, abort: AbortController, waitFor: WaitFor, agentByTool: Map<string, string>, formAgentQueue: string[], session: SessionState, ls: LiveSession }} deps
 */
function runSession({
  resumeId,
  inbox,
  send,
  canUseTool,
  abort,
  waitFor,
  agentByTool,
  formAgentQueue,
  session,
  ls,
}) {
  /** @type {Set<string>} */
  const bgSpawns = new Set(); // tool_use ids spawned with run_in_background
  /** @type {Map<string, string>} */
  const bgBoard = new Map(); // sdk task_id -> bridged board task id
  /** @type {Map<string, RunningChip>} */
  const runningByTask = new Map(); // sdk task_id -> live sub-agent chip (authoritative running set)
  /** @type {Map<string, number>} */
  const lastSeen = new Map(); // sdk task_id -> ms of its last task_started/progress (liveness)
  // `busy.value` lets the check loop skip ticks mid-turn; stash loop on session so the control
  // handler + autonomous tool can arm/disarm it. Shared with `ls` so the detach grace policy
  // (evaluateGrace) can tell "working" from "idle".
  const busy = ls.busy;
  const checkLoop = makeCheckLoop({ push: inbox.push, send, isBusy: () => busy.value });
  session.autonomousLoop = checkLoop;
  // The reconnect hooks (connection.js): resync re-emits snapshots, onSessionId registers this
  // session for re-attach + announces its id, onBusyChange drives the detach grace at turn
  // boundaries. Sets ls.resync so a re-attaching client can rebuild its view.
  const { resync, onSessionId, onBusyChange } = buildSessionHooks({
    ls,
    send,
    session,
    runningByTask,
  });
  // Liveness backstop: every 30s retire any agent silent past the stale window (finished, but
  // its task_notification never arrived). Cleared in the finally so the timer can't leak.
  const sweepTimer = setInterval(() => {
    sweepStaleAgents({ bgBoard, runningByTask, lastSeen, send });
  }, 30_000);
  void (async () => {
    try {
      resync();
      // fireNow=true on resume: first interval tick is 5 min away
      const autoState = readAutonomous();
      checkLoop.arm((session.autonomousActive = autoState.active));
      if (resumeId) {
        send({ type: "history", items: sessionHistory(resumeId) });
        send({ type: "status", text: `resumed session ${resumeId.slice(0, 8)}…` });
      } else {
        send({ type: "status", text: `session starting in ${PROJECT_DIR}` });
      }
      // The query factory — rebuilt per 529-retry with the live session id (see buildMakeQuery).
      const makeQuery = buildMakeQuery({
        inbox,
        canUseTool,
        abort,
        waitFor,
        formAgentQueue,
        send,
        checkLoop,
      });
      // Stream the session, auto-retrying a sustained API 529 every 5 min (resume, self-
      // stopping) instead of dying on the first overload. runWithRetry owns session.query
      // and the "session ended"/"resumed after overload" status; non-overload errors
      // propagate to the catch below.
      await runWithRetry({
        makeQuery,
        trackMessage,
        trackDeps: { agentByTool, bgSpawns, bgBoard, runningByTask, lastSeen, send },
        send,
        abort,
        busy,
        session,
        inbox,
        resumeId,
        onSessionId,
        onBusyChange,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      send({ type: "status", text: `session error: ${reason}` });
    } finally {
      // Every exit path lands here — normal end, SDK error, or early iterator end. The
      // client clears `busy`/the running strip only on a `result`; an abnormal end emits
      // none, so settle dead background workers and signal idle to unstick the UI.
      clearInterval(sweepTimer);
      settleAllBackground({ bgBoard, runningByTask, send });
      send({ type: "idle" });
      // The stream is over for good (it only ends via abort/inbox-close at teardown, or an SDK
      // error). Tear down — drops it from the registry so a reconnect disk-resumes, not re-attaches
      // to a dead session. Idempotent: a disconnect-driven teardown already ran the grace timer.
      teardown(ls);
    }
  })();
}

/** Execute an approved promotion: move the capability game→plugin and mark it
 * promoted, all server-side, so the user's one click on the board IS the
 * deliberate promotion (no orchestrator round-trip, no raw shell). A skip
 * (already in the plugin, source missing) leaves the entry approved and reports
 * why. @param {string} id @param {(obj: OutMsg) => void} send */
function runPromotion(id, send) {
  const entry = readPromotions().find((p) => p.id === id && p.status === "approved");
  if (!entry) {
    send({ type: "promotions", items: readPromotions() });
    return;
  }
  const result = promoteOne(entry.kind, entry.name, PROJECT_DIR);
  const items = result.ok ? markPromoted(id, new Date().toISOString()) : readPromotions();
  send({ type: "promotions", items });
  send({
    type: "status",
    text: result.ok
      ? `Promoted ${entry.kind.replace(/s$/, "")} "${entry.name}" → framework plugin. Start a new session to load it as xenodot:${entry.name.replace(/\.md$/, "")}.`
      : `Couldn't promote "${entry.name}": ${result.msg}`,
  });
}

/** The synthetic user turn that pushes a freshly answered async question back to
 * the orchestrator the moment the user replies — so the answer is delivered, not
 * polled (kills the "answered question left unread" stall). Same shape as a real
 * user message / Hermes findingsTurn. @param {Task} task @returns {SDKUserMessage} */
function answerTurn(task) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `[User answered question ${task.id} — "${task.title}"]\n\nAnswer: ${task.answer}\n\n` +
            "Act on this now: relay/apply it and move dependent work. (Already marked done on the board.)",
        },
      ],
    },
  };
}

/** Board mutations that simply mutate a store and rebroadcast: a task status/removal
 * (task_update), a promotion approve/reject (promotion_decide), or running an
 * approved promotion (promotion_run). Split out of handleClientMessage to keep its
 * branch complexity in check. Returns true if handled.
 * @param {ClientMsg} msg @param {(obj: OutMsg) => void} send
 * @param {Inbox} inbox @returns {boolean} */
function handleBoardMessage(msg, send, inbox) {
  if (msg.type === "task_update") {
    const list = applyOp(msg, new Date().toISOString());
    send({ type: "tasks", tasks: list });
    // Push the answer to the orchestrator instead of relying on it to scan the
    // board. Only on an actual answer submission, and only for async questions,
    // so status toggles / removals / re-clicks don't spawn spurious turns.
    if (msg.answer != null) {
      const task = list.find((t) => t.id === msg.id);
      if (task?.kind === "question") inbox.push(answerTurn(task));
    }
    return true;
  }
  if (msg.type === "promotion_decide") {
    send({ type: "promotions", items: decide(msg.id, msg.decision, new Date().toISOString()) });
    return true;
  }
  if (msg.type === "promotion_run") {
    runPromotion(msg.id, send);
    return true;
  }
  return false;
}

/**
 * @param {import("ws").RawData} raw
 * @param {{ log: (dir: string, obj: OutMsg) => void, send: (obj: OutMsg) => void, inbox: Inbox, pending: Pending, session: { policy: string, query?: { interrupt?: () => Promise<void>, stopTask?: (taskId: string) => Promise<void> } } }} deps
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
  } else if (handleBoardMessage(msg, send, inbox)) {
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
 * @param {{ send: (obj: OutMsg) => void, inbox: Inbox, session: SessionState }} deps */
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
  } else if (session.autonomousLoop) {
    // Toggle the standing Main Goal (start/stop) — persists, broadcasts the flag, pushes
    // the kickoff turn, and arms/disarms the 5-minute check loop. No-op for any other msg.
    if (handleAutonomousControl(msg, { send, push: inbox.push, loop: session.autonomousLoop }))
      session.autonomousActive = /** @type {{ action: string }} */ (msg).action === "start";
  }
}

/** Wire a socket's message + close handlers to a live session. The lifecycle helpers
 * (onSocketDetach / evaluateGrace / teardown / buffer flush) live in connection.js — bindSocket and
 * reattach stay here because they call handleClientMessage (same module).
 * @param {import("ws").WebSocket} ws @param {LiveSession} ls */
function bindSocket(ws, ls) {
  ws.on("message", (raw) => {
    handleClientMessage(raw, {
      log: ls.log,
      send: ls.send,
      inbox: ls.inbox,
      pending: ls.pending,
      session: ls.session,
    });
  });
  ws.on("close", () => {
    onSocketDetach(ws, ls);
  });
}

/** Re-bind a reconnecting browser to its still-running session: steal from any stale socket, swap
 * in the new one, cancel the grace timer, flush the detached buffer, then re-sync snapshots and
 * replay open approval cards — so the running sub-agents continue uninterrupted and a fully reloaded
 * page rebuilds its view. No second query is started. @param {LiveSession} ls @param {import("ws").WebSocket} ws */
function reattach(ls, ws) {
  const old = ls.conn.socket;
  if (old && old !== ws && old.readyState === old.OPEN) old.close(4000, "session re-attached");
  ls.conn.socket = ws;
  bindSocket(ws, ls);
  evaluateGrace(ls); // attached now → cancels any pending teardown
  ls.send({ type: "session", id: ls.id }); // (re)assert the client's reconnect key
  flushBuffer(ls);
  ls.resync();
  replayPending(ls);
  console.log(`[${ls.id ?? "pre-id"}] reattach — re-bound to live session`);
}

/** Wire up one browser connection. If it presents a `?resume=<id>` for a session still LIVE in the
 * registry (brief disconnect / phone wake / refresh within the grace window), re-attach to it — the
 * sub-agents never died. Otherwise build a fresh session (disk-resume when `?resume` is set but the
 * session is gone: grace expired or server restarted).
 * @param {import("ws").WebSocket} ws @param {import("node:http").IncomingMessage} req */
export function handleConnection(ws, req) {
  const resumeId = new URL(req.url ?? "/", "http://localhost").searchParams.get("resume");

  const existing = getLive(resumeId);
  if (existing) {
    reattach(existing, ws);
    return;
  }

  /** @type {Conn} */
  const conn = { socket: ws, buffer: [] };
  const { log, send, end } = createLogger(conn);
  const inbox = createInbox();
  /** @type {Pending} */
  const pending = new Map();
  /** @type {SessionState} */
  const session = { policy: DEFAULT_POLICY };
  /** @type {Set<string>} */
  const sessionAllowed = new Set(); // tools approved with "Always" this session
  const abort = new AbortController(); // tears the CLI down at teardown (NOT on a mere disconnect)
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

  /** @type {LiveSession} */
  const ls = {
    id: resumeId,
    conn,
    inbox,
    pending,
    abort,
    session,
    busy: { value: false },
    send,
    log,
    endLog: end,
    graceTimer: null,
    announced: false,
    done: false,
    resync: () => {}, // replaced by runSession once its authoritative snapshots exist
  };

  bindSocket(ws, ls);
  runSession({
    resumeId,
    inbox,
    send,
    canUseTool,
    abort,
    waitFor,
    agentByTool,
    formAgentQueue,
    session,
    ls,
  });
}
