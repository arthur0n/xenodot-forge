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
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// --- WebSocket handshake (RFC 6455 §1.3, §4.2.2) ---
/** The magic GUID a server concatenates to the client's Sec-WebSocket-Key before SHA-1 + base64 to
 * form Sec-WebSocket-Accept. Fixed by RFC 6455 §1.3 — not a choice. */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// --- CLI defaults (cross-file contract — see the paired doc comments) ---
/** Default WebSocket port. The viewer's DataBus default URL (starter-viewer/core/data_bus.gd
 * DEFAULT_URL = "ws://localhost:8765") points here, so a sim started with no --port pairs with a
 * default viewer out of the box. The verify_twin.sh gate deliberately runs its OWN sim on 8899
 * instead, to avoid colliding with a sim a developer may already have on 8765. */
const DEFAULT_PORT = 8765;

/** Default publish rate in Hz. smoke_binding.gd's STREAM_HZ MUST equal this: the smoke converts
 * --frames=N to seconds as N/STREAM_HZ, so any drift desynchronizes its frame->time math. */
const DEFAULT_HZ = 10;

/** Default PRNG seed. Any fixed integer works — the only contract is that a given seed replays
 * bit-for-bit. 42 is the conventional "arbitrary but fixed" seed; verify_twin.sh passes it
 * explicitly so the gate's expectations never depend on this default. */
const DEFAULT_SEED = 42;

/** Milliseconds per second — the setInterval period is 1000/hz. */
const MS_PER_SEC = 1000;

// --- value synthesis tuning (tagValue) ---
/** Period of the value sine, in ticks. 100 ticks = 10 s of sim time at DEFAULT_HZ (10 Hz): one
 * full oscillation per ~10 s reads as a calm, legible demo cadence — fast enough to see motion in
 * an ~8 s smoke, slow enough not to strobe. */
const PERIOD_TICKS = 100;

/** Fraction of the half-range the smooth sine spans. AMP_SHARE + JITTER_SHARE = 1.0 keeps
 * mid ± halfRange*(share*wave + share*jitter) inside [min,max] BEFORE the final clamp, so the clamp
 * is a safety net, not the primary limiter (values don't pile up on the rails). */
const AMP_SHARE = 0.85;

/** Fraction of the half-range given to seeded jitter. 15 % reads as live flicker on top of the
 * sine without swamping it; AMP_SHARE + JITTER_SHARE = 1.0 (see AMP_SHARE). */
const JITTER_SHARE = 0.15;

/** Weyl / golden-ratio avalanche multiplier (2^32/φ, odd), applied to the tag index. Conventional
 * bit-mixing constant for hashing an integer into a well-mixed 32-bit word; the exact value is
 * arbitrary-but-fixed (any odd constant with good diffusion works) and part of the determinism
 * contract — changing it changes every value. */
const MIX_INDEX = 0x9e3779b1;

/** murmur3-derived avalanche multiplier, applied to the tick so index and tick diffuse into
 * different bit patterns. Arbitrary-but-fixed like MIX_INDEX (determinism contract). */
const MIX_TICK = 0x85ebca6b;

// --- RFC 6455 framing constants (server->client frames + just-enough client-frame parsing) ---
/** FIN(0x80) | opcode 0x1 (text): a complete, unfragmented text frame — every data frame the sim
 * sends. RFC 6455 §5.2 (framing), §5.6 (text). */
const FIN_TEXT_FRAME = 0x81;

/** FIN(0x80) | opcode 0xA (pong): a complete pong control frame. RFC 6455 §5.5.3. */
const FIN_PONG_FRAME = 0x8a;

/** Low nibble of byte 0 = opcode. RFC 6455 §5.2. */
const OPCODE_MASK = 0x0f;

/** Opcode 0x8 = connection close. RFC 6455 §5.5.1. */
const OPCODE_CLOSE = 0x8;

