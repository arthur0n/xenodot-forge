# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** — do not open a public issue or PR
that demonstrates an exploit.

- Preferred: [GitHub private vulnerability reporting](https://github.com/arthur0n/xenodot-forge/security/advisories/new)

Include what you found, where (file/path), and how to reproduce it. This is a
small, single-maintainer open-source project (a proof of concept) — there is no
bug bounty, but reporters get credited in the fix unless they prefer not to be.
Please allow a reasonable window for a fix before any public disclosure.

## Scope

- This repository — the framework spine (`ui/`, `.claude/`) and the shipped
  **xenodot** plugin (`plugin/`).
- **Out of scope:** your own Godot game. The framework only _reads_ an external
  game project in place and never tracks it, so a game's secrets are the game
  repo's responsibility, not this one's.

## Supported versions

Only `main` (the latest tagged release cut from it) receives fixes. This is a POC
— APIs, layouts, and prompts change without notice.

## Security model

What a change must never weaken:

- **Human in the loop is the invariant.** Provider, model, and any outer
  orchestrator are swappable; the approval gates, the designer interview, and the
  human-run `promote` are not. Every tool call and every delegated worker
  (Hermes, Codex) passes a human approval gate before it counts.
- **No secrets in the repo.** The Hive runs on your local Claude Code login (or
  `ANTHROPIC_API_KEY` in your environment); optional Hermes/Codex rails keep their
  keys in their own tool configs (`CODEX_HOME`, Hermes setup), never committed.
  The saved game path (`.xenodot.json`), vendored plugins (`vendor/`), and run
  records (`.xenodot-run/`) are gitignored. Any local `.env` is gitignored; the
  only committed env files are `*.example` placeholders.
- **The framework never writes to your game without a gate.** It reads the game
  in place; materialized per-game files (`tools/`, `library/`) are gitignored and
  regenerated on demand, so the committed game stays pure.
- **Secret scanning.** gitleaks scans staged changes pre-commit
  (`.husky/pre-commit`) and the full history in CI
  (`.github/workflows/gitleaks.yml`); config + allowlist in `.gitleaks.toml`.

If you find a way around any of these, that's exactly the report we want.
