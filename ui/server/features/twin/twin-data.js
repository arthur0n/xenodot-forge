// twin-data.js — the twin-data relay seam. Pipes ONE upstream data source (a plant bridge, an
// MQTT→WS bridge, or the project's own seeded tools/sim/server.js) to every browser/viewer client on
// the WebSocket path `/twin-data`, with fan-out and reconnect-to-source.
//
// Why a relay and not a direct connection: the real source is usually singular, authenticated,
// and rate-limited (one plant gateway), while viewers come and go. The relay holds ONE upstream
// connection and fans its frames out to N downstream clients, reconnecting to the source on drop
// without the viewers noticing. The `getSourceUrl` seam is read FRESH per (re)connect (like
// getCodexConfig), so pointing the relay at a new source takes effect on the next reconnect with
// no server restart.
//
// v1 scope: the upstream is a WebSocket URL. There is NO MQTT/OPC-UA dependency here — a protocol
// bridge (e.g. mqtt→ws) plugs in behind `sourceUrl`, and that is the ONLY seam it needs. The
// browser side is unchanged: clients just open ws://<host>/twin-data and read the same JSON frames
// the DataBus expects.
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { parseJSON } from "../../../lib/json.js";
import { CONFIG_FILE } from "../../core/config.js";

/** The WebSocket path the relay owns. A connection on any other path is left to the session WS. */
export const TWIN_DATA_PATH = "/twin-data";

const DEFAULT_RECONNECT_MS = 1500;

/** The downstream (browser/viewer) socket surface the relay drives. `ws`'s WebSocket satisfies it.
 * @typedef {{ send: (data: import("ws").RawData | string) => void, readyState: number, on: (ev: string, cb: () => void) => void }} DownstreamClient */
/** The upstream (source) socket surface the relay drives — a minimal structural type so a real
 * `ws` WebSocket AND an in-process test fake both satisfy it.
 * @typedef {{ on: (ev: string, cb: (data?: import("ws").RawData) => void) => void, close: () => void }} UpstreamSocket */

/** Effective twin config, resolved fresh on every call (env `TWIN_SOURCE_URL` → `.xenodot.json`
 * `twin` block → none), so switching the source from the CLI/UI takes effect WITHOUT a restart
 * (the relay re-reads it on the next reconnect). Mirrors getCodexConfig's live-read contract.
 * @returns {{ sourceUrl: string | null }} */
export function getTwinConfig() {
  /** @type {{ sourceUrl?: string }} */
  let saved = {};
  try {
    saved =
      /** @type {{ twin?: { sourceUrl?: string } }} */ (
        parseJSON(readFileSync(CONFIG_FILE, "utf8"))
      ).twin ?? {};
  } catch {
    /* absent/invalid — treat as no saved block */
  }
  const env = process.env.TWIN_SOURCE_URL;
  return { sourceUrl: env ?? saved.sourceUrl ?? null };
}

/** Is this upgrade request for the relay's path? Strips any query string. Exported so the
 * session-WS registration in core/index.js can decline these sockets.
 * @param {{ url?: string }} req */
export function isTwinDataPath(req) {
  const path = (req.url ?? "").split("?")[0];
  return path === TWIN_DATA_PATH;
}

/** A pure, transport-agnostic relay: one upstream source multiplexed to many downstream clients,
 * with reconnect-to-source. The upstream is created by the injected `connect(url)` (defaults to a
 * real `ws` client) so the reconnect state machine and fan-out are unit-testable with in-process
 * fakes/pairs. The relay is LAZY: it holds no upstream connection until the first client arrives,
 * and drops it when the last client leaves — a source with no viewers costs nothing.
 *
 * @param {object} [opts]
 * @param {() => (string | null)} [opts.getSourceUrl]  Read fresh per connection attempt.
 * @param {(url: string) => UpstreamSocket} [opts.connect]  Upstream factory (test seam).
 * @param {number} [opts.reconnectDelayMs]
 * @param {(msg: string) => void} [opts.log]
 */
export function makeTwinRelay({
  getSourceUrl = () => null,
  connect = (url) => new WebSocket(url),
  reconnectDelayMs = DEFAULT_RECONNECT_MS,
  log = () => {},
} = {}) {
  /** @type {Set<DownstreamClient>} */
  const clients = new Set();
  /** @type {UpstreamSocket | null} */
  let source = null;
  /** @type {"idle" | "connecting" | "open" | "reconnecting" | "stopped"} */
  let state = "idle";
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  let stopped = false;

  /** Send one upstream frame to every downstream client whose socket is open.
   * @param {import("ws").RawData} data */
  function fanout(data) {
    for (const c of clients) {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer || clients.size === 0) return;
    state = "reconnecting";
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureSource();
    }, reconnectDelayMs);
  }

  function ensureSource() {
    if (stopped || source || clients.size === 0) return;
    const url = getSourceUrl();
    if (!url) {
      log("twin-relay: no sourceUrl configured — nothing to relay");
      return;
    }
    state = "connecting";
    const ws = connect(url);
    source = ws;
    ws.on("open", () => {
      state = "open";
      log(`twin-relay: source open ${url}`);
    });
    ws.on("message", (data) => {
      if (data !== undefined) fanout(data);
    });
    ws.on("error", () => {
      /* an error is always followed by close — handle teardown there */
    });
    ws.on("close", () => {
      if (stopped) return; // stop() owns the final state — don't flip it back to idle
      source = null;
      if (clients.size > 0) scheduleReconnect();
      else state = "idle";
    });
  }

  return {
    /** Register a downstream client and start (or keep) the upstream connection.
     * @param {DownstreamClient & { on: (ev: string, cb: () => void) => void }} ws */
    addClient(ws) {
      clients.add(ws);
      ws.on("close", () => {
        clients.delete(ws);
        if (clients.size === 0 && source) {
          source.close();
          source = null;
          state = "idle";
        }
      });
      ensureSource();
    },
    /** Tear the relay down: stop reconnecting and drop the upstream. Idempotent. */
    stop() {
      stopped = true;
      state = "stopped";
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (source) {
        source.close();
        source = null;
      }
    },
    get state() {
      return state;
    },
    get clientCount() {
      return clients.size;
    },
  };
}

/** Wire a twin-data relay onto the EXISTING session WebSocketServer (the same `wss` that serves
 * Claude sessions). Rather than a second WSS + upgrade routing, we add a `connection` listener
 * that CLAIMS only `/twin-data` sockets (core/index.js's session listener declines those via
 * isTwinDataPath) — the simplest form of "a second path on one WebSocketServer". Returns the relay
 * so the caller can stop() it on shutdown.
 * @param {import("ws").WebSocketServer} wss
 * @param {{ getSourceUrl?: () => (string | null), connect?: (url: string) => import("ws").WebSocket, reconnectDelayMs?: number, log?: (m: string) => void }} [opts]
 */
export function registerTwinRelay(wss, opts = {}) {
  const relay = makeTwinRelay({
    getSourceUrl: opts.getSourceUrl ?? (() => getTwinConfig().sourceUrl),
    connect: opts.connect,
    reconnectDelayMs: opts.reconnectDelayMs,
    log:
      opts.log ??
      ((m) => {
        console.log(m);
      }),
  });
  wss.on("connection", (ws, req) => {
    if (isTwinDataPath(req)) relay.addClient(ws);
  });
  return relay;
}
