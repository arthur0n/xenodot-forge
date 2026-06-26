// Pure-function checks for computeSessionSkills (the testable core of resolveSessionSkills) — run:
//   node ui/server/features/skills/skills.check.js
// No test runner: computeSessionSkills is pure, so it's exercised directly. Guards the override
// semantics Layer 1 depends on (default-deny, wildcard, per-name, floor always-on, dedup).
// Importing skills.js triggers config.js's one-time engine probe — harmless, hand-run only.
import assert from "node:assert/strict";
import { computeSessionSkills } from "./skills.js";

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

const floor = ["caveman", "graphify"];
const candidates = ["init", "verify", "code-review"];
const sorted = (/** @type {string[]} */ a) => [...a].sort();

check("default-deny: no overrides → floor only (no built-ins, no domain skills)", () => {
  const out = computeSessionSkills({ floor, candidates, overrides: {} });
  assert.deepEqual(sorted(out), sorted(["caveman", "graphify"]));
});

check('wildcard "*":"on" → floor + ALL candidates', () => {
  const out = computeSessionSkills({ floor, candidates, overrides: { "*": "on" } });
  assert.deepEqual(sorted(out), sorted([...floor, ...candidates]));
});

check('wildcard "on" + a per-name "off" removes just that one', () => {
  const out = computeSessionSkills({ floor, candidates, overrides: { "*": "on", verify: "off" } });
  assert.ok(out.includes("init") && out.includes("code-review"));
  assert.ok(!out.includes("verify"));
});

check("default-deny + a per-name on → only that built-in is added to the floor", () => {
  const out = computeSessionSkills({ floor, candidates, overrides: { init: "on" } });
  assert.deepEqual(sorted(out), sorted([...floor, "init"]));
});

check("floor is ALWAYS in, even when overrides try to disable it", () => {
  const out = computeSessionSkills({
    floor,
    candidates,
    overrides: { "*": "off", caveman: "off" },
  });
  assert.ok(out.includes("caveman") && out.includes("graphify"));
});

check("result is de-duplicated when a name is in both floor and candidates", () => {
  const out = computeSessionSkills({
    floor: ["caveman"],
    candidates: ["caveman"],
    overrides: { "*": "on" },
  });
  assert.deepEqual(out, ["caveman"]);
});

console.log(`ok  skills: ${passed} computeSessionSkills checks passed`);