/** Opcode 0x9 = ping (we answer with a pong). RFC 6455 §5.5.2. */
const OPCODE_PING = 0x9;

/** High bit of byte 1 = MASK. Clients MUST mask; servers MUST NOT. RFC 6455 §5.2, §5.3. */
const MASK_BIT = 0x80;

/** Low 7 bits of byte 1 = payload length, or a 126/127 escape. RFC 6455 §5.2. */
const PAYLOAD_LEN_MASK = 0x7f;

/** Payload-length escape 126: the real length is the next 2 bytes (UInt16BE). RFC 6455 §5.2. */
const LEN_16BIT_MARKER = 126;

/** Payload-length escape 127: the real length is the next 8 bytes (UInt64BE). RFC 6455 §5.2. */
const LEN_64BIT_MARKER = 127;

/** Masking-key length in bytes when MASK is set. RFC 6455 §5.3. */
const MASK_KEY_BYTES = 4;

/** Bytes of a UInt32 field — the 64-bit extended length is written as two of these. */
const UINT32_BYTES = 4;

/** Header size (bytes) when the length fits the 7-bit field (< 126): byte0 + byte1. Also the
 * minimum bytes needed before a frame header can be parsed at all. */
const HEADER_SHORT_BYTES = 2;

/** Header size (bytes) with the 16-bit extended length: byte0 + byte1 + UInt16. */
const HEADER_16BIT_BYTES = 4;

/** Header size (bytes) with the 64-bit extended length: byte0 + byte1 + UInt64. */
const HEADER_64BIT_BYTES = 10;

/** Byte offset of the extended length within a frame (immediately after byte0+byte1). */
const EXT_LEN_OFFSET = HEADER_SHORT_BYTES;

/** Payloads of this size or larger need the 64-bit length field (the 16-bit field maxes at
 * 2^16 - 1). 2^16 = 65536. RFC 6455 §5.2. */
const MAX_16BIT_PAYLOAD = 1 << 16;

// --- HTTP + shutdown ---
/** 426 Upgrade Required — returned to a plain HTTP GET on this WebSocket-only endpoint. RFC 7231
 * §6.5.15; RFC 6455 §4.1 expects clients to upgrade, not GET. */
const HTTP_UPGRADE_REQUIRED = 426;

/** Grace period (ms) before force-exit if a socket lingers past server.close(). Small enough to
 * keep gate shutdown snappy, long enough that close() normally wins the race first. */
const SHUTDOWN_BACKSTOP_MS = 200;

/** The `--flag` / `--flag=value` prefix; slicing past it yields the flag name. */
const FLAG_PREFIX = "--";

/** One row of the sim's tag table: a tag name and the [min,max] its values span. */
/** @typedef {{ tag: string, min: number, max: number }} TagRow */

/** The built-in demo tag table used when no (readable) --map is supplied. The ranges are the
 * colour-ramp ranges a matching binding map would carry.
 * @type {TagRow[]} */
const DEMO_TAGS = [
  { tag: "pump_1.temp", min: 20, max: 90 },
  { tag: "pump_1.flow", min: 0, max: 100 },
  { tag: "tank_1.level", min: 0, max: 100 },
  { tag: "valve_1.position", min: 0, max: 100 },
  { tag: "motor_1.rpm", min: 0, max: 3000 },
];

