// tools/sim/record.js — recording tooling for the twin data stream: deterministic fixture
// generation + a live-source recorder. One CLI, two modes, ONE output contract (recording.js).
//
//   Fixture (no network — pure synthesis):
//     node tools/sim/record.js --out fixture.ndjson --seconds 30 [--seed 42] [--hz 10] [--map binding_map.json]
//   Live capture (WebSocket client):
//     node tools/sim/record.js --out capture.ndjson --url ws://localhost:8765 [--seconds 30]
//
// Fixture mode synthesizes the EXACT stream the sim (server.js) would send — same tagValue,
// same tag-table derivation (stream.js, the shared single source), t_ms = tick * 1000/hz —
// straight to file. Same seed+args ⇒ byte-identical file: the Phase-4 playback gate hashes
// fixtures, so reproducibility is the whole point of this path.
//
// Live mode connects as an RFC 6455 CLIENT (masked frames per §5.3, §4.1 handshake with §4.2.2
// Accept validation — protocol.js), stamps t_ms relative to the first frame on a MONOTONIC
// clock, and accumulates the header from observation: hz is derived from the inter-tick cadence,
// seed is SEED_RECORDED (-1: "recorded, not synthesized" — recording.js), and each tag's
// min/max is the observed value range. There is no subscribe message on the wire — the sim
// broadcasts to every connected client, so connecting IS subscribing. --seconds bounds the
// capture; SIGINT flushes what was captured and prints the same summary.
//
// Dependency-free by design: the materialized tools/ ships no package.json, so this must run
// under a bare `node` (see server.js's header for the full rationale).
import net from "node:net";
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";
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
  WS_PROTOCOL_VERSION,
  HTTP_SWITCHING_PROTOCOLS,
  FIN_PONG_FRAME,
  FIN_CLOSE_FRAME,
  OPCODE_TEXT,
  OPCODE_CLOSE,
  OPCODE_PING,
  makeSecWebSocketKey,
  secWebSocketAccept,
  encodeClientFrame,
  decodeFrames,
} from "./protocol.js";
import { SEED_RECORDED, headerLine, frameLine } from "./recording.js";

/** Nanoseconds per millisecond. t_ms is stamped from process.hrtime.bigint() (nanoseconds,
 * MONOTONIC) rather than Date.now(): a wall-clock step (NTP slew, DST) could make t_ms go
 * backwards and break the contract's "frames ordered by t_ms ascending". */
const NS_PER_MS = 1_000_000;

/** Tolerance for snapping the observed rate to an integer hz: accept the nearest integer when
 * the raw estimate is within 10 % of it, warn beyond. Why 10 %: a fixed-rate source (the sim's
 * setInterval at 100 ms/tick) jitters a few ms per tick on a loaded machine — well under 10 % —
 * while a genuinely different rate (e.g. 12 Hz read as 10) misses by more, so the warning fires
 * only when the source likely isn't the fixed rate the header claims. */
const HZ_SNAP_TOLERANCE = 0.1;

/** Bytes of the close-frame status code (the first 2 payload bytes, UInt16BE). RFC 6455 §5.5.1. */
const CLOSE_CODE_BYTES = 2;

/** Close status 1000 "normal closure" — the recorder is done, nothing went wrong.
 * RFC 6455 §7.4.1. */
const CLOSE_CODE_NORMAL = 1000;

/** Grace (ms) between sending our masked close frame and destroying the socket: long enough for
 * the server's close/FIN to land (loopback RTT is sub-ms; 250 ms is generous), short enough that
 * a dead peer can't stall the flush. Mirrors the sim's SHUTDOWN_BACKSTOP_MS idea (server.js). */
const CLOSE_GRACE_MS = 250;

/** Connect + handshake deadline (ms). A live source answers the upgrade in one RTT; 5 s fails
 * fast on a wrong host/port instead of hanging the recorder (and any gate driving it). */
const CONNECT_TIMEOUT_MS = 5000;

/** Process exit status for any failure (bad args, refused connection, bad handshake) —
 * conventional POSIX nonzero; gates only distinguish zero from nonzero. */
const EXIT_FAILURE = 1;

/** End-of-headers marker of an HTTP/1.1 message (RFC 9112 §2.1) — everything after it in the
 * upgrade response already belongs to the WebSocket frame stream. */
const HTTP_HEADER_END = "\r\n\r\n";

