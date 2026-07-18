// POC web UI server for the engine-agnostic agent workflow (Godot or a
// compatible fork — Redot / Blazium). Bridges a browser (WebSocket) to a Claude
// Code session (Agent SDK).
//
// Usage: node ui/server/core/index.js /path/to/your/project
//
// Requires Claude Code installed and authenticated on this machine — the SDK
// drives the same local Claude Code the terminal uses.
import http from "node:http";
import { mkdirSync } from "node:fs";
import { WebSocketServer } from "ws";
import { parseJSON } from "../../lib/json.js";
import {
  PORT,
  PROJECT_DIR,
  PROJECT_FOUND,
  CONFIG_FILE,
  LOG_DIR,
  ENGINE_LABEL,
  RES_ASSET_MOUNT,
  saveDocsConfig,
  docsPublicConfig,
} from "./config.js";
import { AGENT_REGISTRY, listAgents } from "../agents/registry.js";
import { handleAgentApi } from "../agents/agents-http.js";
import { sweepKimiWorktrees } from "../integrations/kimi/kimi-worktree.js";
import { maybeStartHermesGateway } from "../integrations/hermes/hermes-gateway.js";
import { projectState } from "./http/project-state.js";
import { recentSessions, deleteSession } from "../features/transcripts/transcripts.js";
import { writeTranscript } from "../features/transcripts/transcript-write.js";
import { writeAsset, writeAssetFromPath } from "../features/assets/asset-write.js";
import { writeLevel } from "../features/levels/level-write.js";
import { listLevels } from "../features/levels/level-read.js";
import { readTasks, reapHandoffs } from "../features/tasks/tasks-store.js";
import { serveStatic } from "./http/static.js";
import { reclaimPortIfBusy } from "./http/port.js";
import { handleConnection } from "./session.js";
import { prepareGame } from "../cli/materialize.js";
import { computeUsage } from "./http/usage.js";
import {
  getWorkspaceSkills,
  BUILTIN_SKILLS,
  SKILL_CONTEXTS,
  getSkillOverrides,
  saveSkillOverrides,
  saveSkillSetup,
  applySkillSetup,
  hasSkillSetup,
} from "../features/skills/skills.js";
import { listAgentSkills, applyAssignment } from "../features/skills/agent-skills.js";
import { readSkills } from "../features/skills/skill-registry.js";

