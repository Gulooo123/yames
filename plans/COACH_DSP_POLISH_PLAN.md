# Coach + DSP Polish & High-BPM Hardening Plan

> **Scope.** This plan picks up where `DSP_AND_COACH_PLAN_STATUS.md`
> leaves off. The two pillars (Great scoring DSP + Life-like coach)
> shipped end-to-end in 0.7.x–0.9.x. The objectives still align with
> `DSP_AND_COACH_PLAN.md`, but the implementation drifted in several
> places (D3 weights tuned empirically rather than spreadsheet-first,
> shuffle bag instead of strict template rotation, chord cluster merging
> moved into the detector rather than into the matcher, etc.). That
> drift is acknowledged and accepted — this plan focuses on **closing
> the gaps the drift exposed**, not on retro-fitting the original spec.
>
> **Two themes run through every priority tier:**
>   1. **High-BPM correctness.** Every shipped DSP and coach feature
>      was validated against ≤140 BPM playing. The 180/200 BPM 16ths
>      zone (the explicit "broken" zone in `DSP_AND_COACH_PLAN.md`
>      line 580–586) is still untested against real audio.
>   2. **Debugging pipeline.** `dump-fixture` bridges live sessions to
>      regression fixtures, but inspection, diff visualization, formula
>      playgrounds, and a real high-BPM scenario battery are missing.
>      Without these, the next iteration loop is slower than it should
>      be.
>
> Priorities below are **P0 (must-ship before next release), P1
> (next-up), P2 (formula evolution), P3 (cosmetic / nice-to-have)**.
> Within each tier, items are roughly ordered by "blast radius if
> wrong" — the top items in each tier are the ones whose absence will
> most distort the coach's voice or the score's fairness.

---

## Status Snapshot (as of 2026-05-18)

| Pillar | Original objective | Shipped state | Gap |
|--------|-------------------|---------------|-----|
| DSP — D0 instrument profiles | Per-instrument refractory, cluster, max-onsets-per-beat, expected-density | ✅ `instrument.rs` profile registry, `INSTRUMENT_PROFILE_VERSION` migration field, populated for drums / electric-guitar / acoustic-guitar / bass / piano / generic | None — but no profile values have been ear-tested above 140 BPM |
| DSP — D1 session log + helpers | Two-layer synthetic helpers (post-match + raw-onset), JSON logs, 50-log auto-prune | ✅ `session_log.rs::score_feedbacks` + `match_and_score` + Xorshift64-seeded generators, telemetry buffer, paired WAV capture, `dump-fixture` binary | Inspector/visualizer tooling is missing — JSON is human-readable but not easy to scan at 100+ onsets |
| DSP — D2 onset hardening | Adaptive refractory, rolling 10th-pct noise floor, onset confidence | ✅ formulas in `onset.rs`, confidence flows into `onset_efficiency` + `grid_alignment` | **High-BPM refractory math unverified** — `max(20, 75 × 0.35) = 26ms` at 200 BPM 16ths is theoretical, not measured |
| DSP — D3 scoring overhaul | Tempo-aware window, spurious tracking, interval-first 4-component score, 18-scenario D3d matrix | ✅ `timing.rs::score_segment` at line 1788, weights tuned `0.40/0.20/0.25/0.15`, all 18 d3d scenarios in test module from line 2709 green | **Synthetic-only** — no scenario uses real-audio fixtures |
| DSP — D4 segment detection | Signal A (settings) + Signal B (silence ≥4s, ≥30s sustained), per-segment scoring | ✅ `timing.rs::PracticeSegmentEnded` + `score_segment` (line 1788) + `duration_weighted_session_score` (line 1932) | High-BPM segmenting unverified |
| Coach — C1 narrative | 2KB compact running log, `[Coach said]:` prefix | ✅ `src/coach/sessionNarrative.ts`, mid-truncation preserves arc | None |
| Coach — C2 greetings | Cross-session-aware ("welcome back, last time 88% at 135") | ✅ `buildPriorSummary` in `useSession.ts` | Greeting is *built*; not yet *spoken with history-aware variants* (see P0-COACH-3) |
| Coach — C3 preset awareness | `summarizePreset`, `detectRecurringIssues`, `detectStaminaPattern`, BPM ceiling, timing tendency | ✅ `src/coach/presetAwareness.ts` (155+) with full test suite | Wiring exists; **stamina pattern surfacing into the coach voice is not yet plumbed** — `detectStaminaPattern` returns data but no template path consumes it |
| Coach — C4 smart timing | Gatekeeper, shuffle bag, 4-second min idle, fatigue/recovery detection | ✅ `src/coach/gatekeeper.ts` discriminated-union confirmations, shuffle-bag with cosine-bigram similarity ring | Drill-mode awareness gap — coach speaks during ramp transitions when it should defer |
| Coach — C5 personality & templates | 6 vocabularies × 6+ scenarios × variants, plain-English copy, LLM rephrase | ✅ `templateCatalog.ts` expanded 3→8 variants per slot, jargon removed | None of the variants are exercised against real-session playback yet |

