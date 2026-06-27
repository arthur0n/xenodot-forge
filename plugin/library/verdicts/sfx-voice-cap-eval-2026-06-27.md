# SFX voice-cap / anti-spike limiter — skill eval

**Date** 2026-06-27 · **Agent** skill-researcher · **Gate** pending human adopt/reject

## Gap

Building SFX. Need anti-spike VOICE-CAP: cap how many copies of ONE sound play in the
same frame so the mix does not distort/clip. No `godot-*` skill caps concurrent SFX
COUNT. godot-audio only handles overlap-CUTOFF (`max_polyphony`) and a round-robin pool
that interrupts the OLDEST — neither suppresses the Nth simultaneous copy. Distinct
problem ("sound spiking", transcript point 1+4).

Source context: `library/transcripts/godot-sound-effects.md` (Hexagod video). It solved
spiking with a global `AudioManager` autoload — REJECTED: our convention is NO autoload,
composition over inheritance.

## Candidate evaluated

GodotPrompter `skills/audio-system/` (MIT) — the same source godot-audio was adapted
from. Reference `references/sfx-pooling.md` is the only SFX-count-adjacent file.

**Finding: the library does NOT contain the voice-cap technique.** What audio-system
offers for concurrency:

- `max_polyphony` — per-player overlap cutoff. godot-audio already has it (step 5).
- SFX **pool autoload** (16 round-robin `AudioStreamPlayer`) — interrupts the OLDEST
  when full. Two problems: (a) it is an autoload (conflicts our convention), (b)
  interrupt-oldest is NOT suppress-Nth, so it does not stop the mix piling up — it just
  rotates which players are busy. godot-audio already ports a no-autoload, per-entity
  version of this same round-robin pool (step 5).
- `play_random_pitch(min, max)` — pitch randomness. The one genuinely useful crumb;
  godot-audio's pool passes `pitch_scale` but no random RANGE.

Nothing tracks per-sound ACTIVE COUNT, decrements on `finished`, or SUPPRESSES a new
`play()` at a limit. The exact technique the gap needs exists in neither godot-audio nor
the library — it must be authored.

## 6 buckets

1. **From the source/idea** — anti-spike voice-cap: per-sound active-instance counter,
   suppress new `play()` at the cap, decrement on `finished`. Stops N copies of one SFX
   stacking in one frame and blowing the top end.

2. **From the candidate (GodotPrompter audio-system)** — gives `max_polyphony`
   (have it), an interrupt-oldest pool (have a better no-autoload port), and
   `play_random_pitch` (small new juice). Does NOT give the voice-cap counter at all.

3. **No-brainers (adopt as-is)** — none. No file to lift; the technique is not present.

4. **Improvements (adopt but rework)** — extend the EXISTING godot-audio skill (step 5)
   with a small voice-cap component, composition-style, no autoload:
   - a per-entity `Node` holding a typed `Dictionary[StringName id -> int]` active count;
   - `play(id, stream)` early-returns when count ≥ cap; else `play()`, `count += 1`,
     and on that player's `finished` `count -= 1` (CONNECT_ONE_SHOT, guarded);
   - cap is an `@export int max_voices` (per-sound override optional) — the data lever.
   - This sits alongside the round-robin pool already in step 5: pool = no instancing
     churn; voice-cap = suppress the spike. Both stay per-entity.
   - Fold in `play_random_pitch` as a `randf_range(min_pitch, max_pitch)` on the same
     `play()` (cheap repeat-variation for gen_sfx placeholders).
   - Add an Error→Fix row: "dozens of same SFX same frame → distortion/clip → voice-cap
     the sound (step 5b)".

5. **Not now — SYSTEM/framework park** — whether SFX should be authored as a typed
   `.tres` (stream + volume + pitch + cap) keyed by StringName via
   `godot-resource-registry` (transcript point 3) is an ARCHITECTURE call, not this
   skill. Route to game-designer before wiring many sounds. The voice-cap cap field is
   the natural first home for such a Resource if that call lands "yes". Park, do not
   block.

6. **Definitely skip** — the `AudioManager`/`SFXPool` **autoload** (convention conflict),
   the C# variants, the 2D positional pool, volume settings UI, adaptive-music streams
   (all already parked in godot-audio's "Parked" section).

## Verdict — REJECT new skill; EXTEND godot-audio (recommended)

A standalone `godot-voice-cap` skill would be a thin component that lives in exactly the
same place as godot-audio's existing step-5 pool, triggered at the same seam, under the
same no-autoload rule. It is one more sub-pattern of "per-entity SFX concurrency", not a
new domain. Cohesion says it belongs as a step inside godot-audio (next to
`max_polyphony` and the round-robin pool), not as a sibling skill the dev must
cross-reference. The library offers nothing to copy, so "adopt" has no source file
anyway — the work is authoring, and the right host is the existing skill.

Recommendation order: **extend godot-audio** > reject-and-defer > new skill (least
preferred — fragments the audio-concurrency story).

## If approved — next task for godot-dev / skill-author

Extend `.claude/skills/godot-audio/SKILL.md` step 5 with a "5b. Voice-cap a sound
against spiking" subsection: a per-entity, no-autoload component tracking
`Dictionary[StringName -> int]` active counts, suppress-at-cap, decrement on
`finished`, `@export max_voices`, optional `play_random_pitch`; add the matching
Error→Fix row; keep attribution line as-is. No new skill file, no CLAUDE.md line change
(godot-audio already listed).

## Eval cleanup

`.claude/skills/eval/audio-system/` copied for evaluation, deleted at end of run.
