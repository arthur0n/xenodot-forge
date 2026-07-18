// HTTP surface for the external-agent registry — the generic routes the Agents portal
// drives: POST /api/agents/:id/check|setup|settings (dispatched from the server's one
// prefix branch, see core/index.js). Legacy per-agent routes (/api/hermes/check, …)
// alias into the same handlers, so old callers keep working while the portal speaks
// only the generic form.
import { spawn } from "node:child_process";
import { parseJSON } from "../../lib/json.js";
import { FRAMEWORK_DIR } from "../core/config.js";
import { getAgent } from "./registry.js";

/** A setup npm script gets 5 minutes before we kill it — it may install a CLI. */
const SETUP_TIMEOUT_MS = 300_000;
/** Tail of combined setup output returned to the panel — enough to show the failure. */
const SETUP_OUTPUT_TAIL = 8000;

/** Respond with `result` as JSON; `bad` picks the 400 arm. Small local helper — every
 * handler below ends exactly this way.
 * @param {import("node:http").ServerResponse} res @param {unknown} result @param {boolean} [bad] */
function respond(res, result, bad = false) {
  res.writeHead(bad ? 400 : 200, { "content-type": "application/json" });
  res.end(JSON.stringify(result));
}

/** Collect a request body and hand it to `fn` as parsed JSON (`{}` on empty/invalid).
 * @param {import("node:http").IncomingMessage} req
 * @param {(body: Record<string, unknown>) => void} fn */
function withBody(req, fn) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {Record<string, unknown>} */
    let body = {};
    try {
      body = /** @type {Record<string, unknown>} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8") || "{}")
      );
    } catch {
      /* empty/invalid body → {} */
    }
    fn(body);
  });
}

/** Run a framework setup npm script (codex:setup / hermes:setup / …) from the framework
 * root and report the result to the portal. The integration's prompt block is injected at
 * SESSION START (see session.js), so a fresh session is required to activate it —
 * `needsRestart` is always true on success and the UI says so. Captures combined output
 * (tail) so failures are visible.
 * @param {{ script: string, extraArgs: string[], manual: string | null }} setup
 * @param {import("node:http").ServerResponse} res */
export function runSetupScript(setup, res) {
  const { script, extraArgs, manual } = setup;
  const args = ["run", script, ...(extraArgs.length ? ["--", ...extraArgs] : [])];
  let out = "";
  let done = false;
  /** @param {boolean} ok @param {Record<string, unknown>} [extra] */
  const finish = (ok, extra = {}) => {
    if (done) return;
    done = true;
    res.writeHead(ok ? 200 : 500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok,
        output: out.slice(-SETUP_OUTPUT_TAIL),
        needsRestart: ok,
        manual,
        ...extra,
      }),
    );
  };
  let child;
  try {
    child = spawn("npm", args, { cwd: FRAMEWORK_DIR });
  } catch (e) {
    finish(false, { error: e instanceof Error ? e.message : String(e) });
    return;
  }
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    finish(false, { error: `${script} timed out after 5 min` });
  }, SETUP_TIMEOUT_MS);
  const collect = (/** @type {Buffer} */ c) => {
    out += c.toString();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("error", (/** @type {Error} */ e) => {
    clearTimeout(timer);
    finish(false, { error: e.message });
  });
  child.on("close", (/** @type {number | null} */ code) => {
    clearTimeout(timer);
    finish(code === 0, code === 0 ? {} : { error: `${script} exited ${code}` });
  });
}

/** Dispatch one generic agent route. `url` is the full request path, e.g.
 * `/api/agents/hermes/check`; unknown agent or verb → 404.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string} url */
export function handleAgentApi(req, res, url) {
  const [id = "", verb = ""] = url.slice("/api/agents/".length).split("/");
  const agent = getAgent(decodeURIComponent(id));
  if (!agent) {
    respond(res, { error: `unknown agent: ${id}` }, true);
    return;
  }
  switch (verb) {
    case "check":
      withBody(req, (body) => {
        // "Not ready" is a verdict, not an error — checks always answer 200.
        Promise.resolve()
          .then(() => agent.check(/** @type {Record<string, string | undefined>} */ (body)))
          .then((result) => {
            respond(res, result);
          })
          .catch((e) => {
            respond(res, { ok: false, error: e instanceof Error ? e.message : String(e) });
          });
      });
      return;
    case "setup":
      if (!agent.setup) {
        respond(res, { error: `${agent.id} has no setup script` }, true);
        return;
      }
      runSetupScript(agent.setup, res);
      return;
    case "settings":
      withBody(req, (body) => {
        const saved = agent.saveConfig(body);
        if ("error" in saved) {
          respond(res, saved, true);
          return;
        }
        respond(res, agent.publicConfig());
      });
      return;
    default:
      respond(res, { error: `unknown agent route: ${verb}` }, true);
  }
}
