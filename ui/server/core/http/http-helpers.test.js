// node:test coverage for the purely-importable core/http helpers: projectState (live
// project inventory), serveStatic (traversal-guarded file serving), computeUsage (log
// aggregation). The GET_ROUTES/POST_ROUTES tables themselves live in core/index.js,
// which stands up the real HTTP server + WebSocket on import — so routing is NOT
// imported here; these are the units behind those routes.
// GAME_DIR is pointed at a temp fixture project BEFORE config.js is imported, so
// PROJECT_FOUND and every walk stay off any real game.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "xeno-http-"));
process.env.GAME_DIR = scratch;
// Pin the project marker against any engine override saved in the local .xenodot.json.
process.env.ENGINE_PROJECT_FILE = "project.godot";

// Fixture game — must exist BEFORE config.js computes PROJECT_FOUND at import time.
writeFileSync(path.join(scratch, "project.godot"), '[application]\nconfig/name="Fixture Quest"\n');
mkdirSync(path.join(scratch, "design"), { recursive: true });
writeFileSync(path.join(scratch, "design", "overview.md"), "# Big Picture\n\nnotes\n");
writeFileSync(path.join(scratch, "design", "README.md"), "# Skip Me\n");
mkdirSync(path.join(scratch, "library"), { recursive: true });
writeFileSync(
  path.join(scratch, "library", "jolt.md"),
  "# Jolt Physics\n\n**Verdict** — adopt: fast\n",
);
writeFileSync(path.join(scratch, "main.tscn"), "[gd_scene]\n");
writeFileSync(path.join(scratch, "player.gd"), "extends Node\n");
mkdirSync(path.join(scratch, ".hidden"), { recursive: true });
writeFileSync(path.join(scratch, ".hidden", "secret.tscn"), "[gd_scene]\n");
mkdirSync(path.join(scratch, ".claude", "agents"), { recursive: true });
writeFileSync(
  path.join(scratch, ".claude", "agents", "fixture-agent.md"),
  "---\nmodel: haiku\n---\nbody\n",
);
mkdirSync(path.join(scratch, ".claude", "skills", "fixture-skill"), { recursive: true });

const { FRAMEWORK_PLUGIN_DIR } = await import("../config.js");
const { projectState } = await import("./project-state.js");
const { serveStatic } = await import("./static.js");
const { computeUsage } = await import("./usage.js");

test("projectState: inventories the fixture game — name, docs, verdicts, scenes, agents, skills", () => {
  const s = projectState();
  assert.equal(s.name, "Fixture Quest");
  assert.equal(s.found, true);
  assert.equal(s.dir, path.resolve(scratch));
  assert.deepEqual(s.designDocs, [{ path: "design/overview.md", title: "Big Picture" }]); // README filtered
  assert.deepEqual(s.library, [
    { path: "library/jolt.md", title: "Jolt Physics", verdict: "adopt: fast" },
  ]);
  assert.ok(s.scenes.includes("main.tscn"));
  assert.ok(!s.scenes.some((f) => f.includes("secret"))); // dot-dirs are skipped by the walk
  assert.ok(s.scripts.includes("player.gd"));
  const fixture = s.agents.find((a) => a.name === "fixture-agent");
  assert.equal(fixture?.model, "haiku");
  assert.ok(s.skills.includes("fixture-skill"));
  // integration configs reach the browser secret-free
  assert.ok(!("apiKey" in s.hermes));
  assert.equal(typeof s.hermes.hasKey, "boolean");
});

test("projectState: the plugin wins an agent name clash with the game's local copy", () => {
  const pluginAgents = readdirSync(path.join(FRAMEWORK_PLUGIN_DIR, "agents")).filter((f) =>
    f.endsWith(".md"),
  );
  const name = pluginAgents[0]?.replace(/\.md$/, "") ?? "";
  assert.ok(name, "the plugin ships at least one agent");
  writeFileSync(
    path.join(scratch, ".claude", "agents", `${name}.md`),
    "---\nmodel: clash-model\n---\n",
  );
  const clash = projectState().agents.find((a) => a.name === name);
  assert.ok(clash, "the clashing agent is listed once");
  assert.notEqual(clash.model, "clash-model"); // plugin dir is scanned first and wins
});

/** Run serveStatic against fake req/res (no server) and capture the response.
 * @param {string} url */
function get(url) {
  /** @type {{ status: number, headers: Record<string, string>, body: string }} */
  const out = { status: 0, headers: {}, body: "" };
  const res = {
    /** @param {number} status @param {Record<string, string>} [headers] */
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers ?? {};
    },
    /** @param {string | Uint8Array} chunk */
    end(chunk) {
      out.body = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    },
  };
  serveStatic(
    /** @type {import("node:http").IncomingMessage} */ (/** @type {unknown} */ ({ url })),
    /** @type {import("node:http").ServerResponse} */ (/** @type {unknown} */ (res)),
  );
  return out;
}

test("serveStatic: '/' serves index.html as text/html", () => {
  const out = get("/");
  assert.equal(out.status, 200);
  assert.equal(out.headers["content-type"], "text/html");
  assert.ok(out.body.includes("<"));
});

test("serveStatic: traversal outside ui/ is refused, not resolved", () => {
  assert.equal(get("/../package.json").status, 403);
  assert.equal(get("//../../etc/passwd").status, 403);
});

test("serveStatic: missing files and directories 404; query strings are ignored", () => {
  assert.equal(get("/definitely-not-here.js").status, 404);
  assert.equal(get("/client").status, 404); // a directory is not a file
  const css = get("/agent-ui.css?v=42");
  assert.equal(css.status, 200);
  assert.equal(css.headers["content-type"], "text/css");
});

// LOG_DIR is a path constant baked at import (framework logs/, not env-tunable), so this
// asserts the aggregate's invariants over whatever logs exist rather than fixture totals.
test("computeUsage: aggregates the logs dir into a consistent shape", () => {
  const u = computeUsage();
  assert.ok(u.sessionCount <= u.totalCount);
  for (const v of Object.values(u.totals)) {
    assert.equal(typeof v, "number");
    assert.ok(v >= 0);
  }
  assert.ok(u.hitRate >= 0 && u.hitRate <= 100);
  assert.ok(u.topSessions.length <= 10);
  const totals = u.topSessions.map((s) => s.total);
  assert.deepEqual(
    totals,
    [...totals].sort((a, b) => b - a),
  ); // sorted descending
  for (const s of u.topSessions) assert.ok(s.total > 0); // zero-usage sessions are dropped
});