/** Print the mandatory one-line result summary. `durationMs` is the t_ms of the last frame
 * (0 for a single-tick file), `sha256` the hash of the exact bytes written.
 * @param {string} out @param {number} frames @param {number} durationMs @param {number} tagCount
 * @param {string} sha256 */
function printSummary(out, frames, durationMs, tagCount, sha256) {
  console.log(
    `record: wrote ${out} — frames=${frames} duration_ms=${durationMs} tags=${tagCount} sha256=${sha256}`,
  );
}

/** Write header + frame lines as NDJSON and return the file's sha256 (node:crypto).
 * @param {string} out @param {string} header @param {string[]} frameLines @returns {string} */
function writeRecording(out, header, frameLines) {
  const body = [header, ...frameLines].join("\n") + "\n";
  writeFileSync(out, body);
  return crypto.createHash("sha256").update(body).digest("hex");
}

/** Fixture mode: synthesize the exact stream the sim would send, straight to file. Pure —
 * no clock, no network — so same args ⇒ byte-identical output.
 * @param {{ out: string, seconds: number, seed: number, hz: number, map: string | undefined }} o
 * @returns {void} */
function synthesize(o) {
  const tags = tagsFromMap(o.map);
  const totalTicks = Math.round(o.seconds * o.hz); // ticks the sim would fire in `seconds`
  /** @type {string[]} */
  const lines = [];
  let lastTms = 0;
  for (let tick = 0; tick < totalTicks; tick++) {
    // Same schedule as the sim's setInterval: one tick every 1000/hz ms, tick 0 at t=0.
    const tMs = Math.round((tick * MS_PER_SEC) / o.hz);
    lastTms = tMs;
    for (let i = 0; i < tags.length; i++) {
      const row = tags[i];
      if (!row) continue;
      const value = tagValue(o.seed, tick, i, tags.length, row.min, row.max);
      // seq = tick, exactly as server.js stamps every tag frame of a tick.
      lines.push(frameLine({ t_ms: tMs, tag: row.tag, value, seq: tick }));
    }
  }
  const sha = writeRecording(o.out, headerLine(o.hz, o.seed, tags), lines);
  printSummary(o.out, lines.length, lastTms, tags.length, sha);
}

/** One live frame as parsed off the wire, or null if the payload isn't a valid sim tag frame.
 * `JSON.parse` is `any`; laundering through `unknown` + runtime narrowing keeps this free of
 * unchecked `any` under strict checkJs (same pattern as stream.js's bindingsOf).
 * @param {string} text @returns {{ tag: string, value: number, seq: number } | null} */
function parseWireFrame(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = /** @type {unknown} */ (JSON.parse(text));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const f = /** @type {{ tag?: unknown, value?: unknown, seq?: unknown }} */ (parsed);
  if (typeof f.tag !== "string" || typeof f.value !== "number" || typeof f.seq !== "number") {
    return null;
  }
  return { tag: f.tag, value: f.value, seq: f.seq };
}

/** Everything the live capture accumulates before the file can be written (the header depends
 * on observation, so frames buffer in memory — fine: --seconds bounds the run). */
/** @typedef {{
 *   frames: import("./recording.js").RecordingFrame[],
 *   range: Map<string, { min: number, max: number }>,
 *   seqArrival: Map<number, number>,
 * }} Capture */

/** Fold one wire frame into the capture: stamp t_ms, extend the tag's observed range, note the
 * first arrival of its seq (for hz derivation).
 * @param {Capture} cap @param {{ tag: string, value: number, seq: number }} f
 * @param {number} tMs @returns {void} */
function foldFrame(cap, f, tMs) {
  cap.frames.push({ t_ms: tMs, tag: f.tag, value: f.value, seq: f.seq });
  const r = cap.range.get(f.tag);
  if (r === undefined) {
    cap.range.set(f.tag, { min: f.value, max: f.value });
  } else {
    r.min = Math.min(r.min, f.value);
    r.max = Math.max(r.max, f.value);
  }
  if (!cap.seqArrival.has(f.seq)) cap.seqArrival.set(f.seq, tMs);
}

/** Derive the integer header hz from the observed inter-tick cadence: mean ms between the first
 * frames of the first and last observed seq (seq deltas handle dropped ticks), snapped to the
 * nearest integer within HZ_SNAP_TOLERANCE (warned beyond). Under 2 observed ticks there is no
 * cadence — fall back to DEFAULT_HZ, loudly.
 * @param {Map<number, number>} seqArrival @returns {number} */
