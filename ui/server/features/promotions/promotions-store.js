// Promotions manifest — the deterministic record of which game-local capabilities
// (tools / skills / agents) have been ASKED to be promoted into the framework
// plugin, so the request survives outside the conversation. Filed by the
// mcp__ui__promote tool, decided (approve/reject) from the UI, and consumed by
// `npm run promote -- --pending` (which moves the files and marks them promoted).
// Pure disk module, same shape as tasks-store: re-read/written per mutation,
// lives next to tasks.json in the game's .xenodot/.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseJSON } from "../../../lib/json.js";
import { PROJECT_DIR } from "../../core/config.js";
import { locate, isGateWired } from "./promote-run.js";

/** @typedef {import("../../../lib/types.js").Promotion} Promotion */

const KINDS = new Set(["tools", "skills", "agents"]);
/** requested → approved → promoted, or requested → rejected. */
const STATUSES = new Set(["requested", "approved", "rejected", "promoted"]);

/** @returns {string} */
const dir = () => path.join(PROJECT_DIR, ".xenodot");
/** @returns {string} */
const file = () => path.join(dir(), "promotions.json");

/** Read the manifest; absent/corrupt → empty list. @returns {Promotion[]} */
export function readPromotions() {
  try {
    const parsed = parseJSON(readFileSync(file(), "utf8"));
    return Array.isArray(parsed) ? /** @type {Promotion[]} */ (parsed) : [];
  } catch {
    return [];
  }
}

/** @param {Promotion[]} list */
function write(list) {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(list, null, 2) + "\n");
}

/** Next `p<n>` id. @param {Promotion[]} list @returns {string} */
function nextId(list) {
  const max = list.reduce((m, p) => {
    const n = Number(String(p.id).replace(/^p/, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `p${max + 1}`;
}

/** File a promotion request (status `requested`). Idempotent on (kind, name) while
 * still open — a duplicate request for an already-pending capability just refreshes
 * its reason rather than stacking. Enforces the local-first ratchet promotion.md states:
 * rejects (throws) a request whose source doesn't exist yet, or whose tool isn't gate-wired.
 * @param {{ kind: string, name: string, reason?: string, by?: string }} req
 * @param {string} now @param {string} [game] @returns {Promotion[]} */
export function addPromotion(req, now, game = PROJECT_DIR) {
  if (!KINDS.has(req.kind) || !req.name) return readPromotions();
  const { src } = locate(req.kind, req.name, game);
  if (!existsSync(src)) {
    throw new Error(
      `${req.kind}/${req.name} not found at ${src} — author it locally as a real, working, ` +
        `gate-wired ${req.kind.replace(/s$/, "")} and prove it in THIS game first, then file.`,
    );
  }
  if (req.kind === "tools" && !isGateWired(req.name, game)) {
    throw new Error(
      `${req.kind}/${req.name} exists at ${src} but isn't gate-wired (no validate.sh/checks.sh ` +
        `reference, and doesn't match the smoke_*/play_*.gd auto-glob) — wire it into the gate ` +
        `and prove it in THIS game first, then file.`,
    );
  }
  const list = readPromotions();
  const open = list.find(
    (p) =>
      p.kind === req.kind &&
      p.name === req.name &&
      (p.status === "requested" || p.status === "approved"),
  );
  if (open) {
    if (req.reason) open.reason = String(req.reason).slice(0, 500);
    write(list);
    return list;
  }
  list.push({
    id: nextId(list),
    kind: /** @type {Promotion["kind"]} */ (req.kind),
    name: String(req.name).slice(0, 120),
    reason: req.reason ? String(req.reason).slice(0, 500) : undefined,
    status: "requested",
    by: req.by ? String(req.by).slice(0, 80) : undefined,
    at: now,
  });
  write(list);
  return list;
}

/** Record a user decision (approve/reject) on a requested promotion.
 * @param {string} id @param {"approved" | "rejected"} decision @param {string} now @returns {Promotion[]} */
export function decide(id, decision, now) {
  if (decision !== "approved" && decision !== "rejected") return readPromotions();
  const list = readPromotions().map((p) =>
    p.id === id && p.status === "requested" ? { ...p, status: decision, at: now } : p,
  );
  write(list);
  return list;
}

/** The approved-but-not-yet-promoted entries `--pending` should action.
 * @returns {Promotion[]} */
export function approvedPending() {
  return readPromotions().filter((p) => p.status === "approved");
}

/** Mark an entry promoted once its files have moved into the plugin.
 * @param {string} id @param {string} now @returns {Promotion[]} */
export function markPromoted(id, now) {
  const list = readPromotions().map((p) =>
    p.id === id && p.status === "approved"
      ? { ...p, status: /** @type {const} */ ("promoted"), at: now }
      : p,
  );
  write(list);
  return list;
}

/** One-line summary for CLI / tool results. @param {Promotion[]} list @returns {string} */
export function summarize(list) {
  const by = (/** @type {string} */ status) => list.filter((p) => p.status === status).length;
  return `${list.length} promotion(s): ${by("requested")} requested, ${by("approved")} approved, ${by("promoted")} promoted, ${by("rejected")} rejected.`;
}

export { KINDS, STATUSES };
