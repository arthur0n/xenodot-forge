// Flat-config ESLint: plain JS (type-checked via tsconfig `checkJs` + JSDoc),
// no React, no path aliases.
//
// Two file groups, logic vs view:
//   - node + lib + smoke-test  → strict size limits
//   - client/ (the browser view) → relaxed per-function limits,
//     since DOM-building functions are verbose the same way JSX is.
// Both groups share the full rule set (style + type-aware strictness).

import js from "@eslint/js";
import tsPlugin from "typescript-eslint";
import globals from "globals";

const sharedRules = {
  // Code style — hard errors
  "no-debugger": "error",
  "no-duplicate-imports": "error",
  "prefer-const": "error",
  // Empty catch is a deliberate best-effort idiom here (localStorage / JSON
  // parse that may legitimately fail and is fine to ignore).
  "no-empty": ["error", { allowEmptyCatch: true }],

  // Unused vars — `_`-prefixed args/vars and caught errors are intentional.
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],

  // Type-aware — promises / thenables
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/await-thenable": "error",

  // Type-aware — strictness
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/restrict-template-expressions": "error",
  "@typescript-eslint/no-confusing-void-expression": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/prefer-nullish-coalescing": "error",
  "@typescript-eslint/prefer-optional-chain": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
};

// Logic-side limits — small files, small functions.
const nodeLimits = {
  "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
  "max-params": ["error", 8],
  "max-depth": ["error", 6],
  complexity: ["error", 15],
};

// View-side limits — relaxed per-function size + complexity for the
// verbose DOM-building view layer.
const viewLimits = {
  "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
  "max-lines-per-function": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
  "max-params": ["error", 8],
  "max-depth": ["error", 6],
  complexity: ["error", 25],
};

export default [
  // vendor/ holds gitignored third-party plugins (e.g. codex-plugin-cc, cloned by
  // `npm run codex:setup`) — not our code, never linted to our rules.
  // .claude/workflows/ holds Workflow DSL scripts (module-level `export` + top-level `return`
  // + runtime-injected globals) that no standard parser can lint; the rest of .claude/ IS linted.
  { ignores: ["node_modules/", "logs/", "vendor/", ".claude/workflows/"] },
  js.configs.recommended,

  // Node side — server, shared lib, smoke test, and *.check.js scripts run with
  // bare node. stdout logging is the product.
  {
    files: [
      "ui/server/**/*.js",
      "ui/lib/**/*.js",
      "ui/smoke-test.js",
      "ui/*.check.js",
      // The twin plugin's Node tools (e.g. the seeded data sim materialized into viewer
      // projects at tools/sim/) are held to the SAME strict node bar as framework JS.
      "plugin-twin/tools/**/*.js",
    ],
    languageOptions: {
      parser: tsPlugin.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { "@typescript-eslint": tsPlugin.plugin },
    rules: { ...sharedRules, ...nodeLimits, "no-console": "off" },
  },

  // node:test files — `test(...)` returns a promise the runner owns; awaiting or
  // void-ing every call is pure noise, so relax the floating-promise rule here only.
  {
    files: ["ui/**/*.test.js"],
    rules: { "@typescript-eslint/no-floating-promises": "off" },
  },

  // Browser side — the client view modules (loaded as ES modules).
  {
    files: ["ui/client/**/*.js"],
    languageOptions: {
      parser: tsPlugin.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    plugins: { "@typescript-eslint": tsPlugin.plugin },
    rules: { ...sharedRules, ...viewLimits, "no-console": ["error", { allow: ["warn", "error"] }] },
  },
];
