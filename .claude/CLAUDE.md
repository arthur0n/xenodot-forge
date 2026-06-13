# Xenodot Forge — framework spine rules

Rules for working **on the framework itself** (the Node/TS web UI and tooling under
`ui/`). The game's own rules live in the game project, not here — see `game-config/`
for what the framework ships into a game.

> Scaffold — expand with your own conventions. The essentials below match what the repo
> already enforces.

## Always

- Prefix shell commands with `rtk` (a PreToolUse hook enforces it; see `.claude/settings.json`).
- Plain JS + JSDoc only — no `.ts` files. Types are checked via tsconfig `checkJs`.
- Node/CLI scripts live in `ui/server/` so eslint's node group + tsconfig type-check them.

## Before committing

- `npm run validate` (tsc + eslint, zero warnings) must pass.
- `npx prettier --write` keeps formatting clean (lint-staged also runs it on commit).

## Layout

- `ui/server/` — Node server + CLI scripts (`setup`, `update-badges`, `claude-sync`, `claude-install`).
- `ui/client/` — browser modules. `ui/lib/` — shared JSDoc typedefs + helpers.
- `game-config/` — the vendored Claude config shipped to games. Never put game files
  inside the framework; the framework only points at an external game (default `../game`).
