# Better HUD with Godot Control nodes (hexagod) — transcript digest

**Source** — `godot-basic-hud.md` (raw now in `transcripts/archive/godot-basic-hud.md`). Solo-dev "how I build my UI" walkthrough (hexagod demo). No URL captured.
**Why harvested** — about to build "Better HUD": today's HUD is a bare `CanvasLayer` with raw, manually-offset `Label`s (`scripts/objective_hud.tscn` — anchored + hand-typed `offset_*`, no containers). Mapping the video's container-stack approach against our stack.

**Points**

| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Build HUD as a nested CONTAINER stack — `MarginContainer` (screen inset) → `PanelContainer` (frame) → `MarginContainer` (inner breathing room) → `VBox`/`HBox` for rows/cols — instead of manually anchoring + offsetting each Label. | holds | **gap** | Our `objective_hud.tscn` is exactly the manual-offset anti-pattern this fixes. No UI/container skill exists (framework or game-local). | core technique, NEW |
| 2 | Spacing via `MarginContainer` theme-override constants (one place), not per-node offsets. | holds | gap | Same gap as #1. | NEW |
| 3 | `PanelContainer` look via a `StyleBoxFlat` override (bg color + border color + border width) for a framed, juicy panel. | holds with caveat — colors must come from a named place, not literals typed in the Inspector | gap | CLAUDE.md "Data-driven" — a `Color()` in logic is a magic number; a StyleBox in a `.tres`/theme is the addressable home. This game has NO `tools/art_style.gd` (not the 3D-pixel-art style) and no shared `Theme` resource yet → no palette source to read from. | NEW, caveat |
| 4 | `VBox` = vertical stacking, `HBox` = horizontal; nest one in the other for a grid-ish layout. `separation` (e.g. -5) tightens, `alignment` (begin/center/end) places the block. | holds | gap | Standard Control, version-agnostic; fine on GL Compatibility. | NEW |
| 5 | Per-child placement via `Container Sizing` (fill vs expand) + Label `horizontal_alignment` / `autowrap`; reset any override with the revert arrow. | holds | gap | Same. Caveat the video itself names: some parent containers LOCK child sizing — change the parent if sizing won't take. | NEW |
| 6 | Icon rows: a `TextureRect` per input prompt (Kenney input-prompt asset pack) beside a Label; `make unique` the texture before swapping so you don't change every instance. | holds with caveat — asset SOURCING (Kenney pack) is the asset-advisor loop, not a free drop-in; and our game is GL-Compatibility iso, not pixel-art, so prompt art must match the game's look | gap (no input-prompt icons in project) | Asset import → `godot-texture-import-pixel-art` exists but is the pixel-art path; sourcing a prompt pack is an asset decision. | NEW, caveat |
| 7 | Label `uppercase` checkbox + a global `Theme` for consistent text; "it just has to work, refactor into subscenes later." | holds | partial | We follow composition/refactor culture already (CLAUDE.md). A shared `Theme` resource is the addressable home Point 3 needs but we don't have one. | partial |

**Recommended next** — gaps to act on for the Better-HUD build, one line each:
- Container-stack HUD layout pattern (Points 1,2,4,5) + the `StyleBoxFlat`/`Theme` home for HUD colors (Point 3) — no skill covers Godot Control/UI layout → **skill-researcher** (find/adopt a `godot-ui`/`godot-hud-layout` skill; it composes with our existing data-driven convention).
- "What should the better HUD actually SHOW + its visual language" (objective/intel + health + stamina, panel framing, input prompts y/n) — a real design decision, HUD is a parked milestone-3 item with no spec → **game-designer**.

**Later** (valid, not needed to rebuild the objective HUD this iteration):
- Kenney input-prompt icon pack sourcing (Point 6) — route through the normal asset-advisor loop WHEN the HUD design calls for on-screen control hints; defer until game-designer says the HUD shows prompts.
- System-level (framework, parked): the framework has NO Control/UI skill at all (only 3D/world/enemy skills). A general `godot-ui-control-stack` skill is a gap the whole framework would reuse, not just this game — park for skill-researcher to consider as a framework addition, not game work.
