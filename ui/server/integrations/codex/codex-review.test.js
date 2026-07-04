// node:test coverage for the codex-review wrapper's pure arg helpers. Importing the
// module is side-effect free: the spawn lives inside main(), which only runs when the
// file itself is process.argv[1] (the import.meta guard at the bottom of codex-review.js),
// and under `node --test` argv[1] is this test file.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeArgv,
  splitArgString,
  splitReviewArgs,
  buildArgs,
  CRITERIA_FILE,
} from "./codex-review.js";

// The real review lens the wrapper prepends — read once for exact-merge assertions.
const CRITERIA = readFileSync(CRITERIA_FILE, "utf8").trim();

describe("splitArgString", () => {
  test("splits on any whitespace run", () => {
    assert.deepEqual(splitArgString("review  --base\tmain\nfocus"), [
      "review",
      "--base",
      "main",
      "focus",
    ]);
  });

  test("double and single quotes group tokens", () => {
    assert.deepEqual(splitArgString('say "hello world" now'), ["say", "hello world", "now"]);
    assert.deepEqual(splitArgString("it 'is one' token"), ["it", "is one", "token"]);
  });

  test("quotes glued to text extend the same token", () => {
    assert.deepEqual(splitArgString('--focus="a b"'), ["--focus=a b"]);
  });

  test("a quote inside the other quote kind is literal", () => {
    assert.deepEqual(splitArgString(`"he said 'hi'"`), ["he said 'hi'"]);
  });

  test("empty quotes make an empty token; an unterminated quote keeps the tail", () => {
    assert.deepEqual(splitArgString('a "" b'), ["a", "", "b"]);
    assert.deepEqual(splitArgString('a "b c'), ["a", "b c"]);
  });

  test("empty / whitespace-only input yields no tokens", () => {
    assert.deepEqual(splitArgString(""), []);
    assert.deepEqual(splitArgString("   \t "), []);
  });
});

describe("normalizeArgv", () => {
  test("multi-arg argv passes through untouched (same reference)", () => {
    const argv = ["review", "--base", "main"];
    assert.equal(normalizeArgv(argv), argv);
  });

  test("a single combined blob is shell-split", () => {
    assert.deepEqual(normalizeArgv(['review --scope "src dir" fix']), [
      "review",
      "--scope",
      "src dir",
      "fix",
    ]);
  });

  test("a single blank blob and an empty argv both yield []", () => {
    assert.deepEqual(normalizeArgv(["   "]), []);
    assert.deepEqual(normalizeArgv([]), []);
  });
});

describe("splitReviewArgs", () => {
  test("value flags consume the next token; positionals become focus", () => {
    assert.deepEqual(splitReviewArgs(["--base", "main", "fix", "bugs"]), {
      flags: ["--base", "main"],
      focus: ["fix", "bugs"],
    });
  });

  test("--flag=value keeps its value inline (nothing consumed)", () => {
    assert.deepEqual(splitReviewArgs(["--base=main", "perf"]), {
      flags: ["--base=main"],
      focus: ["perf"],
    });
  });

  test("short aliases -m/-C consume a value; other shorts don't", () => {
    assert.deepEqual(splitReviewArgs(["-m", "o3", "-C", "/tmp", "topic"]), {
      flags: ["-m", "o3", "-C", "/tmp"],
      focus: ["topic"],
    });
    assert.deepEqual(splitReviewArgs(["-v", "topic"]), { flags: ["-v"], focus: ["topic"] });
  });

  test("non-value long flags don't consume; bare '-' is a positional", () => {
    assert.deepEqual(splitReviewArgs(["--json", "topic", "-"]), {
      flags: ["--json"],
      focus: ["topic", "-"],
    });
  });

  test("everything after -- is focus, even flag-shaped tokens", () => {
    assert.deepEqual(splitReviewArgs(["--base", "main", "--", "--not-a-flag", "x"]), {
      flags: ["--base", "main"],
      focus: ["--not-a-flag", "x"],
    });
  });

  test("empty rest and a dangling value flag are safe", () => {
    assert.deepEqual(splitReviewArgs([]), { flags: [], focus: [] });
    assert.deepEqual(splitReviewArgs(["--base"]), { flags: ["--base"], focus: [] });
  });
});

describe("buildArgs", () => {
  test("non-review subcommands pass through by reference; empty argv too", () => {
    const argv = ["exec", "--full-auto", "do things"];
    assert.equal(buildArgs(argv), argv);
    assert.deepEqual(buildArgs([]), []);
  });

  test("review is upgraded to adversarial-review with the lens prepended to caller focus", () => {
    const out = buildArgs(["review", "--base", "main", "check", "auth"]);
    assert.deepEqual(out.slice(0, 3), ["adversarial-review", "--base", "main"]);
    assert.equal(out.length, 4);
    assert.equal(out.at(-1), `${CRITERIA}\n\n--- caller's extra focus ---\ncheck auth`);
  });

  test("adversarial-review with no focus gets exactly the lens as its focus", () => {
    assert.deepEqual(buildArgs(["adversarial-review", "-m", "o3"]), [
      "adversarial-review",
      "-m",
      "o3",
      CRITERIA,
    ]);
  });
});
