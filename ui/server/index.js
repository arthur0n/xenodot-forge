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
} from "./config.js";
import { projectState } from "./project-state.js";
import { recentSessions, deleteSession } from "./transcripts.js";
import { writeTranscript } from "./transcript-write.js";
import { writeAsset, writeAssetFromPath } from "./asset-write.js";
import { writeLevel } from "./level-write.js";
import { listLevels } from "./level-read.js";
import { readTasks } from "./tasks-store.js";
import { serveStatic } from "./static.js";
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
  if (req.method === "POST" && url === "/api/transcript") {
    handleTranscriptPost(req, res);
    return;
  }
  if (req.method === "POST" && url === "/api/asset") {
    handleAssetPost(req, res);
    return;
  }
  if (req.method === "POST" && url === "/api/level") {
    handleLevelPost(req, res);
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server });
wss.on("connection", handleConnection);

server.listen(PORT, () => {
  console.log(`UI on http://localhost:${PORT} — project: ${PROJECT_DIR}`);
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
});
