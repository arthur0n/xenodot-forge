// Static file serving for the UI. Files are re-read per request — edit and
// refresh, no restart, no build. Serves anything under ui/ (index.html,
// agent-ui.css, and the client/ + lib/ ES modules) with the right MIME type,
// guarding against path traversal.
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { UI_DIR } from "./config.js";

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const BASE = path.resolve(UI_DIR);

/** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
export function serveStatic(req, res) {
  const url = (req.url ?? "/").split("?")[0] ?? "/";
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const filePath = path.resolve(BASE, rel);
  if (filePath !== BASE && !filePath.startsWith(BASE + path.sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const type = TYPES[path.extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  res.end(readFileSync(filePath));
}
