// node:test coverage for the Hermes bridge (mcp-tools/hermes-tool.js) through its ONLY
// exports, the two tool factories. The pure frame/classify helpers (classifyRun,
// extractProgress, progressFromFrame, describeSelfImprovement) are module-private, so the
// watcher path below exercises them indirectly — they are never exported just for tests.
// GAME_DIR points at a temp dir BEFORE import (isolated tasks board) and the HERMES_* env
// vars override any saved .xenodot.json block, so the suite is deterministic anywhere.
// All network is a recorded in-process fetch stub — no gateway, no SDK session.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseJSON } from "../../lib/json.js";

process.env.GAME_DIR = mkdtempSync(path.join(tmpdir(), "xeno-hermes-"));
process.env.HERMES_ENABLED = "false";
const { makeHermesTool, makeHermesFeedbackTool } = await import("./hermes-tool.js");
const { getPersona } = await import("../../lib/hermes-personas.js");

/** @typedef {import("../../lib/types.js").OutMsg} OutMsg */
/** @typedef {import("@anthropic-ai/claude-agent-sdk").SDKUserMessage} SDKUserMessage */

const realFetch = globalThis.fetch;

/** @type {{ url: string, init: { method?: string, body?: string, headers?: Record<string, string> } }[]} */
let fetchCalls = [];

/** Minimal Response stand-in. `body: null` makes the SSE progress reader bail instantly.
 * @param {{ ok?: boolean, status?: number, payload?: unknown }} [spec] */
function fakeRes(spec = {}) {
  const { ok = true, status = 200, payload = {} } = spec;
  return {
    ok,
    status,
    statusText: "TEST",
    body: null,
    text: () => Promise.resolve(JSON.stringify(payload)),
  };
}

/** Install a URL-routed fetch stub that records every call. @param {(url: string) => unknown} route */
function installFetch(route) {
  const stub = (
    /** @type {string} */ url,
    /** @type {{ method?: string, body?: string, headers?: Record<string, string> } | undefined} */ init,
  ) => {
    fetchCalls.push({ url, init: init ?? {} });
    return Promise.resolve(route(url));
  };
  globalThis.fetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (stub));
}

function enableHermes() {
  process.env.HERMES_ENABLED = "true";
  process.env.HERMES_API_URL = "http://hermes.test/api///"; // trailing slashes must be stripped
  process.env.HERMES_API_KEY = "k-test";
}

/** @returns {{ send: (m: OutMsg) => void, sent: OutMsg[] }} */
function makeSend() {
  /** @type {OutMsg[]} */
  const sent = [];
  return { send: (m) => void sent.push(m), sent };
}

/** First text block of a tool result. @param {unknown} r @returns {string} */
function textOf(r) {
  return /** @type {{ content: { text?: string }[] }} */ (r).content[0]?.text ?? "";
}

/** Fill the optional keys the SDK's InferShape keeps required (as `| undefined`).
 * @param {{ task: string, persona?: string, context?: string }} input */
function runArgs(input) {
  return { persona: undefined, context: undefined, ...input };
}

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = realFetch;
  process.env.HERMES_ENABLED = "false";
  delete process.env.HERMES_API_URL;
  delete process.env.HERMES_API_KEY;
});

test("hermes: off/unconfigured returns a plain advisory — no network, no pills, no push", async () => {
  installFetch(() => {
    throw new Error("network hit while disabled");
  });
  const { send, sent } = makeSend();
  /** @type {SDKUserMessage[]} */
  const pushed = [];
  const t = makeHermesTool(send, (m) => void pushed.push(m));
  const out = await t.handler(runArgs({ task: "why is the sky blue" }), {});
  assert.match(textOf(out), /off or not configured/);
  assert.equal(fetchCalls.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(pushed.length, 0);
});

test("hermes: a failed POST returns the researcher fallback and a done pill for the persona", async () => {
  enableHermes();
  installFetch(() => fakeRes({ ok: false, status: 503, payload: { err: "down" } }));
  const { send, sent } = makeSend();
  const t = makeHermesTool(send, () => {
    throw new Error("no push expected");
  });
  const out = await t.handler(runArgs({ task: "investigate crash", persona: "critic" }), {});
  assert.match(textOf(out), /Hermes call failed: Hermes 503/);
  assert.match(textOf(out), /dispatch a xenodot:\*-researcher/);
  // exactly one POST (no watcher spawned), to the slash-stripped base
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.url, "http://hermes.test/api/v1/runs");
  const pill = sent.find((m) => m.type === "hermes");
  assert.equal(pill?.phase, "done");
  assert.equal(pill?.persona, "critic");
});

