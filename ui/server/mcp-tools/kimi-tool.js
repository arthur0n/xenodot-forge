// Kimi tool: the ONE bridge from the Xenodot Hive to the external Kimi coder — kimi-cli
// driven over ACP (Agent Client Protocol, JSON-RPC/stdio; see integrations/acp/acp-client.js).
// Only the Hive calls it, and like mcp__ui__hermes it has NO auto-allow branch in canUseTool,
// so every dispatch passes the per-call permission gate.
//
// FIRE-AND-FORGET, IN-ECOSYSTEM, ISOLATED:
//   • The tool opens an ACP session in a FRESH git worktree of the game repo
//     (.xenodot-run/kimi/<runId>) and returns immediately; Kimi codes in the background.
//   • Progress (tool calls, plan updates) streams to the activity feed as extAgent rows.
//   • Kimi's ACP permission requests land on the SAME waitFor("permission") gate as every
//     other agent — inline approval cards with a kimi chip. Nothing silent.
//   • On completion the worktree DIFF is pushed into the session inbox as a synthetic user
//     turn (exactly like Hermes findings) and the board task closes. Kimi NEVER touches the
//     Hive's working tree — merging the diff is a separate human/Hive-gated step.
//   • Interrupt: removing Kimi's board task cancels the run (see cancelKimiBoardTask,
//     called from session.js), and a wall-clock cap stops runaways.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getKimiConfig, PROJECT_DIR } from "../core/config.js";
import { applyOp } from "../features/tasks/tasks-store.js";
import { startAcpClient, ACP_PROTOCOL_VERSION } from "../integrations/acp/acp-client.js";
import {
  createKimiWorktree,
  worktreeDiff,
  reapKimiWorktree,
} from "../integrations/kimi/kimi-worktree.js";

/** @typedef {(obj: import("../../lib/types.js").OutMsg) => void} Send */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */
/** @typedef {(msg: SDKUserMessage) => void} Push */
/** @typedef {import("../../lib/types.js").WaitFor} WaitFor */

/** A tool text result, in the shape the agent SDK expects. @param {string} text */
const ok = (text) => ({ content: [{ type: /** @type {const} */ ("text"), text }] });

/** Feed pill color for Kimi rows (Moonshot teal — distinct from Hermes indigo). */
const KIMI_COLOR = "#10b981";
/** Opening the ACP session (spawn + initialize + session/new) is interactive-fast. */
const OPEN_TIMEOUT_MS = 30_000;
/** One coding run's wall-clock cap — longer than Hermes research (code + verify loops),
 * never unbounded. */
const RUN_WALLCLOCK_MS = 20 * 60_000;

/** Push a Kimi activity line to the UI feed (the generic external-agent channel).
 * @param {Send} send @param {"start" | "progress" | "done"} phase @param {string} text
 * @param {string} [runId] */
function relay(send, phase, text, runId) {
  send({ type: "extAgent", agentId: "kimi", label: "Kimi", color: KIMI_COLOR, phase, runId, text });
}

/** Live runs by BOARD task id, so removing the board task cancels the run.
 * @type {Map<string, { cancel: (reason: string) => void }>} */
const liveRuns = new Map();

/** Cancel the Kimi run tied to a board task (no-op for any other task id) — the
 * user-facing interrupt: delete the board task, the run dies. Called from session.js.
 * @param {string} boardTaskId @returns {boolean} whether a run was cancelled */
export function cancelKimiBoardTask(boardTaskId) {
  const run = liveRuns.get(boardTaskId);
  if (!run) return false;
  run.cancel("cancelled from the board");
  return true;
}

/** Compose the ACP prompt: role brief + rules + the Hive's task. The coder works an
 * isolated worktree (diff = deliverable); the reviewer reads the live tree and its FINAL
 * message is the deliverable (it cannot edit — see answerPermission's read-only guard).
 * @param {"coder" | "reviewer"} role @param {string} task @param {string} [context] */
