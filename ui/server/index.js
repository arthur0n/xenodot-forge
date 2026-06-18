// POC web UI server for the engine-agnostic agent workflow (Godot or a
// compatible fork — Redot / Blazium). Bridges a browser (WebSocket) to a Claude
// Code session (Agent SDK).
//
// Usage: node ui/server/index.js /path/to/your/project
//
// Requires Claude Code installed and authenticated on this machine — the SDK
// drives the same local Claude Code the terminal uses.
import http from "node:http";
import { mkdirSync } from "node:fs";
import { WebSocketServer } from "ws";
import { parseJSON } from "../lib/json.js";
import {
  PORT,
  PROJECT_DIR,
  PROJECT_FOUND,
  CONFIG_FILE,
  LOG_DIR,
  ENGINE_LABEL,
  RES_ASSET_MOUNT,
  saveHermesConfig,
  hermesPublicConfig,
  getHermesConfig,
} from "./config.js";
import { checkHermes } from "./hermes-check.js";
import { maybeStartHermesGateway } from "./hermes-gateway.js";
import { projectState } from "./project-state.js";
import { recentSessions, deleteSession } from "./transcripts.js";
import { writeTranscript } from "./transcript-write.js";
import { writeAsset, writeAssetFromPath } from "./asset-write.js";
import { writeLevel } from "./level-write.js";
import { listLevels } from "./level-read.js";
import { readTasks } from "./tasks-store.js";
import { serveStatic } from "./static.js";
import { reclaimPortIfBusy } from "./port.js";
import { handleConnection } from "./session.js";
import { prepareGame } from "./materialize.js";
import { computeUsage } from "./usage.js";

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

/** Persist the Hermes settings block the UI panel submitted (enable, apiUrl, model, and
 * optionally a new apiKey) into .xenodot.json, then respond with the key-free public view
 * so the panel re-renders from truth. Takes effect immediately — getHermesConfig re-reads
 * the file per call, so no server restart is needed.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleSettingsPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    /** @type {{ hermes?: import("../lib/types.js").HermesPublicConfig } | { error: string }} */
    let result;
    try {
      const body =
        /** @type {{ hermes?: { enabled?: boolean, apiUrl?: string, apiKey?: string, model?: string } }} */ (
          parseJSON(Buffer.concat(chunks).toString("utf8"))
        );
      const saved = saveHermesConfig(body.hermes ?? {});
      result = "error" in saved ? saved : { hermes: hermesPublicConfig() };
    } catch {
      result = { error: "bad request" };
    }
    res.writeHead("error" in result ? 400 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  });
}

/** A trimmed typed value, or the saved fallback when it's blank/missing.
 * @param {string | undefined} typed @param {string | null} fallback @returns {string | null} */
function typedOr(typed, fallback) {
  const t = typed?.trim();
  return t && t.length > 0 ? t : fallback;
}

/** Probe the Hermes gateway and respond with the verdict. Tests the URL/key typed in
 * the panel (so you can check BEFORE saving); a blank field falls back to the saved
 * config. Hits `GET /v1/models` only — no model run, no billing.
 * @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
function handleHermesCheckPost(req, res) {
  /** @type {Buffer[]} */
  const chunks = [];
  req.on("data", (/** @type {Buffer} */ c) => {
    chunks.push(c);
  });
  req.on("end", () => {
    let body = /** @type {{ apiUrl?: string, apiKey?: string }} */ ({});
    try {
      body = /** @type {{ apiUrl?: string, apiKey?: string }} */ (
        parseJSON(Buffer.concat(chunks).toString("utf8") || "{}")
      );
    } catch {
      /* empty/invalid body — fall back to saved config */
    }
    const saved = getHermesConfig();
    // A blank typed field (empty string) → fall back to the saved value.
    const cfg = {
      apiUrl: typedOr(body.apiUrl, saved.apiUrl),
      apiKey: typedOr(body.apiKey, saved.apiKey),
    };
    checkHermes(cfg)
      .then((result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      })
      .catch((e) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            reachable: false,
            authOk: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      });
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
};

/** POST endpoints: url → handler. Keeps the request dispatcher under the complexity
 * cap by replacing N if-branches with a single lookup (mirrors GET_ROUTES).
 * @type {Record<string, (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void>} */
const POST_ROUTES = {
  "/api/transcript": handleTranscriptPost,
  "/api/asset": handleAssetPost,
  "/api/level": handleLevelPost,
  "/api/settings": handleSettingsPost,
  "/api/hermes/check": handleHermesCheckPost,
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
  const postRoute = POST_ROUTES[url];
  if (req.method === "POST" && postRoute) {
    postRoute(req, res);
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server });
wss.on("connection", handleConnection);

/** What runs once the server is actually listening. */
function onListening() {
  console.log(`UI on http://localhost:${PORT} — project: ${PROJECT_DIR}`);
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