**Net:** all shipped surfaces compile, ship green tests, and feel right
on low-BPM dogfooding. The unknown surface is **what happens above 160
BPM** — both how the DSP behaves and what the coach says when the DSP
output is noisier.

---

## P0 — High-BPM Verification & Debugging Pipeline (blocks next release)

These are the items whose absence makes every later polish item a
guess. The fast-feedback tooling must exist *before* we start tuning,
or we'll tune blind.

### P0-DBG-1 — Session-log inspector binary

**Why first.** Right now a 30-minute high-BPM session writes ~2 MB of
JSON to `~/Library/Application Support/<bundle>/session_logs/`. Reading
that JSON to answer "did the detector miss onsets, or did the matcher
reject them?" is a 5-minute scroll. We need it to be a 5-second
glance.

**Deliverable.** `cargo run --bin inspect-session -- <log.json>` prints
a single-page summary plus a per-beat ASCII timeline.

**Shape:**

```
$ cargo run --bin inspect-session -- session_logs/1715800000-180bpm.json

Session: 180 BPM 16ths, electric-guitar (profile v1)
Duration: 22.4s | 60 beats expected | 240 onsets expected (4 per beat at 16ths)
Detected onsets: 217 | Matched: 178 | Spurious: 39 (16.4%)
Mean dev: -3.2ms | σ: 12.8ms | Grid correlation: 0.81
Score: 73 | Components: ic=78 ga=84 hc=71 oe=61

Beat timeline (·=miss  o=ok  +=good  *=perfect  !=spurious cluster):
beat   0:  * + + +    beat  15:  o + + *    beat  30:  * * * +    beat  45:  + o · +
beat   1:  * * + o    beat  16:  + + · *    beat  31:  + + · o   !beat  46:  · · ! +
...

Low-confidence onsets (conf < 0.5): 12 — at beats 28-32 and 51-55
Refractory floor used: 26ms (instrument floor 20ms × subdiv 75ms × 0.35)
```

**Must include:**
- Per-beat classification timeline with miss/spurious annotations.
- Refractory + window values used (so we can sanity-check D2/D3a math).
- Confidence histogram or list of low-confidence beats.
- Spurious cluster regions (3+ unmatched onsets within 200ms — usually
  indicates double-counting).

**Lives at** `src-tauri/src/bin/inspect-session.rs`.

**Acceptance.** Run against an existing low-BPM session log and a
freshly captured 180 BPM 16ths log. The output should answer "where is
the score being eaten?" in one screen without opening the JSON.

### P0-DBG-2 — High-BPM scenario battery (real-audio fixtures)

**Why.** The d3d 18-scenario matrix in `timing.rs` (tests from line
2709, `d3d_scenario_01_perfect_run` … `d3d_scenario_18_bpm_change_post`)
exercises
the formula on *synthetic* feedbacks — beat indices, deviations, and
classifications constructed directly. It cannot catch detector
regressions, refractory-period bugs, cluster-window edge cases, or
amplitude-noise interactions. The dsp_fixtures harness covers the
post-match layer. **Nothing currently covers raw-audio at high BPM.**

**Deliverable.** A new test target `tests/highbpm_fixtures.rs` modeled
after `tests/dsp_fixtures.rs` but driven by Layer-2 raw onsets via
`match_and_score`.

