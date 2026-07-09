---
name: level-design-principles
agents: [level-designer]
domain: design
description: Level-design interview principles for the level-designer agent (from Langeskov/Lilford theory) — verticality, space contrast, shape variety. Use when starting a level-designer interview — establish the level's concept FIRST (what it is about), then ensure the brief captures variety and avoids flat/boxy/monotonous blockouts.
---

# Level Design Principles

Distilled from: `library/transcripts/level-design-principles-langeskov.md`

Three principles to bake into every level-designer interview. Ask one follow-up per principle — don't skip any, even for a small blockout. Small spaces can still be rich.

---

## 0. Concept first — before everything

Never open with parameters. The **first** question is always _what the level is about_ — the kind of space, the vibe, what the player does there — grounded in the layout you just read back. Get the overall idea before the name, the scale, or any principle below. Everything that follows is shaped by it: a crypt and a market hall want opposite verticality, contrast, and props. Do not guess the concept to save a question.

---

## 1. Verticality

Even one elevation change makes a level read as designed rather than procedural.

**Interview prompt:** After settling wall height, ask: "Should any zones sit at a different floor height — a raised platform, a sunken area, a step-up at a doorway?" Recommend: one height tier on top of the base floor (e.g. +1 m in the back room), then stop. Park multi-height tilesets for later.

**In the brief:** note each raised zone, its height delta, and which grid cells it covers.

---

## 2. Space Contrast

Players feel size by comparison. A big room after a tight corridor feels enormous; the same room reached directly feels ordinary.

**Interview prompt:** Read the grid layout to the user (you already did this). Then ask: "Do you want to amplify the contrast between [narrow corridor cells] and [wide room cells] — different wall colours, ceiling height, or lighting tone per zone?" Recommend: yes, and suggest one cheap differentiator (wall colour or light energy tweak per zone).

Also ask: "Is there a 'funnel' moment — a tight passage just before the biggest open space?" If not in the grid, suggest placing one (a door cell narrowing an entry).

**In the brief:** name the zones (e.g. "entry corridor → main hall") and the contrast device chosen.

---

## 3. Shape Variety

The draw-level grid constrains the _input tool_, not the _build output_. Door, window, and item tiles are opportunities to break grid monotony with rotated props, angled meshes, or decorative geometry — the builder places whatever mesh godot-dev chooses at those cells.

**Interview prompt:** For each non-wall tile code in the grid, ask not just "what does this become functionally?" but also "should it break the box?" Suggestions: a **door** cell can include a frame mesh rotated 5–15° for a worn look; a **window** cell can have a sill mesh at an angle; an **item** cell can be a barrel or crate placed diagonally. These are visual, not functional — they don't change collision.

**In the brief:** for each tile code, record the chosen mesh and whether it has a rotation offset.

---

## Apply-order

Load this skill first, then run the interview. Concept comes before any parameter; the three principles map to three extra questions woven into the existing interview order:

0. **Concept** (§0) — establish what the level is about FIRST, before name / scale / anything else.
1. Scale → Wall height → **Verticality question** (§1)
2. Door/window/item meaning → **Shape variety question** (§3, per tile code)
3. Theme/colours → **Space contrast question** (§2)
