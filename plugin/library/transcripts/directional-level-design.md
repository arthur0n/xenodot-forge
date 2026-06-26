# 5 Level Design Tips (Synth Beast) — transcript digest

**Source** — `godot-directional-level-design.md` (raw now in `transcripts/archive/godot-directional-level-design.md`). Indie dev (Synth Beast — 2D/2.5D action-RPG, monster-capture, open-world). Level-design THEORY video; no Godot/GDScript content despite filename.
**Why harvested** — about to build directional / shaped arenas (lanes, sightlines, choke points, asymmetry, flow direction) instead of open square boxes; the three arenas (blast_court / firing_yard / ruined_warehouse) were enlarged ~1.5x but stay rectangular.

**Context note** — design-thinking resource, exploration/Metroidvania-flavoured, NOT arena FPS. Validity = "should our level pipeline embody it"; "already learned?" = whether greybox / ArenaLayout / level-designer already encode it. None is skill/code material. Distinct angle from the prior `level-design-principles-langeskov.md` digest (that = verticality/space-contrast/shape-variety; this = orientation/goal/iterate/affordance/story).

**Points**
| # | Point (technique/claim) | Valid for our stack? | Already learned? | Where / gap | Verdict |
|---|---|---|---|---|---|
| 1 | **Landmarks for orientation:** dot the space with unique set-pieces / colour-coded regions so player always knows where they are; put the strongest landmark at shortcut/loop reconnect points. | holds — but our arenas are single-screen combat, so orientation matters less than in a sprawling Metroidvania; the loop-reconnect idea maps onto P1 loop topology. | covered | ArenaLayout `landmarks` (LandmarkDef: distinct `colour` + `label` + `centre` per region) + greybox P6 (≥3 nameable regions, distinct height/shape/colour) + P1 loop topology. | covered |
| 2 | **Design with a goal:** sketch the layout, annotate each point with what it should TEACH/DO toward an end goal (e.g. boss tests skills X/Y/Z); build only what serves the goal → faster + better. | holds — pure design guidance, stack-agnostic; for an arena the "goal" = the wave/pacing experience, not a boss-skill gate. | covered | level-designer concept-first interview (experience-goal) + greybox Step 1 reads the brief's experience-goal + pacing beats; brief template has **Concept** + pacing. | covered |
| 3 | **Whitebox then iterate:** build the grey blockout from the sketch, make it fully PLAYABLE before any decoration, playtest, and CHANGE it; decorating early makes you resist feedback. | holds — exactly our greybox ethos (author ArenaLayout `.tres` → headless audit → iterate the `.tres`, no art). | covered | godot-greybox whole premise: measurable blockout, REPORT-mode audit, "iterate the layout = edit the .tres"; validate.sh / runtime-smoke gates before polish. | covered |
| 4 | **Affordance guides flow:** make interactable elements legible (yellow-paint convention), and SPRINKLE them so the player can always see a next one → pulls player in a chosen direction (Mario coins, visible docks). | holds with caveat — "always see the next guidance element" = directional flow / leading-the-eye; in an arena this is sightline-led pull toward cover/objective, NOT pickups. Affordance-legibility itself is out of arena-greybox scope (a feel/readability concern). | partial | greybox P7 (spawn-to-engagement route passes cover, not fully exposed) + P1 lanes give directional pull; but "leading-the-eye / intentional flow direction via visible attractors" is not an explicit metric. Readability of interactables = feel/polish work, not authored in greybox. | partial → gap (flow-direction metric) |
| 5 | **Story last:** for gameplay-first games, author levels to the player-goals first, write story/NPCs/decoration-callouts afterward so they reinforce the space. | out of scope — POC arena-survival FPS has no story/NPCs; "POC not about dice/fate" — gameplay-only. | n/a | — | out of scope |

**Stack mapping (build ask: directional/shaped arenas)**

- The literal asks — **lanes, sightlines, choke points, flow direction** — are already first-class in greybox: P1 loop/three-lane topology, P3 partitioned sightlines, P9 choke-vs-open, ArenaLayout `lanes: Array[LaneDef]` (waypoints+label) + `ArenaPiece.lane_id`. The video adds no new technique here; it motivates USING them.
- **ASYMMETRY** (in the build ask) is the one directional property NOT an explicit greybox metric — the 9 principles measure cover/sightline/verticality/topology but never "the space is shaped/asymmetric, not a centred square." This is a real partial gap, surfaced by the build ask more than by the video.
- Two arenas are GridMap (firing_yard, ruined_warehouse), one is ArenaBuilder+ArenaLayout (blast_court). greybox + ArenaLayout only shape the ArenaBuilder path; directional shaping of the GridMap levels is hand-drawn-grid + godot-gridmap-level, fed by the level-designer drawn-grid interview — a different authoring path the video's principles also apply to.

**Recommended next** — gaps to act on now for the directional-arena build:

- **game-designer** — decide whether "directional shape / asymmetry / intentional flow-direction" becomes an explicit greybox principle (a P10, e.g. footprint not square + a spawn→objective directional pull), or stays an informal brief note. One scoping decision; it extends godot-greybox, NOT a new skill (everything else here is already inside greybox's remit).
- **level-designer** — for the GridMap arenas (firing_yard, ruined_warehouse), the directional reshape runs through the drawn-grid concept interview; brief should call out lanes/chokes/asymmetry per the existing level-design-principles principles. No new skill.
- skill-researcher / addon-researcher — **nothing**. No reusable technique missing, no generic subsystem; the whole video is design-thinking already covered by greybox + level-designer.

**Later** (valid, not needed this iteration)

- Flow-direction / leading-the-eye as an authored metric (point 4) — only if arenas grow beyond single-screen and orientation becomes a real problem.
- Affordance-legibility of interactables (point 4) — a readability/feel concern → a future game-feel/polish sweep (not yet built), not the blockout.
