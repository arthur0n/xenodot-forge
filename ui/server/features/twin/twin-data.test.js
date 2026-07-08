// node:test coverage for the twin-data relay seams: frame fan-out to downstream clients, the
// reconnect-to-source state machine, laziness (no clients ⇒ no upstream), and a live in-process
// loop (real ws source → registerTwinRelay → real ws client). Pure seams use in-process fakes so
// there is no network flakiness; the one live test uses ephemeral localhost ports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { makeTwinRelay, registerTwinRelay, isTwinDataPath, TWIN_DATA_PATH } from "./twin-data.js";

/** A fake upstream/downstream socket: an EventEmitter plus the WebSocket surface the relay uses
 * (send / readyState / close). readyState defaults to OPEN (1). */
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1; // WebSocket.OPEN
    /** @type {import("ws").RawData[]} */
    this.sent = [];
    this.closed = false;
  }
  /** @param {import("ws").RawData | string} data */
  send(data) {
    this.sent.push(/** @type {import("ws").RawData} */ (data));
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}

/** @param {number} ms */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

test("isTwinDataPath: matches /twin-data (with or without query), rejects others", () => {
  assert.equal(isTwinDataPath({ url: TWIN_DATA_PATH }), true);
  assert.equal(isTwinDataPath({ url: "/twin-data?token=abc" }), true);
  assert.equal(isTwinDataPath({ url: "/" }), false);
  assert.equal(isTwinDataPath({}), false);
});

test("fan-out: an upstream frame reaches every OPEN client, skips a closed one", () => {
  const source = new FakeSocket();
  const relay = makeTwinRelay({ getSourceUrl: () => "ws://source", connect: () => source });
  const a = new FakeSocket();
  const b = new FakeSocket();
  const gone = new FakeSocket();
  relay.addClient(a);
  relay.addClient(b);
  relay.addClient(gone);
  gone.readyState = 3; // CLOSED
  source.emit("open");
  source.emit("message", "FRAME-1");
  source.emit("message", "FRAME-2");
  assert.deepEqual(a.sent, ["FRAME-1", "FRAME-2"]);
  assert.deepEqual(b.sent, ["FRAME-1", "FRAME-2"]);
  assert.deepEqual(gone.sent, []);
  assert.equal(relay.state, "open");
});

test("lazy: no upstream until the first client; drops upstream when the last leaves", () => {
  let connects = 0;
  const source = new FakeSocket();
  const relay = makeTwinRelay({
    getSourceUrl: () => "ws://source",
    connect: () => {
      connects++;
      return source;
    },
  });
  assert.equal(connects, 0, "no client yet — no upstream connection");
  const client = new FakeSocket();
  relay.addClient(client);
  assert.equal(connects, 1);
  assert.equal(relay.clientCount, 1);
  client.emit("close"); // last client leaves
  assert.equal(relay.clientCount, 0);
  assert.equal(source.closed, true, "upstream dropped when no clients remain");
  assert.equal(relay.state, "idle");
});

test("reconnect state machine: source drop → reconnecting → reconnect; stop() halts", async () => {
  let connects = 0;
  /** @type {FakeSocket[]} */
  const sources = [];
  const relay = makeTwinRelay({
    getSourceUrl: () => "ws://source",
    connect: () => {
      connects++;
      const s = new FakeSocket();
      sources.push(s);
      return s;
    },
    reconnectDelayMs: 10,
  });
  relay.addClient(new FakeSocket());
  assert.equal(connects, 1);
  const first = sources[0];
  assert.ok(first);
  first.emit("open");
  assert.equal(relay.state, "open");
  first.emit("close"); // upstream dropped while a client is still watching
  assert.equal(relay.state, "reconnecting");
  await delay(25);
  assert.equal(connects, 2, "relay reconnected to the source after the delay");
  relay.stop();
  assert.equal(relay.state, "stopped");
  // A late close from the (now-stopped) source must not schedule another reconnect.
  const second = sources[1];
  assert.ok(second);
  second.emit("close");
  await delay(25);
  assert.equal(connects, 2);
  assert.equal(relay.state, "stopped");
});

test("no sourceUrl configured: relay stays idle, never connects", () => {
  let connects = 0;
  const relay = makeTwinRelay({
    getSourceUrl: () => null,
    connect: () => {
      connects++;
      return new FakeSocket();
    },
  });
  relay.addClient(new FakeSocket());
  assert.equal(connects, 0);
  assert.equal(relay.state, "idle"); // attempted, found no URL, stayed idle
});

test("live loop: real ws source → registerTwinRelay → real ws client sees the frames", async () => {
  // 1) An in-process ws server standing in for the plant/sim source.
  const sourceServer = new WebSocketServer({ port: 0 });
  await new Promise((r) => {
    sourceServer.on("listening", () => {
      r(undefined);
    });
  });
  const sourcePort = /** @type {import("node:net").AddressInfo} */ (sourceServer.address()).port;
  sourceServer.on("connection", (ws) => {
    ws.send(JSON.stringify({ tag: "pump_1.temp", value: 55.5, seq: 0, sent_ms: Date.now() }));
    ws.send(JSON.stringify({ tag: "pump_1.temp", value: 56.1, seq: 1, sent_ms: Date.now() }));
  });

  // 2) The HTTP server + shared WebSocketServer the relay registers onto.
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const relay = registerTwinRelay(wss, {
    getSourceUrl: () => `ws://localhost:${sourcePort}`,
    reconnectDelayMs: 50,
    log: () => {},
  });
  await new Promise((r) => {
    httpServer.listen(0, () => {
      r(undefined);
    });
  });
  const relayPort = /** @type {import("node:net").AddressInfo} */ (httpServer.address()).port;

  // 3) A real browser-style client on /twin-data collects the fanned-out frames.
  const client = new WebSocket(`ws://localhost:${relayPort}${TWIN_DATA_PATH}`);
  /** @type {{ tag: string, seq: number, value: number }[]} */
  const seen = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("no frames within 2s"));
    }, 2000);
    client.on("message", (data) => {
      seen.push(
        /** @type {{ tag: string, seq: number, value: number }} */ (parseFrame(rawToString(data))),
      );
      if (seen.length === 2) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    client.on("error", reject);
  });

  assert.equal(seen.length, 2);
  const f0 = seen[0];
  const f1 = seen[1];
  assert.ok(f0 && f1);
  assert.equal(f0.tag, "pump_1.temp");
  assert.equal(f0.seq, 0);
  assert.equal(f1.seq, 1);

  relay.stop();
  client.close();
  await new Promise((r) => {
    wss.close(() => {
      r(undefined);
    });
  });
  await new Promise((r) => {
    httpServer.close(() => {
      r(undefined);
    });
  });
  await new Promise((r) => {
    sourceServer.close(() => {
      r(undefined);
    });
  });
});

/** Normalize a ws RawData payload to a UTF-8 string (avoids base-to-string on ArrayBuffer/Buffer[]).
 * @param {import("ws").RawData} data @returns {string} */
function rawToString(data) {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** JSON.parse with an unknown return, so callers cast explicitly (keeps no-unsafe-* happy).
 * @param {string} text @returns {unknown} */
function parseFrame(text) {
  return JSON.parse(text);
}
