// Pure-function checks for the M2 profile filter (inProfile / filterAgentSkills) — run:
//   node ui/server/features/skills/skill-scope.check.js
// No test runner: the functions are pure, so they're exercised directly. Guards D5 (the filter
// rule the runtime session preload depends on): always-keep floor, genre/style locks, the pixel-
// importer carve-out, and fail-open on an undeclared profile.
import assert from "node:assert/strict";
import { inProfile, filterAgentSkills, STYLE_PIXEL_KEEP_ALWAYS } from "./skill-scope.js";

let passed = 0;
/** @param {string} name @param {() => void} fn */
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const PIXEL_ISO = { genre: "genre-topdown-iso", style: "style-pixel" };
const HD_FPS = { genre: "genre-fps", style: "style-hd" };

// --- inProfile: the always-keep floor ---
for (const d of ["universal", "godot-core", "design", "project-local"]) {
  check(`always-keep: ${d} kept under any profile`, () => {
    assert.equal(inProfile(d, PIXEL_ISO), true);
    assert.equal(inProfile(d, HD_FPS), true);
  });
}

// --- inProfile: genre lock ---
check("genre lock: matching genre kept, mismatching dropped", () => {
  assert.equal(inProfile("genre-topdown-iso", PIXEL_ISO), true);
  assert.equal(inProfile("genre-fps", PIXEL_ISO), false);
  assert.equal(inProfile("genre-fps", HD_FPS), true);
  assert.equal(inProfile("genre-topdown-iso", HD_FPS), false);
});

// --- inProfile: style lock ---
check("style lock: matching style kept, mismatching dropped", () => {
  assert.equal(inProfile("style-pixel", PIXEL_ISO), true);
  assert.equal(inProfile("style-hd", PIXEL_ISO), false);
  assert.equal(inProfile("style-hd", HD_FPS), true);
  assert.equal(inProfile("style-pixel", HD_FPS), false);
});

// --- inProfile: pixel-importer carve-out (style-pixel kept even in an HD game) ---
check("carve-out: the placeholder-gen importer survives a style-hd game", () => {
  for (const name of STYLE_PIXEL_KEEP_ALWAYS) {
    assert.equal(inProfile("style-pixel", HD_FPS, name), true);
  }
  // a non-carve-out style-pixel skill in an HD game is still dropped — including the pixel MESH
  // delta, whose structural core moved to the always-kept `godot-mesh-import` base (D10 split).
  assert.equal(inProfile("style-pixel", HD_FPS, "godot-3d-pixelation"), false);
  assert.equal(inProfile("style-pixel", HD_FPS, "godot-mesh-import-pixel-art"), false);
});

// --- inProfile: fail-open ---
check("fail-open: undeclared profile axis keeps locked skills", () => {
  assert.equal(inProfile("genre-fps", { genre: null, style: "style-hd" }), true);
  assert.equal(inProfile("style-pixel", { genre: "genre-fps", style: null }), true);
  assert.equal(inProfile("genre-fps", {}), true);
});
check("fail-open: unknown/missing skill domain kept", () => {
  assert.equal(inProfile(null, HD_FPS), true);
  assert.equal(inProfile(undefined, PIXEL_ISO), true);
});

// --- filterAgentSkills: end-to-end over a representative agent skill list ---
const DOMAINS = {
  caveman: "universal",
  "godot-verify": "godot-core",
  "godot-mesh-import": "godot-core", // neutral base — always kept
  "godot-texture-import": "godot-core", // neutral base — always kept
  "godot-first-person-controller": "genre-fps",
  "godot-orthographic-follow-camera": "genre-topdown-iso",
  "godot-3d-pixelation": "style-pixel",
  "godot-texture-import-pixel-art": "style-pixel", // importer carve-out (placeholder-gen)
  "godot-mesh-import-pixel-art": "style-pixel", // plain style delta now — dropped off-style
  "godot-mesh-import-hd": "style-hd",
};
const AGENT_SKILLS = Object.keys(DOMAINS);

check("filterAgentSkills: pixel/iso game keeps its variants + bases, drops fps + hd", () => {
  const out = filterAgentSkills(AGENT_SKILLS, DOMAINS, PIXEL_ISO);
  assert.deepEqual(out, [
    "caveman",
    "godot-verify",
    "godot-mesh-import",
    "godot-texture-import",
    "godot-orthographic-follow-camera",
    "godot-3d-pixelation",
    "godot-texture-import-pixel-art",
    "godot-mesh-import-pixel-art",
  ]);
});

check(
  "filterAgentSkills: hd/fps game keeps bases + carve-out + hd, drops iso/pixelation/pixel-mesh",
  () => {
    const out = filterAgentSkills(AGENT_SKILLS, DOMAINS, HD_FPS);
    assert.deepEqual(out, [
      "caveman",
      "godot-verify",
      "godot-mesh-import", // always-kept base (structural core, no aesthetic)
      "godot-texture-import", // always-kept base
      "godot-first-person-controller",
      "godot-texture-import-pixel-art", // carve-out survives (placeholder-gen)
      "godot-mesh-import-hd",
    ]);
  },
);

check("filterAgentSkills: undeclared profile keeps everything (fail-open)", () => {
  const out = filterAgentSkills(AGENT_SKILLS, DOMAINS, { genre: null, style: null });
  assert.deepEqual(out, AGENT_SKILLS);
});

check("filterAgentSkills: accepts a Map of domains too", () => {
  const out = filterAgentSkills(AGENT_SKILLS, new Map(Object.entries(DOMAINS)), HD_FPS);
  assert.ok(out.includes("godot-mesh-import-hd") && !out.includes("godot-3d-pixelation"));
});

console.log(`✓ ${passed} checks passed`);
