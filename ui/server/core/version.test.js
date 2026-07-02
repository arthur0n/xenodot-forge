// node:test coverage for the release version math (core/version.js) — the pure
// half of the release train (release-stage.js relies on these exactly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_TYPES, nextTag, tagToPkgVersion } from "./version.js";

test("nextTag: feat bumps the sub-version and drops any build digit", () => {
  assert.equal(nextTag("v0.1.2", "feat"), "v0.1.3");
  assert.equal(nextTag("v0.1.2.4", "feat"), "v0.1.3");
});

test("nextTag: fix/chore/refactor bump the 4th build digit", () => {
  assert.equal(nextTag("v0.1.2", "fix"), "v0.1.2.1");
  assert.equal(nextTag("v0.1.2.1", "chore"), "v0.1.2.2");
  assert.equal(nextTag("v0.2.1", "refactor"), "v0.2.1.1");
});

test("tagToPkgVersion: always a valid 3-part semver (build digit dropped)", () => {
  assert.equal(tagToPkgVersion("v0.2.1"), "0.2.1");
  assert.equal(tagToPkgVersion("v0.2.1.7"), "0.2.1");
});

test("RELEASE_TYPES matches the documented scheme", () => {
  assert.deepEqual([...RELEASE_TYPES].sort(), ["chore", "feat", "fix", "refactor"]);
});