/** Read a request body and write it as a transcript; respond with the path or an error.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleTranscriptPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {{ path: string } | { error: string }} */
    let result;
    try {
      const body = /** @type {{ name?: string, text?: string }} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8"))
      );
      result = writeTranscript(body.name ?? "", body.text ?? "");
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

/** Save an asset the UI supplied (a native-picker base64 data URL, or a local file path
 * the user picked/named) into the chosen place — the game's assets/ (default) or the external
 * shared-asset library (place="shared") — into textures/ or models/ routed by file type;
 * respond with the res://-relative path or an error.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleAssetPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {{ path: string } | { error: string }} */
    let result;
    try {
      const body =
        /** @type {{ name?: string, dataUrl?: string, srcPath?: string, place?: "game"|"shared" }} */ (
          parseJSON(Buffer.concat(chunks).toString("utf8"))
        );
      result = body.srcPath
        ? writeAssetFromPath(body.name ?? "", body.srcPath, body.place)
        : writeAsset(body.name ?? "", body.dataUrl ?? "", body.place);
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

/** Read a drawn blockout grid (JSON) and write it into the game's
 * levels/drawn/current.json; respond with the project-relative path or an error.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleLevelPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {{ path: string } | { error: string }} */
    let result;
    try {
      const body = /** @type {{ grid?: unknown }} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8"))
      );
      result = writeLevel(body.grid ?? null);
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

/** Persist the settings the ⚙ panel submitted into .xenodot.json — one optional block per
 * registered external agent (hermes, codex, … — see AGENT_REGISTRY) plus the docs toggle
 * (a plain source, not a portal agent) — then respond with the secret-free public views so
 * the panel re-renders from truth. Only what the panel sent is written. Takes effect
 * immediately — every getXConfig re-reads the file per call, so no server restart is needed.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleSettingsPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {Record<string, object> | { error: string }} */
    let result;
    try {
      const body = /** @type {Record<string, object | undefined>} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8"))
      );
      const errors = [];
      for (const agent of AGENT_REGISTRY) {
        const patch = body[agent.id];
        if (!patch) continue;
        const saved = agent.saveConfig(patch);
        if ("error" in saved) errors.push(saved.error);
      }
      if (body.docs) {
        const saved = saveDocsConfig(body.docs);
        if ("error" in saved) errors.push(saved.error);
      }
      result = errors.length
        ? { error: errors.join("; ") }
        : {
            ...Object.fromEntries(AGENT_REGISTRY.map((a) => [a.id, a.publicConfig()])),
            docs: docsPublicConfig(),
          };
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

mkdirSync(LOG_DIR, { recursive: true });

// Materialize the framework's per-game files into the game (gitignored): tools copied,
// library symlinked. The plugin is the single source; the committed game stays pure.
if (PROJECT_FOUND) {
  const { tools, lib, assets } = prepareGame(PROJECT_DIR);
  if (tools.copied) console.log(`tools: refreshed ${tools.copied} file(s) in ${PROJECT_DIR}/tools`);
  if (lib.linked && lib.reason === "created") console.log(`library: linked → plugin/library`);
  if (assets.linked && assets.reason === "created")
    console.log(`${RES_ASSET_MOUNT}: linked → external asset library`);
  const skillSetup = applySkillSetup();
  if (skillSetup.applied)
    console.log("skills: applied skill-setup overrides from .xenodot/skill-setup.json");
}

/** Save the wizard result to .xenodot/skill-setup.json (applied to settings on next startup).
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleSkillSetupPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {{ ok: true } | { error: string }} */
    let result;
    try {
      const body = /** @type {{ context?: string, overrides?: Record<string, string> }} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8"))
      );
      result = saveSkillSetup(body.context ?? "", body.overrides ?? {});
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

/** Save skillOverrides sent by the settings panel into the game's .claude/settings.json.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleSkillsPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {{ ok: true } | { error: string }} */
    let result;
    try {
      const body = /** @type {{ overrides?: Record<string, string> }} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8"))
      );
      result = saveSkillOverrides(body.overrides ?? {});
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

/** Apply a batch of agent-skill assignment changes from the recalibration panel — each edits the
 * framework registry (skill tag + agent frontmatter), applied on the next session.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleAgentSkillsPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {{ ok: true } | { error: string }} */
    let result;
    try {
      const body = /** @type {{ changes?: { agent: string, skill: string, on: boolean }[] }} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8"))
      );
      /** @type {string[]} */
      const errors = [];
      for (const ch of body.changes ?? []) {
        const r = applyAssignment(ch.agent, ch.skill, ch.on);
        if ("error" in r) errors.push(`${ch.agent} / ${ch.skill}: ${r.error}`);
      }
      result = errors.length ? { error: errors.join("; ") } : { ok: true };
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

/** Skill-config lists for the settings panel + wizard. Each skill name appears ONCE, in the right
 * bucket: FRAMEWORK skills (plugin/skills/*, e.g. caveman) are always-on and dropped from the
 * toggleable lists entirely; WORKSPACE (~/.claude/commands) is discovered live; BUILTINS are the
 * known Claude Code list minus anything already covered by framework or workspace — so a skill that
 * exists in several places (caveman: framework + workspace + the built-in list) no longer triple-lists. */
function skillsConfig() {
  const framework = new Set(readSkills().keys());
  const workspace = getWorkspaceSkills().filter((s) => !framework.has(s.name));
  const wsNames = new Set(workspace.map((s) => s.name));
  const builtins = BUILTIN_SKILLS.filter((n) => !framework.has(n) && !wsNames.has(n));
  return {
    workspace,
    builtins,
    overrides: getSkillOverrides(),
    setupDone: hasSkillSetup(),
    contexts: SKILL_CONTEXTS,
  };
}

/** Simple GET endpoints: url → data producer. Keeps the main handler under the
 * complexity cap by replacing N if-branches with a single lookup.
 * @type {Record<string, () => unknown>} */
const GET_ROUTES = {
  "/api/state": projectState,
  "/api/sessions": recentSessions,
  "/api/tasks": readTasks,
  "/api/levels": listLevels,
  "/api/usage": computeUsage,
  "/api/skills": skillsConfig,
  "/api/agent-skills": listAgentSkills,
  "/api/agents": listAgents,
};

/** POST endpoints: url → handler. Keeps the request dispatcher under the complexity
 * cap by replacing N if-branches with a single lookup (mirrors GET_ROUTES).
 * @type {Record<string, (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void>} */
const POST_ROUTES = {
  "/api/transcript": handleTranscriptPost,
  "/api/asset": handleAssetPost,
  "/api/level": handleLevelPost,
  "/api/settings": handleSettingsPost,
  "/api/skills": handleSkillsPost,
  "/api/setup/skills": handleSkillSetupPost,
  "/api/agent-skills": handleAgentSkillsPost,
  // Legacy per-agent aliases — kept one release so old callers keep working; the
  // portal speaks only the generic /api/agents/:id/* form (see agents-http.js).
  "/api/hermes/check": (req, res) => {
    handleAgentApi(req, res, "/api/agents/hermes/check");
  },
  "/api/codex/check": (req, res) => {
    handleAgentApi(req, res, "/api/agents/codex/check");
  },
  "/api/codex/setup": (req, res) => {
    handleAgentApi(req, res, "/api/agents/codex/setup");
  },
  "/api/hermes/setup": (req, res) => {
    handleAgentApi(req, res, "/api/agents/hermes/setup");
  },
};

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  const getRoute = GET_ROUTES[url];
  if (getRoute) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(getRoute()));
    return;
  }
  if (req.method === "DELETE" && url.startsWith("/api/sessions/")) {
    const id = decodeURIComponent(url.slice("/api/sessions/".length));
    const ok = deleteSession(id);
    res.writeHead(ok ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ deleted: ok }));
    return;
  }
  if (req.method === "POST" && url.startsWith("/api/agents/")) {
    handleAgentApi(req, res, url);
    return;
  }
  const postRoute = POST_ROUTES[url];
  if (req.method === "POST" && postRoute) {
    postRoute(req, res);
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws, req) => {
  handleConnection(ws, req);
});

// WebSocket heartbeat. An idle socket — a backgrounded Chrome tab, a phone on mobile/NAT —
// gets its TCP mapping reaped after ~30-60s of silence; the resulting `close` would detach
// (and eventually tear down) the session. A periodic protocol-level ping keeps the mapping
// warm (the browser auto-answers pings even while the tab is backgrounded, no JS involved),
// and a missed pong identifies a genuinely-dead socket so we stop pinging it. `terminate()`
// fires `close` → onSocketDetach, which starts the grace window rather than killing the
// session, so reaping a dead socket never loses live work.
const WS_PING_MS = 25_000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const sock = /** @type {import("ws").WebSocket & { isAlive?: boolean }} */ (ws);
    if (sock.isAlive === false) {
      sock.terminate();
      continue;
    }
    sock.isAlive = false;
    sock.ping();
  }
}, WS_PING_MS);
wss.on("connection", (ws) => {
  const sock = /** @type {import("ws").WebSocket & { isAlive?: boolean }} */ (ws);
  sock.isAlive = true;
  sock.on("pong", () => {
    sock.isAlive = true;
  });
});
wss.on("close", () => {
  clearInterval(heartbeat);
});

