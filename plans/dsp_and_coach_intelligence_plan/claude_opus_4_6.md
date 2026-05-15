# Plan Review: DSP Scoring & Coach Intelligence

## D1 — Diagnostic Logging

**Generally solid, but one structural issue:**

**Session log storage is append-only with no corruption guard.** JSON files in `session_logs/` with auto-prune to 50. If the app crashes mid-session, you get a truncated JSON file that's unparseable. Either use JSONL (one JSON object per line, append-safe) or write a temp file and rename atomically on session end. This is a debug tool — losing a file to crash is annoying but not fatal — but it's cheap to get right and you'll hit it during development when you're most likely to be killing the process.

**The synthetic test helpers are coupled to the wrong abstraction.** The tests generate `BeatFeedback` sequences and feed them to `score_feedbacks`. But D3 changes the scoring inputs — you now need detected onsets, expected beats, match decisions, and spurious onsets to compute the new formula. The test helpers need to generate `SessionLog`-level data (or at least the four sub-vectors), not `BeatFeedback`. If you build helpers around the old interface first, you'll rewrite them entirely in D3. **Recommendation:** Stub the test helper signatures against the D3 scoring interface now, even if D3 isn't implemented yet. The helpers are useless until D3 anyway.

---

## D2 — Onset Detection Hardening

**Refractory period formula has a hidden dependency on subdivision accuracy.**

`refractory = max(20ms, subdivision_interval * 0.35)` requires knowing the correct subdivision. But the subdivision is user-configured (or inferred from grid correlation). If the user sets quarter notes but plays 16ths, the refractory period is `max(20, 500 * 0.35) = 175ms` — which swallows every other 16th note at 120 BPM (interval = 125ms). The plan acknowledges subdivision mismatch in assumption #2 (onset efficiency), but doesn't propagate the fix back to the refractory period. **If grid correlation detects double-time playing, the refractory period must also adapt.** Otherwise you're filtering out the very onsets you just decided to score.

**Adaptive noise floor: "first 2 seconds after audio starts" is fragile.**

What if the user starts playing immediately? What if there's a transient noise (chair scrape, cough) during those 2 seconds? Two seconds of silence before playing is an assumption about user behavior that won't always hold. The plan says "re-measure when signal drops below threshold for >5 seconds" — but if the initial measurement is wrong, the threshold is wrong, and the signal may never drop below it. Consider a running percentile (e.g., 10th percentile of RMS over a sliding 5-second window) instead of a one-shot measurement. It's marginally more expensive but self-correcting.

**The 20ms refractory floor claim is wrong for percussion.**

"No real instrument produces two distinct attacks faster than that" — a snare buzz roll can produce distinguishable attacks at 10-15ms intervals. Flam strokes on drums are typically 10-30ms apart. The plan lists drummers as a future audience (multi-drum classification is in the backlog). A 20ms floor will merge flams into single onsets. This is probably acceptable for now, but the plan states it as physics rather than a design choice. Call it what it is: a simplification that trades flam detection for noise rejection.

**Onset confidence scoring is defined but never thresholded in D3.**

D2 adds confidence to each onset. D3's scoring formula (interval consistency, grid alignment, hit completeness, onset efficiency) never references confidence. Assumption #14 mentions it for coaching, but the scoring pipeline ignores it. If a low-confidence onset matches a beat, it contributes the same to hit_completeness and grid_alignment as a high-confidence onset. Either:

- Weight each onset's contribution to scoring by its confidence (as the plan hints at but never formalizes), or
- Decide confidence is coaching-only and say so explicitly.

Right now it's ambiguous, and the implementer will have to guess.

---

## D3 — Scoring Architecture Overhaul

This is the core of the plan and where the most issues live.

### 3a. Tempo-Aware Matching Windows

**The 80ms cap creates a discontinuity.**

