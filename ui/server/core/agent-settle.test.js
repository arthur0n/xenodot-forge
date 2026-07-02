// node:test coverage for the agent/board settle helpers — the server-side half of
// FleetView's self-healing running strip. GAME_DIR points at a temp dir before import
// so the tasks-store writes stay isolated.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "xeno-settle-"));
process.env.GAME_DIR = scratch;
const settle = await import("./agent-settle.js");
const store = await import("../features/tasks/tasks-store.js");

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("../../lib/types.js").RunningAgentWire} RunningChip */

/** Collecting send fake. @returns {{ send: (obj: OutMsg) => void, sent: OutMsg[] }} */
function makeSend() {
  /** @type {OutMsg[]} */
  const sent = [];
  return { send: (obj) => void sent.push(obj), sent };
}

/** @param {string} taskId @param {string} label @param {boolean} background @returns {RunningChip} */
function chip(taskId, label, background) {
  return { taskId, toolUseId: `tu-${taskId}`, label, desc: "", started: 0, background };
}

beforeEach(() => {
  rmSync(path.join(scratch, ".xenodot"), { recursive: true, force: true });
});

test("bridgeStart: bridges only backgrounded spawns, once per task id", () => {
  const { send, sent } = makeSend();
  const bgSpawns = new Set(["tu-1"]);
  /** @type {Map<string, string>} */
  const bgBoard = new Map();
  settle.bridgeStart(
    { taskId: "task-1", toolUseId: "tu-1", desc: "research" },
    { bgSpawns, bgBoard, send },
  );
  settle.bridgeStart(
    { taskId: "task-1", toolUseId: "tu-1", desc: "research" },
    { bgSpawns, bgBoard, send },
  );
  settle.bridgeStart(
    { taskId: "task-2", toolUseId: "tu-fg", desc: "foreground" },
    { bgSpawns, bgBoard, send },
  );
  assert.equal(bgBoard.size, 1);
  assert.equal(sent.length, 1);
  const board = store.readTasks();
  assert.equal(board.length, 1);
  assert.equal(board[0]?.title, "research");
  assert.equal(board[0]?.status, "in_progress");
  assert.equal(board[0]?.agent, "background");
});

test("bridgeSettle: completed marks the bridged task done, stopped removes it", () => {
  const { send } = makeSend();
  const bgSpawns = new Set(["tu-1", "tu-2"]);
  /** @type {Map<string, string>} */
  const bgBoard = new Map();
  settle.bridgeStart(
    { taskId: "task-1", toolUseId: "tu-1", desc: "a" },
    { bgSpawns, bgBoard, send },
  );
  settle.bridgeStart(
    { taskId: "task-2", toolUseId: "tu-2", desc: "b" },
    { bgSpawns, bgBoard, send },
  );
  settle.bridgeSettle({ taskId: "task-1", status: "completed" }, { bgBoard, send });
  settle.bridgeSettle({ taskId: "task-2", status: "stopped" }, { bgBoard, send });
  assert.equal(bgBoard.size, 0);
  const board = store.readTasks();
  assert.equal(board.length, 1);
  assert.equal(board[0]?.title, "a");
  assert.equal(board[0]?.status, "done");
  // unknown task id: a no-op, never a throw
  assert.doesNotThrow(() => {
    settle.bridgeSettle({ taskId: "ghost", status: "completed" }, { bgBoard, send });
  });
});

test("settleAgentTasks: retires the chip and closes that agent's open tasks by label", () => {
  const { send } = makeSend();
  store.applyOp(
    { op: "add", title: "builder scratch", _by: "godot-dev" },
    "2026-01-01T00:00:00.000Z",
  );
  /** @type {Map<string, RunningChip>} */
  const runningByTask = new Map([["task-1", chip("task-1", "godot-dev", false)]]);
  settle.settleAgentTasks("task-1", { runningByTask, send });
  assert.equal(runningByTask.size, 0);
  assert.equal(store.readTasks()[0]?.status, "done");
});

test("settleAllBackground: teardown settles every bridged worker and running agent", () => {
  const { send, sent } = makeSend();
  const bgSpawns = new Set(["tu-1"]);
  /** @type {Map<string, string>} */
  const bgBoard = new Map();
  settle.bridgeStart(
    { taskId: "task-1", toolUseId: "tu-1", desc: "bg" },
    { bgSpawns, bgBoard, send },
  );
  /** @type {Map<string, RunningChip>} */
  const runningByTask = new Map([["task-2", chip("task-2", "godot-enemy", false)]]);
  settle.settleAllBackground({ bgBoard, runningByTask, send });
  assert.equal(bgBoard.size, 0);
  assert.equal(runningByTask.size, 0);
  // bridged bg task was removed (stopped), so the board holds no dead in_progress worker
  assert.deepEqual(store.readTasks(), []);
  assert.ok(sent.length >= 2);
});

test("sweepStaleAgents: retires only agents silent past the stale window", () => {
  const { send, sent } = makeSend();
  /** @type {Map<string, string>} */
  const bgBoard = new Map();
  /** @type {Map<string, RunningChip>} */
  const runningByTask = new Map([
    ["stale", chip("stale", "godot-dev", false)],
    ["fresh", chip("fresh", "godot-enemy", false)],
  ]);
  const lastSeen = new Map([
    ["stale", Date.now() - 16 * 60_000],
    ["fresh", Date.now()],
  ]);
  settle.sweepStaleAgents({ bgBoard, runningByTask, lastSeen, send });
  assert.deepEqual([...runningByTask.keys()], ["fresh"]);
  assert.equal(lastSeen.has("stale"), false);
  const running = sent.flatMap((m) => (m.type === "running" ? [m] : [])).at(-1);
  assert.ok(running);
  const agents = /** @type {RunningChip[]} */ (running.agents);
  assert.deepEqual(
    agents.map((a) => a.taskId),
    ["fresh"],
  );
});

test("sweepStaleAgents: no change emits nothing", () => {
  const { send, sent } = makeSend();
  /** @type {Map<string, RunningChip>} */
  const runningByTask = new Map([["live", chip("live", "godot-dev", false)]]);
  settle.sweepStaleAgents({
    bgBoard: new Map(),
    runningByTask,
    lastSeen: new Map([["live", Date.now()]]),
    send,
  });
  assert.equal(sent.length, 0);
});