```
tests/highbpm_fixtures/
  ├── 160bpm_16ths_perfect.input.json     # raw onsets + expected beats
  ├── 160bpm_16ths_perfect.golden.json    # SessionReport
  ├── 180bpm_16ths_perfect.input.json
  ├── 180bpm_16ths_perfect.golden.json
  ├── 200bpm_16ths_perfect.input.json
  ├── 200bpm_16ths_perfect.golden.json
  ├── 180bpm_16ths_jittered_5ms.input.json   # σ=5ms (good player)
  ├── 180bpm_16ths_jittered_15ms.input.json  # σ=15ms (struggling)
  ├── 180bpm_16ths_drum_buzzroll.input.json  # 6 onsets/beat
  ├── 200bpm_16ths_chord_strum.input.json    # 15ms cluster
  └── README.md
```

Each `.input.json` carries `{ profile, onsets[], expected[] }`. The
harness runs `match_and_score` and asserts against the golden
`SessionReport`. `UPDATE_FIXTURES=1` regenerates goldens.

**Generation.** Use `generate_raw_onsets_perfect/_jittered/_random`
seeded with explicit u64s — these helpers already exist
(`session_log.rs:595-669`). Wrap them in a tiny `cargo run --bin
seed-highbpm-fixtures` that writes all 8 inputs with stable seeds.

**Acceptance.** All 8 fixtures replay byte-identically across runs.
The CI badge for "high-BPM regression suite" goes green and stays
green through any future detector or matcher change.

### P0-DBG-3 — Real-session capture: 180 BPM 16ths regression fixture

**Why.** The c847c91b commit removed `cluster_window_ms` chord merging
from the matcher and pushed it into the detector. That worked at 120
BPM electric-guitar dogfooding — but at 200 BPM 16ths with a heavy
strum, every beat fires multiple onsets within 20ms and the new
ordering may produce different spurious counts. We need *one real*
high-BPM session captured as a fixture so the next refactor can't
silently undo this.

**Workflow.**
1. Boot `bun run tauri dev`.
2. Set BPM 180, subdivision 16, instrument electric-guitar.
3. Play 32 measures (~30 seconds) of clean 16ths.
4. Stop session. Find the log in `session_logs/`.
5. `cargo run --bin dump-fixture -- session_logs/1715xxxxxx-180bpm.json captured_180bpm_16ths`.
6. `UPDATE_FIXTURES=1 cargo test --test dsp_fixtures`.
7. Commit both files with a commit body capturing the audio setup.

**Acceptance.** A new `captured_180bpm_16ths.input.json` +
`captured_180bpm_16ths.golden.json` pair lives in
`src-tauri/tests/dsp_fixtures/`. Any future score drift at 180 BPM
fails the suite.

### P0-DBG-4 — Score-formula playground binary

**Why.** When the d3d scenarios all pass but one of the captured
fixtures drifts, the question becomes "which component changed and
why?" Today this requires editing `timing.rs::compute_score`, adding
println!s, recompiling, and re-running. A standalone playground that
takes a fixture path and prints the component breakdown collapses
that loop.

**Deliverable.** `cargo run --bin score-playground -- <input.json>
[--w1=0.40 --w2=0.20 --w3=0.25 --w4=0.15]` reads a `dsp_fixtures`
input, runs `score_feedbacks`, and prints:

```
Input: captured_180bpm_16ths.input.json (60 feedbacks)

Components (current weights 0.40/0.20/0.25/0.15):
  interval_consistency: 78.2  (σ=11.3ms vs k=12ms)
  grid_alignment:       84.1  (mean class score 0.84)
  hit_completeness:     71.7  (43/60 beats matched)
  onset_efficiency:     61.4  (matched 43 / detected 70)
  ───────────────────────────
  Total:                74.6  → "Good"

With weights 0.50/0.15/0.20/0.15:
  Total:                75.8  → "Good"   (+1.2)

With weights 0.35/0.25/0.20/0.20:
  Total:                73.2  → "Good"   (-1.4)
```

**Why "playground" not "tweaker".** The intent is exploration, not
override. The golden weights stay in `compute_score`; the playground
exists so you can stress-test "what if W1 was higher?" without
recompiling.

**Lives at** `src-tauri/src/bin/score-playground.rs`.

**Acceptance.** Running against `mixed_24beats.input.json` prints the
existing baseline (`score=85` per golden). Running with custom weights
moves the total predictably.