`min(beat_interval * 0.4, 80ms)` means the window is proportional below 200ms intervals (BPM > ~150 for quarters) and fixed above. At the transition point (beat_interval = 200ms, i.e., 300 BPM quarters or 150 BPM 8ths), the behavior changes. This is fine mathematically but creates a grading cliff: at 149 BPM 8ths you get a proportional window, at 151 BPM 8ths you get a fixed one. Classification thresholds jump. In practice this probably doesn't matter because the transition is at a comfortable tempo, but it's worth noting in case users report inconsistent difficulty scaling around 150 BPM 8ths.

**Classification thresholds at fast tempos may be below detection resolution.**

At 200 BPM 16ths: `perfect < 6ms`. The plan's onset detection operates on audio buffers. At 48kHz sample rate with a typical 1024-sample hop size, time resolution is ~21ms. You literally cannot distinguish a 5ms deviation from a 15ms one — they might land in the same analysis frame. The "perfect" threshold is below the system's temporal resolution. Either:

- Acknowledge that "perfect" at 200 BPM 16ths is effectively unachievable (which changes score expectations for scenario 9), or
- Use sample-level onset refinement (quadratic interpolation around the flux peak) to get sub-frame resolution. This is standard in onset detection but isn't mentioned in D2.

**This is the single biggest technical risk in the plan.** If onset timestamps have ±10ms jitter from frame quantization, the proportional thresholds at fast tempos produce random classifications. Scenario 9 ("perfect 16ths at 180 BPM, score 90+") may be impossible to pass.

### 3b. Spurious Onset Tracking

**`onset_efficiency` penalizes instruments with natural resonance and sympathetic vibration.**

An acoustic guitar player fretting a chord will often produce sympathetic string vibrations that the onset detector picks up as separate events. A piano sustain pedal creates overlapping resonances. These aren't "random noodling" — they're artifacts of the instrument's physics. The amplitude weighting helps (sympathetic vibrations are quieter), but "quiet spurious onsets penalized less" is vague. How much less? Linear scaling? Threshold cutoff? This needs a concrete formula.

**The double-strike handling contradicts onset_efficiency.**

"Additional onsets near the same beat are neutral (neither rewarded nor penalized)" — but they ARE counted in `total_detected_onsets` for the efficiency ratio. If a drummer hits the snare with a slight double-bounce (extremely common), they get 64 detected onsets for 32 beats. That's efficiency = 0.50, contributing a score of 50 to the onset_efficiency component. That's a 10-point penalty on the final score (0.20 × 50 vs 0.20 × 100) for a completely normal playing technique. The plan needs to either:

- Exclude near-beat additional onsets from `total_detected_onsets`, or
- Define "near the same beat" precisely and implement it.

Assumption #13 discusses the matching ambiguity but not this counting problem.

### 3c. The Formula

**The weights produce some counterintuitive results. Let me run scenarios:**

**Scenario: Perfect timing, miss half the beats (play only beats 1 and 3 of each bar in 4/4).**

- interval_consistency: 100 (perfectly even, just at half the rate) — **wait, this is wrong.** If expected interval is 500ms (quarter notes at 120 BPM) and actual interval is 1000ms (half notes), the deviation is 500ms per pair. Interval consistency should be terrible. But the plan says "standard deviation of (actual_interval - expected_interval)" — if expected_interval correctly reflects the quarter-note grid, this works. But what's the "expected interval" for a player who only hits half the beats? Is it the grid interval, or the interval between their actual onsets? The plan says "consecutive onset pairs" — so it's measuring the player's own intervals against expected. If you skip beats, your actual interval is 2× expected, giving high deviation. **This is correct behavior but needs to be explicitly stated.**

**Scenario: The formula can be gamed by playing very slowly.**

At 60 BPM quarter notes, the matching window is `min(400, 80) = 80ms`. A player could set a very slow tempo, play with mediocre timing (±40ms), and still score "good" on everything. Meanwhile the same ±40ms at 180 BPM would be catastrophic. This is actually correct behavior (±40ms at 60 BPM IS less of a timing problem than at 180 BPM), but it means scores aren't comparable across tempos. A "92% at 60 BPM" is much easier to achieve than "92% at 180 BPM." The coach and history features need to account for this — comparing scores across tempos without normalizing is misleading.

