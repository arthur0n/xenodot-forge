// tools/sim/stream.js — the deterministic tag-stream core, shared by the sim server
// (server.js) and the recorder/fixture generator (record.js).
//
// Everything here is the SINGLE SOURCE of the sim's determinism contract: values are a pure
// function of (seed, tick, tag index, range) — same seed ⇒ same stream, bit for bit. The
// Phase-4 recording gate relies on it (a synthesized fixture and a live capture of the sim
// under the same seed must carry identical (tag, value, seq) triples), which is WHY this
// logic lives in one module instead of being duplicated: two copies could drift, one cannot.
// Extracted verbatim from server.js (Phase 3) — the constants and math are unchanged.
//
// Dependency-free by design: the materialized tools/ ships no package.json, so this must run
// under a bare `node` (see server.js's header for the full rationale).
import { readFileSync } from "node:fs";

// --- CLI defaults (cross-file contract — see the paired doc comments) ---
/** Default WebSocket port. The viewer's DataBus default URL (starter-viewer/core/data_bus.gd
 * DEFAULT_URL = "ws://localhost:8765") points here, so a sim started with no --port pairs with a
 * default viewer out of the box. The verify_twin.sh gate deliberately runs its OWN sim on 8899
 * instead, to avoid colliding with a sim a developer may already have on 8765. */
export const DEFAULT_PORT = 8765;

/** Default publish rate in Hz. smoke_binding.gd's STREAM_HZ MUST equal this: the smoke converts
 * --frames=N to seconds as N/STREAM_HZ, so any drift desynchronizes its frame->time math. */
export const DEFAULT_HZ = 10;

/** Default PRNG seed. Any fixed integer works — the only contract is that a given seed replays
 * bit-for-bit. 42 is the conventional "arbitrary but fixed" seed; verify_twin.sh passes it
 * explicitly so the gate's expectations never depend on this default. */
export const DEFAULT_SEED = 42;

/** Milliseconds per second — the setInterval period is 1000/hz, and a recording's t_ms is
 * tick * 1000/hz (record.js). */
export const MS_PER_SEC = 1000;

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

/** The `--flag` / `--flag=value` prefix; slicing past it yields the flag name. */
const FLAG_PREFIX = "--";

/** One row of the sim's tag table: a tag name and the [min,max] its values span. */
/** @typedef {{ tag: string, min: number, max: number }} TagRow */

/** The built-in demo tag table used when no (readable) --map is supplied. The ranges are the
 * colour-ramp ranges a matching binding map would carry.
 * @type {TagRow[]} */
export const DEMO_TAGS = [
  { tag: "pump_1.temp", min: 20, max: 90 },
  { tag: "pump_1.flow", min: 0, max: 100 },
  { tag: "tank_1.level", min: 0, max: 100 },
  { tag: "valve_1.position", min: 0, max: 100 },
  { tag: "motor_1.rpm", min: 0, max: 3000 },
];

/** Parse `--flag value` / `--flag=value` argv into a map.
 * @param {string[]} argv @returns {Record<string, string>} */
export function parseArgs(argv) {
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
export function mulberry32(a) {
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
export function tagsFromMap(mapPath) {
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
export function tagValue(seed, tick, i, count, min, max) {
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
