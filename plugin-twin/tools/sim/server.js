// tools/sim/server.js — the seeded tag simulator: the deterministic test fixture for data binding.
// A WebSocket server that publishes JSON tag frames `{tag, value, seq, sent_ms}` — the exact
// DataBus wire shape (core/data_bus.gd) — at a fixed rate. Values are a pure function of
// (seed, tick, tag): SAME seed ⇒ SAME stream, every run, so the twin-verify binding smoke can
// assert exact expectations instead of flaking.
//
//   node tools/sim/server.js [--seed 42] [--port 8765] [--hz 10] [--map binding_map.json] [--stats out.json]
//
// --map derives the tag list + each tag's [min,max] FROM the binding map itself (the ranges
// double as the colour-ramp ranges), so the sim and the bindings can never drift. With no
// --map (or an unreadable one) it falls back to a built-in 5-tag demo set.
//
// This is PLUGIN CAPABILITY, not starter content: the sim lives in the xenodot-twin plugin
// (plugin-twin/tools/sim/) and is MATERIALIZED into every viewer project at tools/sim/server.js on
// each server start / doctor run (materializeTwinTools). So wire-in-place viewers — an existing
// project.godot, no scaffold copy — get the sim too (had it stayed starter content the binding
// smoke would SKIP there forever), and it can never drift from the plugin. The project keeps only
// DATA (binding_map.json); the capability comes from the plugin. It stays npm-dependency-free by
// design — the materialized tools/ ships no package.json, so it must run under a bare `node`. A
// minimal RFC6455 server built on node's http + crypto (handshake + server→client unmasked text
// frames + just enough client-frame parsing to answer pings and honour close): it speaks only what
// a data source needs — no fragmentation, permessage-deflate, or masked outbound frames. Godot's
// WebSocketPeer and the framework relay (`ws`) both interoperate with it.
//
// The deterministic core (tagValue + tag-table derivation, stream.js) and the RFC 6455 framing
// (protocol.js) are shared with the recorder/fixture generator (record.js) — one source, no
// drift; a synthesized fixture and this live stream must agree bit-for-bit per seed.
import http from "node:http";
import {
  DEFAULT_PORT,
  DEFAULT_HZ,
  DEFAULT_SEED,
  MS_PER_SEC,
  parseArgs,
  tagsFromMap,
  tagValue,
} from "./stream.js";
import {
  FIN_PONG_FRAME,
  OPCODE_CLOSE,
  OPCODE_PING,
  secWebSocketAccept,
  encodeTextFrame,
  encodeServerFrame,
  decodeFrames,
} from "./protocol.js";
import { writeFileSync } from "node:fs";

// --- HTTP + shutdown ---
/** 426 Upgrade Required — returned to a plain HTTP GET on this WebSocket-only endpoint. RFC 7231
 * §6.5.15; RFC 6455 §4.1 expects clients to upgrade, not GET. */
const HTTP_UPGRADE_REQUIRED = 426;

/** Grace period (ms) before force-exit if a socket lingers past server.close(). Small enough to
 * keep gate shutdown snappy, long enough that close() normally wins the race first. */
const SHUTDOWN_BACKSTOP_MS = 200;

/** Answer complete client frames: pong every ping, honour close (end the socket, drop the rest).
 * We never need the client's payload (a data source is write-only), so text/binary frames are
 * consumed and dropped.
 * @param {import("node:net").Socket} socket @param {Buffer} buf
 * @returns {Buffer} the unconsumed remainder. */
function pumpClientFrames(socket, buf) {
  const { frames, rest } = decodeFrames(buf);
  for (const f of frames) {
    if (f.opcode === OPCODE_CLOSE) {
      socket.end(); // close frame
      return Buffer.alloc(0);
    }
    if (f.opcode === OPCODE_PING) socket.write(encodeServerFrame(FIN_PONG_FRAME, f.payload));
  }
  return rest;
}

const args = parseArgs(process.argv.slice(2));
const seed = Number(args.seed ?? DEFAULT_SEED) | 0;
const port = Number(args.port ?? DEFAULT_PORT);
const hz = Number(args.hz ?? DEFAULT_HZ);
const tags = tagsFromMap(args.map);
const statsPath = args.stats;

/** @type {Set<import("node:net").Socket>} */
const clients = new Set();
/** Per-tag total frames sent, for optional stats.json cross-checking.
 * @type {number[]} */
const sent = Array.from({ length: tags.length }, () => 0);
let lastSeq = -1;

const server = http.createServer((_req, res) => {
  res.writeHead(HTTP_UPGRADE_REQUIRED, { "content-type": "text/plain" });
  res.end("Upgrade Required — this is a WebSocket tag source.\n");
});

server.on("upgrade", (req, rawSocket) => {
  const socket = /** @type {import("node:net").Socket} */ (rawSocket);
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${secWebSocketAccept(key)}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  clients.add(socket);
  /** @type {Buffer} */
  let rx = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    rx = pumpClientFrames(socket, Buffer.concat([rx, /** @type {Buffer} */ (chunk)]));
  });
  const drop = () => clients.delete(socket);
  socket.on("close", drop);
  socket.on("error", drop);
});

let tick = 0;
const timer = setInterval(
  () => {
    const seq = tick;
    lastSeq = seq;
    for (let i = 0; i < tags.length; i++) {
      const row = tags[i];
      if (!row) continue;
      const { tag, min, max } = row;
      const value = tagValue(seed, tick, i, tags.length, min, max);
      const frame = encodeTextFrame(JSON.stringify({ tag, value, seq, sent_ms: Date.now() }));
      for (const c of clients) c.write(frame);
      sent[i] = (sent[i] ?? 0) + 1;
    }
    tick++;
  },
  Math.max(1, Math.round(MS_PER_SEC / hz)),
); // >=1 ms floor guards a nonsensical --hz

function writeStats() {
  if (!statsPath) return;
  const perTag = tags.map((t, i) => ({ tag: t.tag, frames_sent: sent[i] ?? 0, last_seq: lastSeq }));
  try {
    writeFileSync(statsPath, JSON.stringify({ seed, hz, tags: perTag }, null, 2) + "\n");
    console.log(`sim: wrote stats → ${statsPath}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`sim: could not write stats '${statsPath}' (${msg})`);
  }
}

function shutdown() {
  clearInterval(timer);
  writeStats();
  for (const c of clients) c.destroy();
  server.close(() => process.exit(0));
  // Backstop: don't hang on a lingering socket.
  setTimeout(() => process.exit(0), SHUTDOWN_BACKSTOP_MS).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(port, () => {
  console.log(
    `sim: seeded tag source on ws://localhost:${port} — seed=${seed} hz=${hz} tags=${tags.length}` +
      (args.map ? ` (from ${args.map})` : " (demo set)"),
  );
});
