// node:test pattern for mcp-tools: build the tool with a captured `send`, invoke its
// handler directly (the SDK `tool()` wrapper exposes it as `.handler`), and assert on
// both the returned text and the board broadcast — no live SDK session anywhere.
// GAME_DIR is a temp dir so the board file (.xenodot/tasks.json) never touches a real game.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "xeno-tasktool-"));
process.env.GAME_DIR = scratch;
const { makeTaskTool } = await import("./task-tool.js");

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("../../lib/types.js").Task} Task */

beforeEach(() => {
  rmSync(path.join(scratch, ".xenodot"), { recursive: true, force: true });
});

/** Build the tool with a capturing send. */
function makeTool() {
  /** @type {OutMsg[]} */
  const sent = [];
  const t = makeTaskTool((m) => void sent.push(m));
  /** The task list carried by the latest broadcast. @returns {Task[]} */
  const lastTasks = () => {
    const last = /** @type {{ tasks?: Task[] } | undefined} */ (sent.at(-1));
    return last?.tasks ?? [];
  };
  return { t, sent, lastTasks };
}

/** First text block of a tool result. @param {unknown} r @returns {string} */
function textOf(r) {
  return /** @type {{ content: { text?: string }[] }} */ (r).content[0]?.text ?? "";
}

/** Fill the optional keys the SDK's InferShape keeps required (as `| undefined`).
 * @param {{ op: "add" | "update" | "remove" | "complete_open", title?: string,
 *   owner?: "agent" | "user", note?: string, id?: string,
 *   status?: "pending" | "in_progress" | "done", _by?: string }} input */
function args(input) {
  return {
    title: undefined,
    owner: undefined,
    note: undefined,
    tasks: undefined,
    id: undefined,
    status: undefined,
    _by: undefined,
    ...input,
  };
}

test("add: persists the task, broadcasts the board, and summarizes open items", async () => {
  const { t, sent, lastTasks } = makeTool();
  const out = await t.handler(args({ op: "add", title: "build level", _by: "main" }), {});
  assert.match(textOf(out), /1 task \(0 done\)\. OPEN: t1 build level \[pending\]/);
  assert.equal(sent.length, 1);
  const task = lastTasks()[0];
  assert.equal(task?.agent, "main");
  assert.equal(task?.owner, "agent"); // owner defaults to agent
});

test("add without _by: attributed to 'background' (the bridge's own label)", async () => {
  const { t, lastTasks } = makeTool();
  await t.handler(args({ op: "add", title: "bg job" }), {});
  assert.equal(lastTasks()[0]?.agent, "background");
});

test("update then remove: the summary tracks closing and dropping the task", async () => {
  const { t } = makeTool();
  await t.handler(args({ op: "add", title: "one", _by: "main" }), {});
  const closed = await t.handler(args({ op: "update", id: "t1", status: "done", _by: "main" }), {});
  assert.match(textOf(closed), /1 task \(1 done\)\. All closed\./);
  const removed = await t.handler(args({ op: "remove", id: "t1", _by: "main" }), {});
  assert.match(textOf(removed), /0 tasks \(0 done\)\./);
});

test("complete_open: closes only the caller's own open agent tasks", async () => {
  const { t, lastTasks } = makeTool();
  await t.handler(args({ op: "add", title: "dig tunnels", _by: "godot-dev" }), {});
  await t.handler(args({ op: "add", title: "paint sky", _by: "level-designer" }), {});
  await t.handler(
    args({ op: "add", title: "approve palette", owner: "user", _by: "godot-dev" }),
    {},
  );
  await t.handler(args({ op: "complete_open", _by: "godot-dev" }), {});
  const byTitle = new Map(lastTasks().map((task) => [task.title, task.status]));
  assert.equal(byTitle.get("dig tunnels"), "done");
  assert.equal(byTitle.get("paint sky"), "pending"); // another agent's task is untouched
  assert.equal(byTitle.get("approve palette"), "pending"); // user-owned — never auto-closed
});