function buildPrompt(role, task, context) {
  const brief =
    role === "reviewer"
      ? "You are Kimi, reviewing code for the Xenodot Hive on a Godot-family game project. " +
        "Review the work described below (run `git diff`/read files as needed) for correctness, " +
        "simplicity and Godot idiom. You are READ-ONLY: do NOT edit, create or delete any file — " +
        "edit attempts will be denied. Your FINAL message IS your entire deliverable: a concrete, " +
        "file:line-referenced findings list (or a clean bill of health). Work to a conclusion, then stop."
      : "You are Kimi, an autonomous coder working for the Xenodot Hive on a Godot-family game " +
        "project. You are checked out in an ISOLATED git worktree — this directory is yours alone. " +
        "Make the change described below: edit files, run what you need to verify, and stop when " +
        "the change is complete and coherent. Do NOT commit, push, merge, or touch anything outside " +
        "this worktree; your working-tree diff IS the deliverable (the team reviews and merges it " +
        "separately). Keep the diff minimal and focused on the task.";
  return (
    brief +
    `\n\n--- Task ---\n${task}` +
    (context?.trim() ? `\n\n--- Context ---\n${context.trim()}` : "")
  );
}

/** Map one ACP session/update notification to a short feed line, or null to skip (message/
 * thought token chunks are too chatty for pills — the diff is the deliverable).
 * @param {unknown} params @returns {string | null} */
function progressLine(params) {
  const update = /** @type {{ update?: Record<string, unknown> }} */ (params)?.update;
  if (!update || typeof update !== "object") return null;
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (kind === "tool_call" || kind === "tool_call_update") {
    const title = typeof update.title === "string" ? update.title : "";
    const status = typeof update.status === "string" ? ` (${update.status})` : "";
    return title ? `· ${title}${status}`.slice(0, 240) : null;
  }
  if (kind === "plan") {
    const entries = Array.isArray(update.entries) ? update.entries.length : 0;
    return entries ? `plan: ${entries} step(s)` : null;
  }
  return null;
}

/** ACP tool-call kinds a READ-ONLY (reviewer) run must never approve. */
const MUTATING_KINDS = new Set(["edit", "delete", "move"]);

/** One ACP permission option. @typedef {{ optionId?: string, kind?: string }} AcpOption */

/** The ACP permission outcome for a picked option (or a cancel when none matches).
 * @param {AcpOption[]} options @param {string[]} preferredKinds ordered preference */
function pickOutcome(options, preferredKinds) {
  const optionId = preferredKinds
    .map((k) => options.find((o) => o.kind === k))
    .find(Boolean)?.optionId;
  return optionId
    ? { outcome: { outcome: "selected", optionId } }
    : { outcome: { outcome: "cancelled" } };
}

/** The Reply → ACP option-kind preference order. @param {boolean} allow @param {boolean} always */
function preferenceOrder(allow, always) {
  if (!allow) return ["reject_once", "reject_always"];
  return always ? ["allow_always", "allow_once"] : ["allow_once", "allow_always"];
}

/** Answer an ACP `session/request_permission` through the session's ONE permission gate, so
 * Kimi's approvals render as the same inline cards as every other agent (kimi-chipped).
 * In read-only mode, mutating tool kinds are auto-denied without prompting.
 * @param {unknown} params @param {WaitFor} waitFor @param {boolean} readOnly
 * @returns {Promise<unknown>} */
async function answerPermission(params, waitFor, readOnly) {
  const p =
    /** @type {{ toolCall?: { title?: string, kind?: string, rawInput?: unknown }, options?: AcpOption[] }} */ (
      params ?? {}
    );
  const options = p.options ?? [];
  const toolName = p.toolCall?.title ?? p.toolCall?.kind ?? "kimi action";
  if (readOnly && MUTATING_KINDS.has(p.toolCall?.kind ?? "")) {
    return pickOutcome(options, ["reject_once", "reject_always"]);
  }
  const raw = p.toolCall?.rawInput;
  const input = /** @type {import("../../lib/types.js").ToolInput} */ (
    typeof raw === "object" && raw !== null ? raw : { description: toolName }
  );
  const { allow, always } = await waitFor("permission", { toolName, input, agent: "kimi" });
  return pickOutcome(options, preferenceOrder(Boolean(allow), Boolean(always)));
}