/** Parse `--flag value` / `--flag=value` argv into a map.
 * @param {string[]} argv @returns {Record<string, string>} */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (!a.startsWith(FLAG_PREFIX)) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(FLAG_PREFIX.length, eq)] = a.slice(eq + 1);
    } else {
      out[a.slice(FLAG_PREFIX.length)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return out;
}

/** mulberry32 — a tiny, fast, fully deterministic PRNG. Same seed ⇒ same sequence. The literals
 * below (0x6d2b79f5, the 15/7/14 shifts, 61, and the 2^32 = 4294967296 divisor that normalizes to
 * [0,1)) are the PUBLISHED mulberry32 constants — they are the algorithm, not tunable knobs, and
 * changing any of them changes every value (breaks the determinism contract). Left as-is on
 * purpose; naming them individually would only obscure a well-known routine.
 * @param {number} a @returns {() => number} */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A binding map file, as far as the sim reads it: a `bindings` array whose entries may carry a
 * tag name and a [min,max]. Entry fields are `unknown` — the sim validates each at runtime. */
/** @typedef {{ tag?: unknown, min?: unknown, max?: unknown }} RawBinding */

/** Pull the `bindings` list out of a parsed map file, as rows with still-untyped fields (validated
 * per-row by the caller). `JSON.parse` is `any`; laundering it through `unknown` and narrowing at
 * runtime keeps the sim free of unchecked `any` under strict checkJs. Anything that isn't an object
 * with an array `bindings` yields [] → the demo set. @param {unknown} parsed @returns {RawBinding[]} */
function bindingsOf(parsed) {
  if (typeof parsed !== "object" || parsed === null) return [];
  const raw = /** @type {{ bindings?: unknown }} */ (parsed).bindings;
  if (!Array.isArray(raw)) return [];
  // Array.isArray narrows `raw` to any[]; re-view it as unknown[] so each item stays unknown
  // (not any) and must be narrowed before use.
  const list = /** @type {readonly unknown[]} */ (raw);
  /** @type {RawBinding[]} */
  const out = [];
  for (const item of list) {
    if (typeof item === "object" && item !== null) out.push(item);
  }
  return out;
}

/** Derive the tag table from a binding map file, or fall back to DEMO_TAGS. Each row keeps only
 * what the sim needs: tag name + [min,max]. Malformed/absent file ⇒ demo set (logged).
 * @param {string | undefined} mapPath @returns {TagRow[]} */
function tagsFromMap(mapPath) {
  if (!mapPath) return DEMO_TAGS;
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(mapPath, "utf8")));
    const bindings = bindingsOf(parsed);
    /** @type {TagRow[]} */
    const rows = [];
    for (const b of bindings) {
      if (typeof b.tag !== "string") continue;
      const min = Number(b.min);
      const max = Number(b.max);
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      rows.push({ tag: b.tag, min, max });
    }
    if (rows.length === 0) {
      console.warn(`sim: '${mapPath}' has no usable bindings — using the demo tag set`);
      return DEMO_TAGS;
    }
    return rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`sim: could not read map '${mapPath}' (${msg}) — using the demo tag set`);
    return DEMO_TAGS;
  }
}

/** The value for tag `i` (of `count`) at integer `tick`, under `seed`. Pure: depends ONLY on
 * (seed, tick, i, range) — never on wall-clock — so the stream replays bit-for-bit per seed. A
 * smooth per-tag sine (phase-shifted by tag index) plus a small seeded jitter, clamped to range.
 * @param {number} seed @param {number} tick @param {number} i @param {number} count
 * @param {number} min @param {number} max @returns {number} */
function tagValue(seed, tick, i, count, min, max) {
  const mid = (min + max) / 2; // midpoint of the range
  const halfRange = (max - min) / 2; // amplitude available on either side of mid
  const phase = count > 0 ? i / count : 0; // phase-shift each tag across one period
  const wave = Math.sin(2 * Math.PI * (tick / PERIOD_TICKS + phase));
  // +1 on index and tick so tag 0 / tick 0 don't zero their mixing term.
  const rand = mulberry32(
    (seed >>> 0) ^ Math.imul(i + 1, MIX_INDEX) ^ Math.imul(tick + 1, MIX_TICK),
  )();
  const jitter = (rand - 0.5) * halfRange * JITTER_SHARE; // rand-0.5 centres jitter on 0
  const v = mid + halfRange * AMP_SHARE * wave + jitter;
  return Math.max(min, Math.min(max, v));
}