function deriveHz(seqArrival) {
  const seqs = [...seqArrival.keys()]; // insertion order = arrival order (ascending)
  const first = seqs[0];
  const last = seqs[seqs.length - 1];
  if (first === undefined || last === undefined || last === first) {
    console.warn(`record: fewer than 2 observed ticks — header hz falls back to ${DEFAULT_HZ}`);
    return DEFAULT_HZ;
  }
  const spanMs = (seqArrival.get(last) ?? 0) - (seqArrival.get(first) ?? 0);
  const rawHz = (MS_PER_SEC * (last - first)) / spanMs;
  const hz = Math.max(1, Math.round(rawHz)); // header hz is a positive int per the contract
  if (Math.abs(rawHz - hz) / hz > HZ_SNAP_TOLERANCE) {
    console.warn(
      `record: observed rate ${rawHz.toFixed(3)} Hz is >${HZ_SNAP_TOLERANCE * 100}% off ` +
        `the rounded ${hz} Hz — the source may not be fixed-rate`,
    );
  }
  console.log(`record: observed cadence ${rawHz.toFixed(3)} Hz → header hz=${hz}`);
  return hz;
}

/** Flush a live capture to disk: derive the header from observation, write, summarize.
 * @param {Capture} cap @param {string} out @returns {void} */
function flushCapture(cap, out) {
  const hz = deriveHz(cap.seqArrival);
  const tags = [...cap.range.entries()].map(([tag, r]) => ({ tag, min: r.min, max: r.max }));
  const lastFrame = cap.frames[cap.frames.length - 1];
  const sha = writeRecording(out, headerLine(hz, SEED_RECORDED, tags), cap.frames.map(frameLine));
  printSummary(out, cap.frames.length, lastFrame?.t_ms ?? 0, tags.length, sha);
}

/** The client half of the RFC 6455 opening handshake over a raw TCP socket: send the §4.1
 * upgrade request, buffer until the response headers end, validate 101 + the §4.2.2 Accept.
 * Any bytes after the headers are already frames — they're handed to `onOpen(remainder)`.
 * @param {import("node:net").Socket} socket @param {URL} u
 * @param {(err: string) => void} fail @param {(remainder: Buffer) => void} onOpen
 * @returns {(chunk: Buffer) => void} the data handler for the handshake phase */
function clientHandshake(socket, u, fail, onOpen) {
  const key = makeSecWebSocketKey();
  const expectedAccept = secWebSocketAccept(key); // §4.1 step 4: validate or fail the connection
  socket.write(
    `GET ${u.pathname || "/"} HTTP/1.1\r\n` +
      `Host: ${u.hostname}:${u.port || DEFAULT_PORT}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: ${WS_PROTOCOL_VERSION}\r\n\r\n`,
  );
  let rx = Buffer.alloc(0);
  let done = false;
  return (chunk) => {
    if (done) return;
    rx = Buffer.concat([rx, chunk]);
    const end = rx.indexOf(HTTP_HEADER_END);
    if (end === -1) return;
    done = true;
    const head = rx.subarray(0, end).toString("utf8");
    const statusLine = head.split("\r\n")[0] ?? "";
    if (!statusLine.includes(` ${HTTP_SWITCHING_PROTOCOLS} `)) {
      fail(`handshake refused: '${statusLine}'`);
      return;
    }
    const acceptMatch = /^sec-websocket-accept:\s*(\S+)\s*$/im.exec(head);
    if (acceptMatch?.[1] !== expectedAccept) {
      fail("handshake failed: Sec-WebSocket-Accept mismatch (RFC 6455 §4.2.2)");
      return;
    }
    onOpen(rx.subarray(end + HTTP_HEADER_END.length));
  };
}

/** Live mode: record a WebSocket source to NDJSON until --seconds elapses or SIGINT.
 * @param {{ out: string, url: string, seconds: number | null }} o @returns {void} */