/** The synthetic user turn that delivers Kimi's diff back to the Hive.
 * @param {string} runId @param {string} worktreeDir @param {string} diff @returns {SDKUserMessage} */
function diffTurn(runId, worktreeDir, diff) {
  const body = diff.trim()
    ? `\`\`\`diff\n${diff}\n\`\`\``
    : "(empty diff — Kimi finished without changing any file)";
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `[Kimi — coding run ${runId} finished. Worktree: ${worktreeDir}]\n\n${body}\n\n` +
            "Review this diff with the user. Merging it into the game is a SEPARATE, human-gated " +
            "step (cherry-pick/merge from the worktree branch, or apply the diff) — never auto-merge.",
        },
      ],
    },
  };
}

/** The synthetic user turn that delivers Kimi's review findings back to the Hive.
 * @param {string} runId @param {string} findings @returns {SDKUserMessage} */
function reviewTurn(runId, findings) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `[Kimi — review run ${runId} finished]\n\n` +
            (findings.trim() || "(Kimi returned no findings text)") +
            "\n\nKimi's review is advisory — weigh each finding, apply what holds, discard what doesn't.",
        },
      ],
    },
  };
}

/** The synthetic user turn for a run that did NOT deliver. @param {string} runId
 * @param {string} reason @returns {SDKUserMessage} */
function failTurn(runId, reason) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `[Kimi — coding run ${runId} did NOT deliver: ${reason}]\n\n` +
            "Treat this as no Kimi result. Do the task with a xenodot builder instead, or retry.",
        },
      ],
    },
  };
}

/** Everything one live run needs to settle exactly once (deliver / fail / cancel).
 * `dir` is null for a reviewer run (no worktree — it reads the live tree); `getText`
 * returns the accumulated agent message (the reviewer's deliverable).
 * @typedef {{ runId: string, role: "coder" | "reviewer", boardId: string | null,
 *   dir: string | null, getText: () => string, send: Send, push: Push }} RunCtx */

/** Close out a run: relay the terminal pill, push the delivery/fallback turn, close the
 * board task, and unregister the interrupt hook. Idempotent via the `settled` latch.
 * @param {RunCtx} ctx */
function makeSettle(ctx) {
  let settled = false;
  return (/** @type {"delivered" | "failed"} */ kind, /** @type {string} */ detail) => {
    if (settled) return;
    settled = true;
    if (ctx.boardId) {
      liveRuns.delete(ctx.boardId);
      try {
        ctx.send({
          type: "tasks",
          tasks: applyOp(
            { op: "update", id: ctx.boardId, status: "done" },
            new Date().toISOString(),
          ),
        });
      } catch {
        /* board write failed — non-fatal */
      }
    }
    try {
      if (kind === "delivered") {
        relay(
          ctx.send,
          "done",
          ctx.role === "reviewer"
            ? "Kimi finished — review delivered."
            : "Kimi finished — diff delivered.",
          ctx.runId,
        );
        ctx.push(
          ctx.role === "reviewer" || !ctx.dir
            ? reviewTurn(ctx.runId, ctx.getText())
            : diffTurn(ctx.runId, ctx.dir, worktreeDiff(ctx.dir)),
        );
      } else {
        relay(ctx.send, "done", `Kimi run ${ctx.runId} ${detail}.`, ctx.runId);
        ctx.push(failTurn(ctx.runId, detail));
      }
    } catch {
      /* session gone — nothing to deliver to */
    }
  };
}