/** What runs once the server is actually listening. */
function onListening() {
  console.log(`UI on http://localhost:${PORT} — project: ${PROJECT_DIR}`);
  // Boot-time cleanup: clear last session's transient builder handoff files (all consumed
  // by now). Deterministic, stateless — see reapHandoffs / the Handoffs orchestrator rule.
  reapHandoffs();
  // Prune git records of crashed Kimi worktrees (surviving dirs are kept — they may hold
  // an unreviewed diff); report how many are still parked for review.
  const kimiLeft = sweepKimiWorktrees();
  if (kimiLeft) console.log(`kimi: ${kimiLeft} worktree(s) awaiting review in .xenodot-run/kimi/`);
  // Bring up the Hermes gateway too when Hermes is on (opt-in, skipped if already up).
  // Non-blocking and non-fatal: the UI is fully usable whether or not this succeeds.
  void maybeStartHermesGateway();
  if (!PROJECT_FOUND) {
    console.warn(
      [
        "",
        `⚠  No ${ENGINE_LABEL} project at: ${PROJECT_DIR}`,
        "   The UI will open but show no sessions or files until it points at one.",
        "   Point it at your game (the framework only reads it — it stays in place):",
        "     • once:      npm run setup -- /path/to/your/game",
        "     • one-off:   npm start /path/to/your/game",
        `   Current target is set in ${CONFIG_FILE} (or defaults to ../game).`,
        "",
      ].join("\n"),
    );
  }
}

/** Clean one-line report for a startup-time error (instead of an unhandled-error stack dump), then
 * exit. Only wired during listen — e.g. the port was taken in the race after the preflight check.
 * @param {Error & { code?: string }} err */
function onStartError(err) {
  console.error(
    err.code === "EADDRINUSE"
      ? `\n⚠  Port ${PORT} is in use — could not start. Stop it, or use \`PORT=<n> npm start\`.`
      : `\nCould not start the UI server: ${err.message}`,
  );
  process.exit(1);
}

// Preflight: if our port is already held (usually a stray `npm start`), name it and — interactively
// — ask before stopping it, rather than dying on EADDRINUSE. The once-handlers are a backstop for
// the slim race between the check and listen; removed the moment we're listening.
await reclaimPortIfBusy(PORT);
server.once("error", onStartError);
wss.once("error", onStartError);
server.listen(PORT, () => {
  server.removeListener("error", onStartError);
  wss.removeListener("error", onStartError);
  onListening();
});