/** Encode a string as a single unmasked WebSocket text frame (FIN + opcode 0x1).
 * @param {string} str @returns {Buffer} */
function encodeTextFrame(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  /** @type {Buffer} */
  let header;
  if (len < LEN_16BIT_MARKER) {
    header = Buffer.from([FIN_TEXT_FRAME, len]);
  } else if (len < MAX_16BIT_PAYLOAD) {
    header = Buffer.alloc(HEADER_16BIT_BYTES);
    header[0] = FIN_TEXT_FRAME;
    header[1] = LEN_16BIT_MARKER;
    header.writeUInt16BE(len, EXT_LEN_OFFSET);
  } else {
    header = Buffer.alloc(HEADER_64BIT_BYTES);
    header[0] = FIN_TEXT_FRAME;
    header[1] = LEN_64BIT_MARKER;
    header.writeUInt32BE(0, EXT_LEN_OFFSET); // high 32 bits (payloads here never reach 2^32)
    header.writeUInt32BE(len, EXT_LEN_OFFSET + UINT32_BYTES); // low 32 bits
  }
  return Buffer.concat([header, payload]);
}

/** Echo a client ping frame back as an unmasked pong (opcode 0x8A). Unmasks the client payload
 * in place if it was masked (clients MUST mask; we MUST NOT). @param {import("node:net").Socket}
 * socket @param {Buffer} buf @param {number} dataStart @param {number} maskStart @param
 * {number} len @param {boolean} masked */
function sendPong(socket, buf, dataStart, maskStart, len, masked) {
  const payload = Buffer.alloc(len);
  for (let j = 0; j < len; j++) {
    // RFC 6455 §5.3 unmask: payload[j] ^ maskKey[j mod 4].
    payload[j] = masked
      ? (buf[dataStart + j] ?? 0) ^ (buf[maskStart + (j % MASK_KEY_BYTES)] ?? 0)
      : (buf[dataStart + j] ?? 0);
  }
  socket.write(Buffer.concat([Buffer.from([FIN_PONG_FRAME, len]), payload]));
}

/** Drain complete frames out of a per-socket buffer, answering pings and honouring close. We
 * never need the client's payload (a data source is write-only), so text/binary frames are
 * consumed and dropped.
 * @param {import("node:net").Socket} socket @param {Buffer} buf
 * @returns {Buffer} the unconsumed remainder. */
function pumpClientFrames(socket, buf) {
  let offset = 0;
  while (buf.length - offset >= HEADER_SHORT_BYTES) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    if (b0 === undefined || b1 === undefined) break;
    const opcode = b0 & OPCODE_MASK;
    const masked = (b1 & MASK_BIT) !== 0;
    let len = b1 & PAYLOAD_LEN_MASK;
    let headerLen = HEADER_SHORT_BYTES;
    if (len === LEN_16BIT_MARKER) {
      if (buf.length - offset < HEADER_16BIT_BYTES) break;
      len = buf.readUInt16BE(offset + EXT_LEN_OFFSET);
      headerLen = HEADER_16BIT_BYTES;
    } else if (len === LEN_64BIT_MARKER) {
      if (buf.length - offset < HEADER_64BIT_BYTES) break;
      len = Number(buf.readBigUInt64BE(offset + EXT_LEN_OFFSET));
      headerLen = HEADER_64BIT_BYTES;
    }
    const maskLen = masked ? MASK_KEY_BYTES : 0;
    if (buf.length - offset < headerLen + maskLen + len) break;
    const maskStart = offset + headerLen;
    const dataStart = maskStart + maskLen;
    if (opcode === OPCODE_CLOSE) {
      socket.end(); // close frame
      return Buffer.alloc(0);
    }
    if (opcode === OPCODE_PING) sendPong(socket, buf, dataStart, maskStart, len, masked);
    offset = dataStart + len;
  }
  return buf.subarray(offset);
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
  const accept = crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
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