/** Drive one prompt to completion in the background: wall-clock cap, cancel hook, diff
 * delivery. The tool call has already returned when this runs.
 * @param {{ client: import("../integrations/acp/acp-client.js").AcpClient, sessionId: string,
 *   prompt: string, ctx: RunCtx }} run */
function watchRun({ client, sessionId, prompt, ctx }) {
  const settle = makeSettle(ctx);
  const cancel = (/** @type {string} */ reason) => {
    try {
      client.notify("session/cancel", { sessionId });
    } catch {
      /* already dead */
    }
    setTimeout(() => {
      client.kill();
    }, 2_000).unref();
    settle("failed", reason);
  };
  if (ctx.boardId) liveRuns.set(ctx.boardId, { cancel });
  const capTimer = setTimeout(() => {
    cancel(`exceeded the ${Math.round(RUN_WALLCLOCK_MS / 60_000)}m limit and was stopped`);
  }, RUN_WALLCLOCK_MS);
  capTimer.unref();
  client
    .request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text: prompt }] },
      RUN_WALLCLOCK_MS + OPEN_TIMEOUT_MS,
    )
    .then((res) => {
      clearTimeout(capTimer);
      const stop = /** @type {{ stopReason?: string } | null} */ (res)?.stopReason ?? "end";
      if (stop === "cancelled") settle("failed", "was cancelled");
      else settle("delivered", stop);
      client.kill();
    })
    .catch((e) => {
      clearTimeout(capTimer);
      cancel(e instanceof Error ? e.message : String(e));
    });
}

/** Text of one agent_message_chunk update, or null. @param {unknown} params */
function messageChunk(params) {
  const update =
    /** @type {{ update?: { sessionUpdate?: string, content?: { text?: string } } }} */ (params)
      ?.update;
  if (update?.sessionUpdate !== "agent_message_chunk") return null;
  return typeof update.content?.text === "string" ? update.content.text : null;
}

/** Open the ACP session (spawn kimi acp in `cwd`, initialize, session/new). `readOnly`
 * auto-denies mutating permission requests (reviewer mode); `onAgentText` accumulates the
 * agent's streamed message (the reviewer's deliverable).
 * @param {{ cwd: string, send: Send, waitFor: WaitFor, readOnly: boolean, onAgentText: (t: string) => void }} deps
 * @returns {Promise<{ client: import("../integrations/acp/acp-client.js").AcpClient, sessionId: string }>} */
async function openSession({ cwd, send, waitFor, readOnly, onAgentText }) {
  const client = startAcpClient({
    command: "kimi",
    args: ["acp"],
    cwd,
    onNotification: (method, params) => {
      if (method !== "session/update") return;
      const chunk = messageChunk(params);
      if (chunk) onAgentText(chunk);
      const line = progressLine(params);
      if (line) relay(send, "progress", line);
    },
    onRequest: (method, params) => {
      if (method === "session/request_permission")
        return answerPermission(params, waitFor, readOnly);
      return Promise.reject(new Error(`unsupported client method: ${method}`));
    },
  });
  try {
    await client.request(
      "initialize",
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      },
      OPEN_TIMEOUT_MS,
    );
    const sess = /** @type {{ sessionId?: string }} */ (
      await client.request("session/new", { cwd, mcpServers: [] }, OPEN_TIMEOUT_MS)
    );
    if (!sess.sessionId) throw new Error("kimi acp returned no sessionId");
    return { client, sessionId: sess.sessionId };
  } catch (e) {
    client.kill();
    throw e;
  }
}

/** File the run's board task (its durable record AND kill switch — remove → cancel).
 * @param {Send} send @param {string} runId @param {"coder" | "reviewer"} role
 * @param {string} task @returns {string | null} the new board task id */
function fileBoardTask(send, runId, role, task) {
  try {
    const tasks = applyOp(
      {
        op: "add",
        owner: "agent",
        title: `Kimi ${role} run ${runId}: ${task.slice(0, 80)}`,
        note:
          role === "reviewer"
            ? "external Kimi review (read-only) — remove this task to cancel"
            : `external Kimi run in worktree .xenodot-run/kimi/${runId} — remove this task to cancel`,
      },
      new Date().toISOString(),
    );
    send({ type: "tasks", tasks });
    return tasks[tasks.length - 1]?.id ?? null;
  } catch {
    return null; // board unavailable — run still tracked by the feed + wall-clock cap
  }
}

