// A registry of LIVE sessions keyed by SDK session id, so a reconnecting browser can re-attach to
// the same running session (and its in-flight sub-agents) instead of cold-resuming from disk. A
// session registers itself once its SDK session id is known (mid-stream, see runSession's
// onSessionId) and removes itself on teardown. The map is empty after a server restart, so a
// reconnect then falls through to the disk-resume path in handleConnection.

/** @typedef {import("./session.js").LiveSession} LiveSession */

/** @type {Map<string, LiveSession>} */
const live = new Map();

/** The still-running session for this resume id, or undefined if none (fresh / disk-resume).
 * @param {string | null} id @returns {LiveSession | undefined} */
export function getLive(id) {
  return id ? live.get(id) : undefined;
}

/** @param {string} id @param {LiveSession} ls */
export function registerLive(id, ls) {
  live.set(id, ls);
}

/** @param {string} id */
export function dropLive(id) {
  live.delete(id);
}