### P0-DBG-5 — Macro: `bun run yames:debug-bpm <bpm>`

**Why.** Tying it all together. A single command that:
1. Boots Tauri dev with a hint to "play 30 seconds at the given BPM."
2. Watches `session_logs/` for the newest file written after launch.
3. On detection, runs `inspect-session` on it.
4. Offers to bake it into the fixture suite via `dump-fixture`.

**Deliverable.** `scripts/debug-bpm.sh` (bash, sourced into
`package.json::scripts` as `yames:debug-bpm`). Uses `fswatch` on macOS
to detect new logs.

**Acceptance.** `bun run yames:debug-bpm 180` opens the app and
auto-prints the inspector view when a session ends. The full
capture → inspect → bake → commit loop takes < 90 seconds.

---

## P0 — DSP Correctness at High BPM (blocks next release)

These items address the specific failure modes documented in
`DSP_AND_COACH_PLAN.md` lines 575–612 that we shipped formulas for
but never validated against real high-tempo audio.

### P0-DSP-1 — Onset density bug at 180+ BPM 16ths

**Symptom (suspected, not yet measured).** At 200 BPM 16ths the
inter-beat is 75ms and the refractory floor calculates to 26ms (drum)
or 26ms (e-guitar, both with `refractory_floor_ms=20`). With ~12ms
detector jitter, a hard strum can fire two transients 25-30ms apart —
either both pass refractory (and we double-count) or one is rejected
and we under-count.

**Investigation steps:**
1. Capture a 200 BPM 16ths session per **P0-DBG-3**.
2. Run **P0-DBG-1** inspector. Look at `detected_onsets` vs
   `expected_beats` count.
3. If `detected > 1.2 × expected`, refractory is too short for the
   instrument. If `detected < 0.8 × expected`, refractory is eating
   legitimate onsets.

**Fix protocol (only after measurement):**
- If over-detection: raise `electric-guitar::refractory_floor_ms` from
  20 to 25ms. Rationale: pick attack durations don't fall under 25ms
  on most setups.
- If under-detection: lower `subdivision_interval_ms × 0.35` to
  `× 0.30`. This widens the floor to be more permissive of fast pick
  attacks while keeping the instrument-specific minimum.
- Bump `INSTRUMENT_PROFILE_VERSION` (currently 1 →  2). Old session
  logs flag as v1 so the inspector can warn "this log was captured
  with older profile defaults."

**Acceptance.** The captured 200 BPM fixture has
`detected_onsets ≈ expected × profile.expected_onsets_per_beat.start`
(± 10%). The d3d_scenario_09 (180 BPM perfect) still passes.

### P0-DSP-2 — Calibration drift scenario in d3d matrix

**Why.** Scenario 5 in d3d (`d3d_scenario_05_constant_late`) tests
"30ms late with calibration disabled." There's no scenario for
"calibration overcorrected" or "calibration confidence collapsed
mid-session." Real-world calibration is noisy; we need a regression
test.

**Deliverable.** Three new d3d scenarios in `timing.rs`:

```rust
#[test]
fn d3d_scenario_19_calibration_overcorrect() {
    // calibration_offset_ms = +20ms applied to player who is
    // actually on-time. Net result: deviations look like -20ms.
    let seg = seg_scenario_with_calibration(
        0, 24, 8, 0, 2.0, 32, 500.0, 0.5,
        20.0,   // applied offset
        0.9,    // high confidence (the bad case — confident & wrong)
        0xD3D_19,
    );
    let (score, _) = score_segment(&seg);
    // Should land 70-85 — interval consistency saves it, grid takes a hit.
    assert_in_band("scenario 19 (calib overcorrect)", score, 70.0, 85.0);
}

#[test]
fn d3d_scenario_20_calibration_collapse_midsession() {
    // First 16 beats with confidence 0.9, last 16 with confidence 0.2.
    // Documents the coach UX path: low-confidence caveat must fire.
}

#[test]
fn d3d_scenario_21_calibration_disabled_with_drift() {
    // calibration_confidence = 0.0 throughout, but player drifts
    // linearly +0.5ms/beat. Tests grid_correlation alone.
}
```

**Acceptance.** All three new tests green, total d3d suite = 21
scenarios.

