// node:test coverage for the stream layer: 529/overload detection and the
// deterministic retry driver (runWithRetry) — exercised with fake SDK queries, no
// real Agent SDK subprocess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.GAME_DIR = mkdtempSync(path.join(tmpdir(), "xeno-stream-"));
const { isOverloadMessage, runningChip, runWithRetry } = await import("./stream.js");

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */

/** @param {unknown[]} messages fake SDK stream (async-iterable query) @returns {AsyncIterable<unknown>} */
function fakeQuery(messages) {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

/** @returns {{ send: (obj: OutMsg) => void, sent: OutMsg[], statuses: () => string[] }} */
function makeSend() {
  /** @type {OutMsg[]} */
  const sent = [];
  return {
    send: (obj) => void sent.push(obj),
    sent,
    statuses: () => sent.filter((m) => m.type === "status").map((m) => String(m.text)),
  };
}

/** Shared no-op deps for runWithRetry. */
function makeDeps() {
  const { send, sent, statuses } = makeSend();
  return {
    send,
    sent,
    statuses,
    trackMessage: () => {},
    trackDeps: /** @type {never} */ ({}),
    busy: { value: false },
    session: /** @type {{ query?: unknown }} */ ({}),
    inbox: { push: () => {} },
    resumeId: null,
  };
}

test("isOverloadMessage: api_retry overloaded / 529 result / plain result are classified", () => {
  assert.ok(
    isOverloadMessage(
      /** @type {never} */ ({ type: "system", subtype: "api_retry", error: "overloaded" }),
    ),
  );
  assert.ok(
    isOverloadMessage(
      /** @type {never} */ ({ type: "system", subtype: "api_retry", error_status: 529 }),
    ),
  );
  assert.ok(isOverloadMessage(/** @type {never} */ ({ type: "assistant", error: "overloaded" })));
  assert.ok(
    isOverloadMessage(
      /** @type {never} */ ({
        type: "result",
        subtype: "success",
        is_error: true,
        api_error_status: 529,
      }),
    ),
  );
  assert.ok(
    isOverloadMessage(
      /** @type {never} */ ({ type: "result", subtype: "error", errors: ["API 529"] }),
    ),
  );
  assert.equal(
    isOverloadMessage(
      /** @type {never} */ ({ type: "result", subtype: "success", is_error: false, errors: [] }),
    ),
    false,
  );
});

test("runningChip: background flag comes from the spawn set, fields default clean", () => {
  const chip = runningChip(
    { task_id: "t", tool_use_id: "tu", subagent_type: "godot-dev" },
    new Set(["tu"]),
  );
  assert.equal(chip.background, true);
  assert.equal(chip.label, "godot-dev");
  const fg = runningChip({}, new Set());
  assert.equal(fg.background, false);
  assert.equal(fg.taskId, "");
});

test("runWithRetry: a clean stream ends with 'session ended' and exposes the query handle", async () => {
  const deps = makeDeps();
  const q = fakeQuery([
    { type: "system", subtype: "init", session_id: "sess-1" },
    { type: "result", subtype: "success", is_error: false, errors: [] },
  ]);
  await runWithRetry({
    ...deps,
    makeQuery: () => /** @type {never} */ (q),
    abort: new AbortController(),
  });
  assert.deepEqual(deps.statuses(), ["session ended"]);
  assert.equal(deps.session.query, q);
  // events were forwarded to the browser
  assert.equal(deps.sent.filter((m) => m.type === "event").length, 2);
});

test("runWithRetry: busy flips true on assistant and false on result (grace-policy signal)", async () => {
  const deps = makeDeps();
  /** @type {boolean[]} */
  const flips = [];
  await runWithRetry({
    ...deps,
    onBusyChange: () => void flips.push(deps.busy.value),
    makeQuery: () =>
      /** @type {never} */ (
        fakeQuery([
          { type: "assistant", message: { content: [] } },
          { type: "result", subtype: "success", is_error: false, errors: [] },
        ])
      ),
    abort: new AbortController(),
  });
  assert.deepEqual(flips, [true, false]);
});

test("runWithRetry: sustained overload with an aborted controller bails without resuming", async () => {
  const deps = makeDeps();
  const abort = new AbortController();
  abort.abort(); // user already disconnected — the 5-min delay resolves immediately
  let calls = 0;
  await runWithRetry({
    ...deps,
    makeQuery: () => {
      calls += 1;
      return /** @type {never} */ (
        fakeQuery([
          { type: "system", subtype: "api_retry", error: "overloaded", session_id: "sess-2" },
        ])
      );
    },
    abort,
  });
  assert.equal(calls, 1); // never rebuilt the query after the abort
  assert.match(deps.statuses().at(-1) ?? "", /gave up after 0 retries/);
});

test("runWithRetry: a non-overload throw propagates to the caller", async () => {
  const deps = makeDeps();
  async function* boom() {
    yield { type: "system", subtype: "init", session_id: "sess-3" };
    throw new Error("ENGINE_DIED");
  }
  await assert.rejects(
    runWithRetry({
      ...deps,
      makeQuery: () => /** @type {never} */ (boom()),
      abort: new AbortController(),
    }),
    /ENGINE_DIED/,
  );
});