function recordLive(o) {
  const u = new URL(o.url);
  if (u.protocol !== "ws:") {
    console.error(`record: only ws:// sources are supported (got '${u.protocol}//')`);
    process.exit(EXIT_FAILURE);
  }
  /** @type {Capture} */
  const cap = { frames: [], range: new Map(), seqArrival: new Map() };
  /** @type {bigint | null} */
  let t0 = null; // monotonic origin: set at the FIRST accepted frame (contract: t_ms relative to it)
  let finished = false;
  const socket = net.connect({ host: u.hostname, port: Number(u.port || DEFAULT_PORT) });
  socket.setTimeout(CONNECT_TIMEOUT_MS);

  /** @param {string} msg @returns {void} */
  const fail = (msg) => {
    console.error(`record: ${msg}`);
    socket.destroy();
    process.exit(EXIT_FAILURE);
  };
  /** Flush + clean close (masked close frame per §5.3/§5.5.1, then a bounded grace).
   * @returns {void} */
  const finish = () => {
    if (finished) return;
    finished = true;
    if (cap.frames.length === 0) {
      console.error("record: no frames captured — nothing written");
      socket.destroy();
      process.exit(EXIT_FAILURE);
    }
    flushCapture(cap, o.out);
    const code = Buffer.alloc(CLOSE_CODE_BYTES);
    code.writeUInt16BE(CLOSE_CODE_NORMAL, 0); // status code = first 2 payload bytes (§5.5.1)
    socket.write(encodeClientFrame(FIN_CLOSE_FRAME, code));
    socket.end();
    setTimeout(() => {
      socket.destroy();
      process.exit(0);
    }, CLOSE_GRACE_MS).unref();
  };

  /** @type {Buffer} */
  let rx = Buffer.alloc(0);
  /** @param {Buffer} chunk @returns {void} */
  const pumpFrames = (chunk) => {
    const { frames, rest } = decodeFrames(Buffer.concat([rx, chunk]));
    rx = rest;
    for (const wsf of frames) {
      if (wsf.opcode === OPCODE_CLOSE) {
        console.warn("record: source closed the connection — flushing what was captured");
        finish();
        return;
      }
      if (wsf.opcode === OPCODE_PING) {
        socket.write(encodeClientFrame(FIN_PONG_FRAME, wsf.payload)); // client pongs are masked too (§5.3)
        continue;
      }
      if (wsf.opcode !== OPCODE_TEXT) continue;
      const f = parseWireFrame(wsf.payload.toString("utf8"));
      if (f === null) continue; // non-tag traffic: ignore, keep recording
      const now = process.hrtime.bigint();
      t0 ??= now;
      foldFrame(cap, f, Number((now - t0) / BigInt(NS_PER_MS)));
    }
  };

  let onData = clientHandshake(socket, u, fail, (remainder) => {
    socket.setTimeout(0); // handshake deadline no longer applies; --seconds/SIGINT bound the run
    socket.setNoDelay(true);
    onData = pumpFrames;
    console.log(
      `record: connected to ${o.url} — recording${o.seconds ? ` for ${o.seconds}s` : " until SIGINT"}`,
    );
    if (o.seconds !== null) setTimeout(finish, o.seconds * MS_PER_SEC).unref();
    if (remainder.length > 0) pumpFrames(remainder);
  });
  socket.on("data", (chunk) => {
    onData(/** @type {Buffer} */ (chunk));
  });
  socket.on("timeout", () => {
    fail(`no handshake within ${CONNECT_TIMEOUT_MS}ms`);
  });
  socket.on("error", (e) => {
    if (!finished) fail(e.message);
  });
  socket.on("close", () => {
    if (!finished) {
      console.warn("record: connection dropped — flushing what was captured");
      finish();
    }
  });
  process.on("SIGINT", finish);
  process.on("SIGTERM", finish);
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error(
    "usage: record.js --out <file.ndjson> --seconds N [--seed S] [--hz H] [--map M]  (fixture)\n" +
      "       record.js --out <file.ndjson> --url ws://host:port [--seconds N]        (live)",
  );
  process.exit(EXIT_FAILURE);
}
if (args.url) {
  if (args.seed !== undefined || args.map !== undefined || args.hz !== undefined) {
    console.warn(
      "record: --seed/--hz/--map are synthesis flags — ignored with --url (observed instead)",
    );
  }
  recordLive({
    out: args.out,
    url: args.url,
    seconds: args.seconds === undefined ? null : Number(args.seconds),
  });
} else {
  const seconds = Number(args.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.error("record: fixture mode needs --seconds > 0 (how much stream to synthesize)");
    process.exit(EXIT_FAILURE);
  }
  synthesize({
    out: args.out,
    seconds,
    seed: Number(args.seed ?? DEFAULT_SEED) | 0, // same coercion as server.js — same seed space
    hz: Number(args.hz ?? DEFAULT_HZ),
    map: args.map,
  });
}