### P0-DSP-3 — Tempo-aware window verification under amplitude variation

**Why.** The tempo-aware window math
(`window_ms = min(beat_interval_ms × 0.4, 80ms)`) was derived for
uniform-amplitude onsets. Loud spurious onsets are penalty-weighted
2× and quiet ones are 0.3× (per
`DSP_AND_COACH_PLAN.md:626-630`), but this interacts with the window
in unverified ways at fast tempos.

**Deliverable.** Extend d3d_scenario_09 (fast perfect) with two
amplitude-variation variants:

```rust
fn d3d_scenario_09a_fast_perfect_loud_spurious() { ... }
fn d3d_scenario_09b_fast_perfect_quiet_spurious() { ... }
```

The first injects 4 random loud (`amp=0.95`) onsets between beats —
score should drop from the d3d_09 band (85-100) to 65-80 (loud
spurious × 2.0 weight). The second injects 4 random quiet
(`amp=0.15`) onsets — score should stay 80-95 (quiet × 0.3 weight).

**Acceptance.** Both variants land in their bands; total d3d at 23
scenarios.

---

## P0 — Coach Polish (blocks next release)

The coach voice currently shipped works on cold sessions and clean
ones. These items address the voice quality on session 5+ and during
common drill flows.

### P0-COACH-1 — Stamina pattern surfacing into voice

**Symptom.** `detectStaminaPattern` returns rich data (per-band
early-vs-late delta, gated by ≥5 sessions or ≥30 min cumulative), but
no template path in `templateCatalog.ts` consumes it. The pattern is
"detected and dropped."

**Deliverable.**
1. Add a new scenario slot `stamina` to `Vocabulary` in
   `templateCatalog.ts`. Variants per vocab:
   - generic: "Score's dropping past the {staminaMinutes}-minute mark
     again — take 30 seconds, then come back at the same BPM."
   - drums: "Around minute {staminaMinutes} your hands tighten up.
     Drop the BPM 5 ticks and rebuild."
   - electric-guitar: "Twentieth-minute fatigue showing — your picking
     hand is tensing. Shake it out, then resume."
   - (similar for acoustic-guitar / bass / piano)
2. Wire `detectStaminaPattern` into `useSession.ts::generateTip`
   path so it surfaces *once per session* when the gate trips, with
   `coachVerbosity ≥ default`.
3. Gatekeeper rule: stamina tip is preempted by realtime tips
   (priority lower than "you just missed 3 in a row").

**Acceptance.** A test in `src/coach/presetAwareness.test.ts` that
fakes 5 sessions with linear score drop, runs the
`generateTip → templateCatalog` path, and asserts a `stamina` variant
fires.

### P0-COACH-2 — Drill-mode silence

**Symptom.** During an adaptive drill ramp (e.g. 120→160 BPM over 3
minutes), the coach currently emits "good pocket at 120" mid-ramp
because the ramp transitions don't suppress mid-session tips. The
right behavior is to be silent until the ramp completes, then
summarize the whole ramp.

**Deliverable.**
1. Add `inDrillRamp: boolean` to the coach `SessionContext` in
   `useSession.ts`.
2. Gatekeeper rule: in `gatekeeper.ts`, add a new preempt-reason
   `DRILL_RAMP_ACTIVE` that suppresses realtime tips when
   `inDrillRamp === true`.
3. On ramp complete (BPM stops climbing for ≥4 beats at the target
   BPM), emit a `ramp_complete` template with the start/end BPM and
   the score arc.

**Acceptance.** Manual: run a drill 120→160. Mid-ramp coach is
silent. At target: coach speaks a `ramp_complete` line. Test: unit
test the gatekeeper preempt path.

### P0-COACH-3 — History-aware greeting verification