**Scenario: onset_efficiency + hit_completeness double-count silence.**

A player who plays nothing: 0 detected onsets, 0 matched beats.

- hit_completeness: 0/32 = 0
- onset_efficiency: 0/0 = **undefined**

What's the onset_efficiency of zero onsets? The plan doesn't handle division by zero. Similarly, a player with 1 onset matched to 1 beat: efficiency = 1.0 (perfect!), completeness = 1/32 ≈ 0.03. They score 0.35×(?) + 0.25×100 + 0.20×3 + 0.20×100 = at least 45 points for hitting one note perfectly. That seems too generous.

**The interval_consistency metric is undefined for ≤1 onset.**

Standard deviation of consecutive onset pairs requires at least 2 onsets (1 pair). With 0 or 1 onsets, it's undefined. The minimum data gate (assumption #7) says <8 beats → no grade, which covers this, but what about 2-7 onsets? The gate says <16 beats gets qualitative feedback, but the formula still needs to produce a number for 8-15 onsets. With 8 onsets you have 7 interval pairs — enough for a noisy standard deviation but not a stable one.

### 3d. Validation Test Matrix

**Scenario 5 ("all beats hit, consistently 30ms late") expected score 75-85 is suspicious.**

Let's compute:

- interval_consistency: 100 (perfectly even, just shifted)
- grid_alignment: depends on classification. At 120 BPM, window = 80ms, "good" threshold = 40ms. 30ms late → "good" (score 80). So grid_alignment ≈ 80.
- hit_completeness: 100
- onset_efficiency: 100

Score = 0.35×100 + 0.25×80 + 0.20×100 + 0.20×100 = 35 + 20 + 20 + 20 = **95**.

That's way above the expected 75-85. For a 30ms-late player to score 75-85, either the grid_alignment penalty needs to be much harsher, or the expected range in the test matrix is wrong. **This is either a formula bug or a test expectation bug.** Given that the plan's philosophy is "latency doesn't matter, spacing does," a score of 95 for consistently-30ms-late playing actually aligns with the philosophy. The test expectation of 75-85 contradicts the stated design goal.

**Scenario 7 ("double-time, 2 onsets per beat") depends entirely on how assumption #2 resolves.**

If grid correlation detects double-time and adjusts expected_onsets, this player scores ~90+. If not, onset_efficiency tanks to 0.50 and the score drops to ~70. The expected range of 70-80 implies assumption #2's harmonic detection is NOT applied in this scenario. That should be explicit.

**Scenario 6 ("perfect for 8 bars then stop, score 90+") depends on activity detection (D4), which is sequenced AFTER D3.**

The test matrix is for D3 validation, but scenario 6 requires D4's pause handling. If D4 isn't implemented when D3 is tested, the "stop" portion counts as misses and the score drops well below 90. Either move scenario 6 to D4's validation, or implement the minimum activity detection needed for this scenario within D3.

---

## D4 — Activity Detection Refinement

**"Each segment gets scored independently and contributes to the final weighted average" — weighted by what?**

Duration? Number of beats? If weighted by duration, a 30-second segment of terrible playing followed by 5 minutes of good playing gets a great score. If weighted by beat count, same result. If weighted equally, a brief warm-up stumble permanently drags the score down. The weighting strategy is unspecified and matters a lot for perceived fairness.

**Segment boundary at "grid correlation changes significantly (0.9 → 0.1)" is a scoring event, not just a structural marker.**

If a player loses the groove for 4 beats (correlation drops to 0.1) and then locks back in, should that be a new segment? That seems like over-segmentation. A brief fumble shouldn't create a tiny terrible segment that drags down (or gets discarded from) the weighted average. Consider a minimum segment length (e.g., 8 beats) before finalizing a segment boundary.

---

## C1 — Session Narrative

**"Turning segmentReportsRef into a text narrative is straightforward" understates the work.**

