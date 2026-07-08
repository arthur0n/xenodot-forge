// tools/sim/recording.js — the twin-recording NDJSON contract, encoded ONCE.
//
// A recording is NDJSON: line 1 is the header, every following line is one frame, frames
// ordered by t_ms ascending. The starter-viewer's playback (a parallel Phase-4 workstream)
// is built against this exact shape, so BOTH serialization paths of record.js (synthesized
// fixture + live capture) go through these helpers — the contract cannot fork between them.
//
//   header: {"version":1,"kind":"twin-recording","hz":<int>,"seed":<int>,
//            "tags":[{"tag":str,"min":float,"max":float},...]}
//   frame:  {"t_ms":<int, ms since recording start>,"tag":str,"value":float,"seq":<int>}
//
// Key ORDER matters for byte-reproducibility (the fixture gate hashes files): JSON.stringify
// preserves object insertion order for string keys, and these helpers are the only place the
// objects are built, so the same data always serializes to the same bytes.
//
// Dependency-free by design: the materialized tools/ ships no package.json, so this must run
// under a bare `node` (see server.js's header for the full rationale).

/** Recording format version. Bump ONLY on a breaking shape change — the viewer's playback
 * rejects versions it doesn't know. */
export const RECORDING_VERSION = 1;

/** The `kind` discriminator every recording header carries, so a viewer can reject an
 * arbitrary NDJSON file that merely looks frame-shaped. */
export const RECORDING_KIND = "twin-recording";

/** The header `seed` for LIVE captures: the wire carries no seed, so the file says "recorded,
 * not synthesized". -1 is outside the sim's valid seed space (any int the CLI accepts is >= 0
 * after `| 0` coercion of a normal seed argument; -1 is the reserved sentinel by this contract),
 * so playback/gates can branch on it: seed >= 0 ⇒ re-synthesizable, -1 ⇒ observation only. */
export const SEED_RECORDED = -1;

/** One row of the header's tag table (same shape as the sim's TagRow — for synthesized fixtures
 * it IS the sim's tag table; for live captures min/max are the OBSERVED value range). */
/** @typedef {{ tag: string, min: number, max: number }} RecordingTagRow */

/** One recorded frame: `t_ms` is integer milliseconds since recording start; `tag`/`value`/`seq`
 * are the sim wire fields (server.js sends {tag,value,seq,sent_ms}; the absolute `sent_ms` is
 * deliberately NOT recorded — t_ms replaces it so files are replayable and reproducible). */
/** @typedef {{ t_ms: number, tag: string, value: number, seq: number }} RecordingFrame */

/** Serialize the header line (no trailing newline — the writer owns line endings).
 * @param {number} hz @param {number} seed @param {RecordingTagRow[]} tags @returns {string} */
export function headerLine(hz, seed, tags) {
  return JSON.stringify({
    version: RECORDING_VERSION,
    kind: RECORDING_KIND,
    hz,
    seed,
    tags: tags.map((t) => ({ tag: t.tag, min: t.min, max: t.max })),
  });
}

/** Serialize one frame line (no trailing newline — the writer owns line endings).
 * @param {RecordingFrame} f @returns {string} */
export function frameLine(f) {
  return JSON.stringify({ t_ms: f.t_ms, tag: f.tag, value: f.value, seq: f.seq });
}