**Symptom.** `buildPriorSummary` produces the right text ("welcome
back, last time you hit 88% at 135 BPM") but the greeting variants in
`templateCatalog.ts::session_start` don't all interpolate the
`priorSummary` placeholder cleanly. Some greet "cold" even when prior
data exists.

**Deliverable.**
1. Audit all 8 `session_start` variants per vocabulary. Each must
   support both a "cold start" and "with prior" path. Add a
   `withPrior` boolean field on the template or split into two slots
   `session_start_cold` + `session_start_returning`.
2. Snapshot test in `templateCatalog.test.ts` that for every vocab,
   for every variant, the returning-greeting includes `{lastScore}`
   and `{lastBpm}` placeholders.

**Acceptance.** All 6 vocabularies × 8 variants × 2 paths = 96
combinations validated. Test added.

---

## P1 — Coach Polish (next-up)

### P1-COACH-1 — Fatigue warmup grace

The current fatigue detector (`onset_efficiency` drops + `interval_consistency`
σ rises over a sliding window) treats the first 30 seconds of a
session the same as minute 5. A cold-start player is *expected* to be
imprecise. Add a 30-second warmup grace before fatigue tips can fire.

**Acceptance.** New scenario in `useSession.test.ts` that asserts no
fatigue tip fires before t=30s even when the σ trend triggers.

### P1-COACH-2 — Recovery confirmation tightening

When the player recovers after a fatigue tip (consistency climbs back
within 8 beats), the coach should say *something* short — currently
it stays silent. Add a `recovery_confirmed` scenario, 1 variant per
vocab.

**Acceptance.** Manual: deliberately miss 5 beats, recover, hear "got
it back" within 2 beats of recovery.

### P1-COACH-3 — Preset-aware "you're at the ceiling again" voice

`detectBpmCeiling` exists and returns the right band. Wire it into a
new `preset_ceiling_hit` scenario that fires once per session when
the player attempts a BPM where `bandMedianScore < CEILING_MEDIAN_SCORE`
and they have ≥3 sessions in that band.

### P1-COACH-4 — Verbosity profiles end-to-end

`coachVerbosity` exists but doesn't fully gate every template path.
`silent` should produce zero utterances. `default` and `chatty`
should differ in *frequency* (gatekeeper cooldown), not just *which
templates*. Audit and tighten.

---

## P1 — DSP Polish (next-up)

### P1-DSP-1 — IQR/MAD-based interval consistency

Current `interval_consistency` uses standard deviation, which is
outlier-sensitive. One badly-late beat can drag σ from 8ms to 25ms.
Replace with median absolute deviation (MAD) scaled by 1.4826
(consistency factor for normal distribution).

**Why P1 not P0.** This will move every existing fixture score.
Doing it before high-BPM real-audio fixtures are baked would mean
re-baking goldens twice.

**Sequencing:** ship P0-DBG-3 first, then this.

### P1-DSP-2 — Bias / jitter split

`mean_deviation_ms` (bias) and `std_deviation_ms` (jitter) are
reported but conflated in the score. A player with a -20ms bias and
σ=3ms is playing very consistently, just early. Coach should say
"shift everything back 20ms" not "tighten up."

**Deliverable.** Expose a `timing_bias` boolean coach signal when
`|mean_deviation_ms| > 12ms AND std_deviation_ms < 15ms`. Add a new
template scenario `bias_only` per vocab.

### P1-DSP-3 — Cross-session pace coaching

When `detectRecurringIssues.bpmCeiling` is non-null AND the player
attempts the ceiling band for the 4th+ time, the coach should say
"this is your 4th attempt at 140 — try 135 for two sessions to
consolidate, then come back." This is the pace-coaching loop the
plan calls out at line 850-870.

---

## P2 — Score Formula Evolution (after polish ships)

### P2-DSP-1 — Confidence-weighted hit completeness

Currently `hit_completeness = matched_beats / total_expected_beats`.
A weak match (confidence < 0.5) counts the same as a strong match.
Should be `Σ(match.confidence) / total_expected_beats`. Coach can
then say "you hit every beat but it was muddy — try articulating
harder."

### P2-DSP-2 — Per-instrument score curve calibration

The 4 component weights `0.40/0.20/0.25/0.15` are the same across all
instruments. Drums (where onset density is intrinsic to the
technique) probably wants higher `onset_efficiency` weight than
piano (where onset density tracks beat density). Expand the
`InstrumentProfile` to carry weights, default to current values,
re-baseline d3d scenarios.

### P2-DSP-3 — Grid-correlation as a soft preempt

If `grid_correlation < 0.3` for 4+ beats, the player isn't playing
to *this* grid — they may be soloing or fill-playing. Score should
stay computed but the coach should say "are you playing the same
groove? grid correlation dropped" once per occurrence. Currently
the score still tries to grade improvisation against the grid.

---

## P3 — Lower-priority polish

### P3-COACH-1 — TTS voice consistency

Sometimes the TTS picks a different voice between session-start and
session-end speak. Pin to a single platform voice per OS in
`tts.rs`.

### P3-COACH-2 — Shuffle bag sizing review

Shuffle bag ring is currently 3 entries. For long sessions (~30
templates emitted) this means the same variant can recur every 4-5
emits. Bump to 6 and re-test variety perception.

### P3-COACH-3 — Three-layer evaluative copy consolidation

`reportStats.ts`, `templateCatalog.ts::session_end`, and the coach's
mini-report at Signal B (via `interventions.ts`) all describe the
same score in slightly different prose. Consolidate into a single
`evaluateScore(score, components, instrument): string` (new file
`src/coach/evaluateScore.ts`) and have all three sites call it.

### P3-DSP-1 — Click cancellation (DEFERRED in original plan)

Still deferred — most setups don't bleed click into mic. Revisit
only if a user reports it.

---

## Sequencing & Risk

```
Week 1 (P0 — debugging pipeline):
  P0-DBG-1 (inspector binary)     ← unblocks every later item
  P0-DBG-4 (formula playground)    ← parallel
  P0-DBG-5 (debug-bpm macro)       ← parallel

Week 2 (P0 — high-BPM real-audio capture):
  P0-DBG-3 (180bpm fixture)        ← needs P0-DBG-1
  P0-DSP-1 (refractory at 200bpm)  ← needs P0-DBG-3
  P0-DBG-2 (synthetic high-BPM)    ← parallel

Week 3 (P0 — DSP & Coach):
  P0-DSP-2 (calibration scenarios) ← independent
  P0-DSP-3 (amplitude variance)    ← independent
  P0-COACH-1 (stamina voice)       ← independent
  P0-COACH-2 (drill silence)       ← independent
  P0-COACH-3 (greeting audit)      ← independent

Week 4+ (P1 / P2 / P3):
  In order of user-visible impact.
```

**Risks:**
- **P0-DSP-1 might move every score by a few points** if refractory
  changes. Mitigation: bump `INSTRUMENT_PROFILE_VERSION`, capture
  fixtures *before* the change (P0-DBG-3 must precede P0-DSP-1).
- **P1-DSP-1 (MAD over σ) is a bigger formula change** than its tier
  suggests. Schedule alongside a real release-note write-up.
- **P0-COACH-2 (drill silence)** might over-silence — players doing
  10-minute ramps may want the occasional "you're still on it"
  reassurance. Land with a 90-second "alive" tick at minimum, not
  full silence.

---

## What we are explicitly NOT doing

- **Click bleed cancellation.** Deferred in the original plan,
  remains deferred.
- **Cloud sync of session logs.** Logs are local-only. Export is a
  deliberate user action (per D1).
- **LLM finetune.** All coach intelligence stays in the three catalogs
  (template, narrative, preset) plus a local rephrase model. No
  finetune.
- **New instrument profiles beyond current 6.** Mandolin / violin /
  saxophone are tempting but adding a profile means re-baselining
  d3d scenarios for it; out of scope for polish.
- **Mobile.** Tracked in `MOBILE_IMPLEMENTATION_PLAN.md`.
- **Accent pattern UI overhaul.** Tracked in `ACCENT_PATTERN_PLAN.md`.

---

## Open Questions

1. **Where does the inspector visualization live long-term?** A CLI
   binary is fast to ship, but a `cargo run` flow doesn't help when a
   user reports a bug. Consider a Tauri-side "open log inspector"
   command for v0.10.
2. **Should `dump-fixture` capture calibration state?** Current code
   defaults `calibration_offset_ms=0.0, calibration_confidence=1.0`.
   The session log carries calibration in `report` but not in
   per-beat fields. P0-DSP-2 scenarios will need a way to opt-in.
3. **Are the d3d scenarios drifting from the plan's targets?** Several
   landed wider than spec (scenarios 5 and 11 at 85-100 vs plan
   75-85). Document as known trade-offs or re-tune weights — pick a
   stance.

---

*Created 2026-05-18. Maintained alongside `DSP_AND_COACH_PLAN_STATUS.md`
— update both when phase items ship.*