test("hermes: a run without a run_id fails cleanly; the request carries brief + context + auth", async () => {
  enableHermes();
  installFetch(() => fakeRes({ payload: {} })); // 200 OK but no run_id
  const { send } = makeSend();
  const t = makeHermesTool(send, () => {});
  const out = await t.handler(
    runArgs({ task: "map the caves", context: "third-person platformer" }),
    {},
  );
  assert.match(textOf(out), /did not return a run_id/);
  const body = /** @type {{ input?: string, instructions?: string }} */ (
    parseJSON(fetchCalls[0]?.init.body ?? "{}")
  );
  assert.equal(body.input, "map the caves");
  const instructions = body.instructions ?? "";
  assert.ok(instructions.startsWith(getPersona("researcher").brief)); // default persona
  assert.match(instructions, /--- Task context ---\nthird-person platformer/);
  assert.equal(fetchCalls[0]?.init.headers?.authorization, "Bearer k-test");
});

test("hermes: fire-and-forget success — start pill now; findings turn + user board task one poll later", async () => {
  enableHermes();
  installFetch((url) => {
    if (url.endsWith("/v1/runs")) return fakeRes({ payload: { run_id: "r-ok" } });
    if (url.includes("/events")) return fakeRes({ ok: false }); // SSE unavailable — cosmetic only
    return fakeRes({ payload: { status: "completed", output: "THE FINDINGS" } });
  });
  const { send, sent } = makeSend();
  /** @type {(m: SDKUserMessage) => void} */
  let deliver = () => {};
  const turn = /** @type {Promise<SDKUserMessage>} */ (
    new Promise((resolve) => {
      deliver = resolve;
    })
  );
  const t = makeHermesTool(send, (m) => {
    deliver(m);
  });
  const out = await t.handler(runArgs({ task: "long dig" }), {});
  assert.match(textOf(out), /run started \(id r-ok\)/);
  assert.match(textOf(out), /Do not\s+wait/);
  assert.equal(sent.filter((m) => m.type === "hermes" && m.phase === "start").length, 1);

  // The watcher polls every 3s; the first poll sees "completed" and delivers.
  const delivered = /** @type {{ message: { content: { text?: string }[] } }} */ (
    /** @type {unknown} */ (await turn)
  );
  const text = delivered.message.content[0]?.text ?? "";
  assert.match(text, /run r-ok delivered its findings/);
  assert.match(text, /THE FINDINGS/);
  assert.ok(sent.some((m) => m.type === "hermes" && m.phase === "done"));
  // the delivery also lands as a durable, user-owned lead on the task board
  const tasksMsg = /** @type {{ tasks?: { title: string, owner: string }[] } | undefined} */ (
    sent.filter((m) => m.type === "tasks").at(-1)
  );
  const lead = tasksMsg?.tasks?.[0];
  assert.ok(lead, "expected a board task broadcast after delivery");
  assert.ok(lead.title.includes("findings ready (run r-ok)"));
  assert.equal(lead.owner, "user");
});

test("hermes_feedback: off/unconfigured is skipped without dispatching anything", async () => {
  installFetch(() => {
    throw new Error("network hit while disabled");
  });
  const { send, sent } = makeSend();
  const t = makeHermesFeedbackTool(send);
  const out = await t.handler({ runId: "r0", verdict: "useful", notes: "great" }, {});
  assert.match(textOf(out), /feedback skipped/);
  assert.equal(fetchCalls.length, 0);
  assert.equal(sent.length, 0);
});

test("hermes_feedback: a failed POST reports 'Feedback not recorded' and no pill fires", async () => {
  enableHermes();
  installFetch(() => fakeRes({ ok: false, status: 500 }));
  const { send, sent } = makeSend();
  const t = makeHermesFeedbackTool(send);
  const out = await t.handler({ runId: "r9", verdict: "not-useful", notes: "off-topic" }, {});
  assert.match(textOf(out), /Feedback not recorded/);
  assert.equal(sent.length, 0); // the start pill only fires once a run is accepted
  // the self-update instructions carried the verdict for Hermes to learn from
  const body = /** @type {{ instructions?: string }} */ (
    parseJSON(fetchCalls[0]?.init.body ?? "{}")
  );
  assert.match(body.instructions ?? "", /Verdict: not-useful/);
});