The narrative example includes interpretive statements like "solid pocket, slight rushing on beat 3." That's not raw metrics — that's coaching language. Who generates this text? If the template engine, it needs beat-level analysis to identify "rushing on beat 3." If the LLM, you're running inference on every segment boundary just to build the narrative, which then gets fed back into the LLM for the actual coaching query. That's two inference calls per segment. The plan should specify whether narrative entries are structured data (easy) or natural language (requires generation).

---

## C4 — Smart Coaching Timing

**The heuristic gatekeeper + model content architecture has a latency UX problem not addressed by "0.8s is fine."**

The issue isn't the 0.8s inference time — it's that the heuristic fires, THEN you wait for the model. If the model decides "skip this one," you've burned 0.8s of compute for nothing. At scale (many heuristic events), this could cause GPU contention with other model queries (greetings, chat, summaries). Consider batching: let heuristic events accumulate for a few seconds, then send one query with all of them.

**"The model can decide 'I just said something 30 seconds ago, skip this one'" is giving the LLM veto power over the heuristic layer.**

This means the actual coaching frequency is non-deterministic and depends on model mood. If the model is overly cautious, the coach goes silent for long stretches. If it's aggressive, it comments constantly. The heuristic cooldown already controls frequency — the model shouldn't also be deciding whether to speak. Let the heuristic control WHEN and the model control WHAT. If the heuristic says speak, the model speaks. This is simpler, more predictable, and debuggable.

---

## C5 — Coach Personality

**"3-5 templates per scenario" is too few for sessions longer than ~15 minutes.**

If the heuristic fires every 30-60 seconds for "accuracy dropped" events, and there are 5 templates for that scenario, you exhaust the shuffle bag in 2.5-5 minutes. Then it refills and repeats. In a 30-minute session, the user hears each template 6 times. Either:

- Parameterize templates heavily so the same template sounds different with different metrics, or
- Accept that template mode is noticeably inferior for long sessions and document it.

---

## Cross-Phase Issues

### Hidden dependency: D3 → D4 → D3 validation

D3's test scenario 6 needs activity detection. D3's interval_consistency during adaptive drills needs per-beat expected intervals that update with BPM (assumption #3). D4 defines segment boundaries that affect how the formula is applied. But D3 is sequenced before D4. This means either:

- D3 ships with a simplified activity model and gets reworked in D4, or
- D4's segment logic is partially pulled into D3, blurring the phase boundary.

The plan should acknowledge this and decide which approach to take.

### Hidden dependency: D2 onset confidence → D3 scoring (unresolved)

As noted above, confidence is defined in D2 but never consumed by D3's formula. If confidence is later added to scoring, it changes the formula weights and invalidates the test matrix. Decide now.

### Calibration and interval_consistency interact in an unspecified way

Auto-calibration adjusts for system latency by computing a running offset. Interval consistency measures `actual_interval - expected_interval`. If calibration adjusts onset timestamps before interval computation, the intervals are calibration-dependent (contradicting "immune to latency"). If calibration only applies to grid alignment, intervals are raw — which is correct, but the plan doesn't specify which path the data takes. This is an implementation detail that matters for correctness.

---

## Summary of Highest-Risk Items

1. **Onset temporal resolution vs. fast-tempo thresholds (D3a).** If onsets have ±10ms frame-quantization jitter, proportional thresholds at fast tempos produce noise. This could make scenarios 9-10 fail and undermine the entire proportional-window design. Needs sub-frame onset refinement or relaxed thresholds.

2. **Double-strikes counted in onset_efficiency denominator (D3b).** Common playing techniques (drum bounces, guitar pick noise) inflate total_detected_onsets and silently penalize normal players by ~10 points.

3. **Test scenario 5 expected score contradicts the formula (D3d).** The formula produces ~95 for consistently-30ms-late playing; the test expects 75-85. Either the formula or the test expectation is wrong. This needs resolution before implementation or the engineer will be tuning to the wrong target.

4. **D3 test scenario 6 depends on D4, which ships later.** Either resequence or acknowledge the dependency.

5. **Refractory period doesn't adapt to detected subdivision mismatch (D2↔D3).** The onset detector and the scorer handle subdivision mismatch independently, but the refractory period only uses the user-configured subdivision.
