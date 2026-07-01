# GDScript linter — gdstyle (in-editor) over gdlint (gate)

**Verdict:** Adopt **gdstyle** as the in-editor, config-driven GDScript linter (the
"ESLint-like" experience: a `gdstyle.toml` rule catalog + a Godot editor panel with
live, fixable diagnostics). Keep **gdformat + gdlint** as the blocking headless gate
(`tools/validate.sh`). gdstyle is **advisory** until upstream fixes its error-severity
exit code (trigger below), at which point it can be promoted into the gate.

- Tool: https://github.com/atelico/gdstyle — Rust, MIT, own GDScript lexer/parser.
- Pinned: **v0.1.7** (released 2026-06-09). Config: `gdstyle.toml` (default shipped in
  `starter/gdstyle.toml`). Install editor plugin: `tools/install_gdstyle.sh`.

## Why gdstyle over gdlint (for the editor layer)

The user wanted an ESLint-like system: a config file with named, severity-tagged rules,
delivered as a Godot/Redot plugin. gdlint (the incumbent gate linter) is CLI-only, has no
per-rule severity, and its rule set is fixed/non-extensible. gdstyle provides a TOML config,
54 named rules across `syntax/ naming/ format/ order/ quality/`, a Godot **editor plugin**
(native GDExtension on 4.6+, CLI fallback elsewhere), `--fix`, `fmt`, and `--format json`.

## What was verified empirically (v0.1.7)

WORKS:

- `gdstyle init` writes a documented starter config; `gdstyle rules` lists all 54.
- Top-level **cap keys are honored**: `max_line_length`, `use_tabs`, `max_file_length`,
  `max_parameters`, `max_public_methods`, `max_returns`, `max_function_length`,
  `max_class_variables`, `max_branches`, `max_nesting_depth`, `max_local_variables`,
  `max_inner_classes`, `exclude`.
- `gdstyle fmt --check` correctly **exits 1** on unformatted files (usable as a format gate).
- `quality/max-class-variables` (default 15) flags god-classes (a script whose member-variable
  count exceeds the cap) — a mechanical "too-many-responsibilities" proxy gdlint never gave us.

BROKEN / SHARP EDGES (why it is advisory-only, not the gate):

- **Per-rule `"error"` severity is a NO-OP.** A rule set to `error` still prints "warning",
  the JSON `severity` field stays `"warning"`, and **`gdstyle check` exits 0** even on
  violations. Only `"off"` changes behavior. → `check` cannot fail a build.
- **Unknown config keys are silently ignored** (a typo'd cap just doesn't apply — no error).
- **False positive `quality/duplicate-dict-key`:** misreads `Namespace.MEMBER` used as a dict
  _value_ as a duplicate _key_ — fires repeatedly on any file that uses namespaced enum/constant
  members as dict values. → turned `off` in the shipped config.
- **`naming/function-name-snake-case`** flags the `_on_<Node>_<signal>` handler pattern that
  gdlint's `function-name` regex explicitly allows → turned `off` (gdlint owns naming).
- **`order/class-member-order`** uses a different canonical order than gdlint's
  `class-definitions-order` → turned `off` (gdlint owns ordering).
- `format/max-line-length` counts a few lines gdlint passes (tab-width counting differs);
  left on as harmless advisory.

## The gate stays gdlint/gdformat

`tools/validate.sh` is unchanged: `gdformat --check` + `gdlint` (+ Godot parse/scene/smoke).
Reliable exit codes; carries the user's caps + naming regexes (`gdlintrc`). gdstyle does not
replace it. Net effect for a new game: **two configs, two layers** — `gdstyle.toml` (editor,
advisory) and `gdlintrc` (gate, blocking) — each owning its job, kept aligned by hand.

## Promote-to-gate trigger

Re-evaluate adding `gdstyle` to `validate.sh` when EITHER holds in a future release:

1. a rule set to `"error"` makes `gdstyle check` exit non-zero, OR
2. a `--error-on-warning` / `--max-warnings 0` flag exists.
   Then the gate could become `gdstyle fmt --check` + `gdstyle check` (single source of truth for
   editor + gate), retiring gdlint/gdformat. Until then, do NOT wire gdstyle into the gate; a
   JSON-non-empty wrapper would conflate warn/error and bet the gate on a young parser.

## Cross-fork (Godot / Redot / Blazium)

The gdstyle CLI is a standalone binary (parses GDScript text) → runs on any fork/version. The
editor panel's native backend is a GDExtension pinned to the 4.6 ABI → Godot 4.6 + Redot 4.6
get the panel; Blazium (4.3-based) gets the CLI fallback only. See `docs/engines.md`.

## Risk + mitigation

Young: v0.1.7, single maintainer, 38★. Mitigations: version pinned in
`tools/install_gdstyle.sh`; we rely only on the stable CLI + TOML surface; MIT → forkable if
abandoned (the missing custom-rule API + the error-severity fix are the fork targets).
