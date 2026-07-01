# Interactive HUD Passive-Three (skill-tree UI) — transcript digest

**Source** — `godot-interactive-hud-passive-three.md` (raw now in
`transcripts/archive/godot-interactive-hud-passive-three.md`). Godot skill-tree UI tutorial
(2D Control + TextureButton + Line2D auto-branch). **Same video content as the prior digest
`skill-tree-ui-auto-branching.md`** — re-dropped under the new "interactive hud passive three"
build name. No new technique vs that digest.

**Why harvested** — about to build the interactive passive-choice HUD (Slice 1: data model +
TAB pause toggle + single-branch chooser). Settled design: `design/passive_choice_screen.md`.

**What it teaches** — a COSMETIC 2D skill-tree UI: `Control` + ColorRect bg, `TextureButton`
"skill node" (`class_name SkillNode`) + `Label` rank counter, a per-node child `Line2D` that
auto-draws to its PARENT's centre in `_ready`, an `int level` `set`-setter that updates the label
and clamps `min(level+1, max_level)` on press, `self_modulate` lit/dim, an unlock gate (children
`disabled` until parent hits `max_level`), and a hand-waved `static var` skill-point counter
called "project-dependent". No data model, no gameplay effect, no save.

**Points**

| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | Skill node widget = `TextureButton` + `Label` counter + child `Line2D`, in a `Control`/CanvasLayer 2D screen | holds with caveat | covered (pattern) | We already build CanvasLayer+Control HUDs procedurally (`passive_hud.gd`). Caveat: 3D iso/GL-Compat does not constrain a screen-space 2D layer. Design picks plain list/grid, not TextureButtons | adopt the CanvasLayer-2D form; widget art optional |
| 2 | `Line2D` auto-draws branch to parent centre in `_ready` (`get_parent() is SkillNode`) | holds | gap (deliberately deferred) | Pure presentation. Design parks it under **Later** (single-branch Slice 1 needs no tree lines) | not for Slice 1 |
| 3 | `level` as `int` with `set`-setter clamped `min(level+1,max_level)` ON THE BUTTON | holds | **conflicts** | Button owning canonical level/cap DUPLICATES state our `ModifierStack`/`ActiveModifier.level` owns → violates **data-driven** (CLAUDE.md: code only READS tuning) + **composition-over-autoloads**. Design rule: widget owns ZERO gameplay state, active-set read FROM stack | reject button owning state (design already does) |
| 4 | Unlock gate: children `disabled` until parent maxed; root enabled | holds | covered (decided AGAINST) | Design settled "many choices per branch, no exclusivity/prereq" — branch = visual grouping only. Video's max-parent rule explicitly NOT wanted | skip — design rejected gating |
| 5 | "Skill points": `static var` shared counter, decrement on press, refuse at 0 | holds with caveat | **conflicts** | `static var` = global singleton → violates composition-over-autoloads. Design routes points to a `PassivePoints` **component node** (Slice 2), never `static`. Slice 1 = free, cost field dormant | reject the `static` impl; component path already chosen |
| 6 | Activating skill = "if unlocked, do X else return" bool on player (hand-waved) | out of scope | covered | Our real version: applied passive = `PassiveSkill.apply_to_stack` → `ModifierStack.add`; resolved stat gates behaviour. Video offers nothing past a bool | already have the real version |
| 7 | `self_modulate` (not `modulate`) tints button texture only, not label children | holds | gap | Correct Godot detail IF we use a TextureButton lit/dim widget. Design uses list buttons styled from stack state | minor note; not load-bearing for list UI |

**Verdict (on the buckets)** — ADOPT-AS-DESIGNED, no new action. Every point this video raises was
already distilled in the prior digest and RESOLVED in `design/passive_choice_screen.md`. The design
correctly inverts the video's two conflicts (state-on-button → state-in-stack; `static var` points →
component node) and defers its two cosmetic tricks (Line2D, gating) to Later. Confirm the design's
"author from digest, NO `skill-researcher` pass" call: **confirmed** — nothing reusable past this
widget pattern, already captured.

**6-bucket map**
1. *From source* — interactive skill-tree HUD (toggle nodes, show ranks, branch visually).
2. *From candidate* — TextureButton+Line2D+self_modulate widget; button-owned level/cap; `static` points.
3. *No-brainers* — CanvasLayer+Control 2D screen form (point 1); pause via `get_tree().paused` +
   `PROCESS_MODE_WHEN_PAUSED`; read active-set FROM the stack (design rules — all already in Slice 1 scope).
4. *Improvements (adopt reworked)* — button DISPLAYS stack level, calls `apply_to_stack`/`remove_from_stack`
   on click, owns no state (inverts points 3/6).
5. *Not now / SYSTEM* — none framework-level; everything game-specific routes via the normal build.
6. *Skip* — `static var` points (point 5, conflicts); button-owned level/cap (point 3, conflicts);
   max-parent unlock gate (point 4, design rejected exclusivity).

**Recommended next** — nothing to act on now. Design already absorbed this video; Slice 1 may be
authored from the digest as the design states. No skill-researcher / addon-researcher / game-designer
dispatch warranted.

**Later** (parked, per design) — `Line2D` auto-branch-to-parent visual (point 2); keyboard/gamepad
grid-nav polish; skill-point economy as a `PassivePoints` component (Slice 2, never `static`);
per-branch exclusivity (not wanted now).