/** Build the Kimi tool. Fire-and-forget: open the ACP session (fresh worktree for the
 * coder role; the live tree, read-only, for the reviewer role), kick off the background
 * watcher, return at once.
 * @param {{ send: Send, push: Push, waitFor: WaitFor }} deps */
export function makeKimiTool({ send, push, waitFor }) {
  return tool(
    "kimi",
    "Delegate ONE discrete task to your external Kimi coworker (kimi-cli over ACP). " +
      "role='coder' (default): Kimi implements the task in the BACKGROUND in an isolated git " +
      "worktree and delivers the resulting DIFF to you later as a new message — merging that " +
      "diff is a separate human-gated step; Kimi never edits the shared tree. role='reviewer': " +
      "Kimi READ-ONLY reviews the described work (e.g. the current diff) and delivers findings. " +
      "FIRE-AND-FORGET either way: returns immediately, progress streams to the feed, gated " +
      "actions raise inline approval cards — do not wait on it. ONLY the Hive calls this. To " +
      "stop a run, remove its board task. If it reports Kimi is off/not ready, dispatch a " +
      "xenodot builder (or reviewer) instead.",
    {
      task: z.string().describe("The single, self-contained task to delegate to Kimi."),
      role: z
        .enum(["coder", "reviewer"])
        .optional()
        .describe("'coder' (default) implements in an isolated worktree; 'reviewer' is read-only."),
      context: z
        .string()
        .optional()
        .describe("Optional background: relevant files/paths, constraints, what done looks like."),
    },
    async (input) => {
      const cfg = getKimiConfig();
      if (!cfg.enabled) {
        return ok(
          "Kimi is off (enable it in ⚙ Settings or `npm run kimi:setup`, then `kimi login`). " +
            "Dispatch a xenodot builder yourself instead.",
        );
      }
      const role = input.role ?? "coder";
      const runId = `k${Date.now().toString(36)}`;
      /** @type {string | null} */
      let dir = null;
      if (role === "coder") {
        const wt = createKimiWorktree(runId);
        if ("error" in wt) return ok(`Kimi could not start: ${wt.error}. Use a xenodot builder.`);
        dir = wt.dir;
      }
      let agentText = "";
      let opened;
      try {
        opened = await openSession({
          cwd: dir ?? PROJECT_DIR,
          send,
          waitFor,
          readOnly: role === "reviewer",
          onAgentText: (t) => {
            agentText += t;
          },
        });
      } catch (e) {
        if (role === "coder") reapKimiWorktree(runId, { keep: false });
        const msg = e instanceof Error ? e.message : String(e);
        return ok(
          `Kimi could not open an ACP session (${msg}). If it's an auth error, run \`kimi login\` ` +
            "in a terminal. Dispatch a xenodot builder instead.",
        );
      }
      const boardId = fileBoardTask(send, runId, role, input.task);
      watchRun({
        client: opened.client,
        sessionId: opened.sessionId,
        prompt: buildPrompt(role, input.task, input.context),
        ctx: { runId, role, boardId, dir, getText: () => agentText, send, push },
      });
      relay(send, "start", input.task.slice(0, 240), runId);
      return ok(
        role === "reviewer"
          ? `Kimi review run started (id ${runId}, read-only) — working in the background; ` +
              "findings arrive as a new message. Do not wait; continue or wrap up this turn."
          : `Kimi coding run started (id ${runId}) in an isolated worktree — working in the ` +
              "background. It will stream progress to the feed, raise approval cards when needed, " +
              "and deliver its diff to you as a new message. Do not wait; continue or wrap up this turn.",
      );
    },
  );
}
