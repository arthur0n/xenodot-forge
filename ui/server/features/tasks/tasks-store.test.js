// node:test coverage for the persistent task store. GAME_DIR is pointed at a fresh
// temp dir BEFORE the store (via config.js) is imported, so every write lands in an
// isolated .xenodot/tasks.json — never a real game's board.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "xeno-tasks-"));
process.env.GAME_DIR = scratch;
const store = await import("./tasks-store.js");

const NOW = "2026-01-01T00:00:00.000Z";

beforeEach(() => {
  rmSync(path.join(scratch, ".xenodot"), { recursive: true, force: true });
});

test("applyOp add: assigns t<n> ids past the highest in use, stamps creator", () => {
  store.applyOp({ op: "add", title: "first", _by: "godot-dev" }, NOW);
  const list = store.applyOp({ op: "add", title: "second" }, NOW);
  assert.equal(list.length, 2);
  assert.equal(list[0]?.id, "t1");
  assert.equal(list[1]?.id, "t2");
  assert.equal(list[0]?.agent, "godot-dev");
  assert.equal(list[0]?.status, "pending");
});

test("applyOp add: batch specs all land, each carrying the op-level _by", () => {
  const list = store.applyOp(
    { op: "add", _by: "main", tasks: [{ title: "a" }, { title: "b" }] },
    NOW,
  );
  assert.deepEqual(
    list.map((t) => t.agent),
    ["main", "main"],
  );
});

test("applyOp update: unknown status/owner ignored, valid ones applied, stale id no-ops", () => {
  store.applyOp({ op: "add", title: "job" }, NOW);
  let list = store.applyOp({ op: "update", id: "t1", status: "bogus", owner: "nobody" }, NOW);
  assert.equal(list[0]?.status, "pending");
  list = store.applyOp({ op: "update", id: "t1", status: "in_progress", owner: "user" }, NOW);
  assert.equal(list[0]?.status, "in_progress");
  assert.equal(list[0]?.owner, "user");
  assert.doesNotThrow(() => store.applyOp({ op: "update", id: "t999", status: "done" }, NOW));
});

test("applyOp update with answer: records it and resolves the question to done", () => {
  store.addQuestion("Ship it?", ["yes", "no"], "game-designer", NOW);
  const list = store.applyOp({ op: "update", id: "t1", answer: "yes" }, NOW);
  assert.equal(list[0]?.answer, "yes");
  assert.equal(list[0]?.status, "done");
});

test("pruneDoneTasks: drops agent-owned done, keeps open + user-owned; null when no-op", () => {
  store.applyOp({ op: "add", title: "agent done", status: "done" }, NOW);
  store.applyOp({ op: "add", title: "agent open" }, NOW);
  store.applyOp({ op: "add", title: "user done", owner: "user", status: "done" }, NOW);
  const pruned = store.pruneDoneTasks();
  assert.ok(pruned);
  assert.deepEqual(
    pruned.map((t) => t.title),
    ["agent open", "user done"],
  );
  assert.equal(store.pruneDoneTasks(), null);
});

test("addQuestion: idempotent per normalized title — refreshes options, no duplicate", () => {
  store.addQuestion("Which  Camera?", ["ortho"], "main", NOW);
  const list = store.addQuestion("which camera?", ["ortho", "persp"], "main", NOW);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0]?.options, ["ortho", "persp"]);
});

test("findOpenQuestion: whitespace/case-insensitive, skips answered questions", () => {
  store.addQuestion("Use Jolt physics?", undefined, "main", NOW);
  assert.ok(store.findOpenQuestion("  use   jolt PHYSICS? "));
  store.applyOp({ op: "update", id: "t1", answer: "yes" }, NOW);
  assert.equal(store.findOpenQuestion("Use Jolt physics?"), undefined);
});

test("closeStragglerTasks: closes only non-running sub-agent tasks; spares main/background/live", () => {
  store.applyOp({ op: "add", title: "orchestrator", _by: "main" }, NOW);
  store.applyOp({ op: "add", title: "bg worker", _by: "background" }, NOW);
  store.applyOp({ op: "add", title: "live builder", _by: "godot-dev" }, NOW);
  store.applyOp({ op: "add", title: "straggler", _by: "godot-enemy" }, NOW);
  const next = store.closeStragglerTasks(new Set(["godot-dev"]));
  assert.ok(next);
  const byTitle = new Map(next.map((t) => [t.title, t.status]));
  assert.equal(byTitle.get("orchestrator"), "pending");
  assert.equal(byTitle.get("bg worker"), "pending");
  assert.equal(byTitle.get("live builder"), "pending");
  assert.equal(byTitle.get("straggler"), "done");
  assert.equal(store.closeStragglerTasks(new Set(["godot-dev"])), null);
});

test("readTasks: absent or corrupt file is an empty list", () => {
  assert.deepEqual(store.readTasks(), []);
});
