# Plan Review: DSP Accuracy & Coach Intelligence

> **Revised 2026-05-15 (rev 1)** after author response and clarification that the coach
> runs on a **local LLM** (Phi/Gemma/Llama-class on consumer hardware), not a
> Sonnet/GPT-4-class online model. Four findings were softened or removed where
> the author's pushback was fair; several others were sharpened where the
> local-model constraint makes them more critical, not less. See the
> *Local Model Considerations* section below.
>
> **Revised 2026-05-15 (rev 2)** after author proposed adding an
> **instrument-type setting** (drums, electric guitar, acoustic guitar, bass,
> piano). This is a high-leverage architectural lever that resolves several
> findings outright and reshapes others. A new proposed phase **D0 — Instrument
> Profiles** has been added, and findings in D2, D3, C5, and the open-questions
> list have been updated to consume an instrument profile rather than hardcoded
> constants. See the new *Instrument Awareness* section below.
>
> **Revised 2026-05-15 (rev 3)** — feasibility assessment and strategy for
> maximizing the "WOW" effect on consumer hardware. Two new sections:
> *Maximizing WOW on a Local Model* (where the wow actually comes from, and
> how to extract it) and *The Variety Budget Problem* (the month-2 fatigue
> risk and specific mitigations). Recommendations updated accordingly.
>
> **Revised 2026-05-15 (rev 4)** — coach UX architecture correction. The
> previous "default to silence" mitigation conflated frequency with fatigue
> and was wrong for a metronome app where the user's eyes are on the
> instrument, not the screen. Four new sections replace and extend the
> earlier coach-timing material: *Exercise-Boundary Detection & Coach
> Timing*, *Two-Tier Notification System* (TTS as primary channel during
> play, written feed as the coach's notebook), *Actionable Interventions*
> (the BPM-drop suggestion pattern), and *User-Initiated Q&A via Suggestion
> Chips*. The variety budget mitigation is rewritten around event-driven
> gating instead of silence. Recommendations and feasibility verdict
> updated; LLM-as-narrator score moves from 7.5 to 8.5/10 because the chip
> architecture removes the LLM from the hot path for most Q&A.

## Headline Issues (the things I'd push back on hardest)

### 1. The scoring formula in D3c does not produce the scores claimed in D3d's test matrix

This is the single biggest problem. Let me work three scenarios with the proposed weights and the proposed component definitions:

**Scenario 2 — Perfect, but miss every other beat (target: 45–55)**

If `hit_completeness = matched_beats / expected_beats` and the player nailed half the beats with perfect placement:
- interval_consistency: the 16 onsets the player did hit are perfectly evenly spaced at 2× the interval — that's still constant spacing, so σ ≈ 0 → **100**
- grid_alignment: every onset that exists is perfect → **100**
- hit_completeness: 16/32 → **50**
- onset_efficiency: 16/16 → **100**

Score = 100·0.35 + 100·0.25 + 50·0.20 + 100·0.20 = **90**

The test says 45–55. The formula says 90. One of them is wrong — and a 90 here is the kind of bug that erodes trust on day one, because skipping every other beat clearly should not be an A.

**Scenario 5 — All beats hit, consistently 30ms late (target: 75–85)**

At 120 BPM, window_ms = 80, so 30ms falls inside the "good" band (≤40ms).
- interval_consistency: constant offset → σ = 0 → **100**
- grid_alignment: all "good" → **80**
- hit_completeness: **100**
- onset_efficiency: **100**

Score = 35 + 20 + 20 + 20 = **95**. Target 75–85. Off by 10–20.

Also: "30ms late" is exactly what auto-calibration is supposed to remove. If calibration is working, scenario 5 collapses to scenario 1 and scores ~98. The plan doesn't say whether the test runs through or around calibration. Without that, the expected range is undefined.

**Scenario 11 — Even spacing, offset 25ms (target: 70–80, "interval dominates")**

Same math as scenario 5 but tighter offset → grid_alignment closer to ~85. Score ≈ 96. Target 70–80.

The narrative "interval dominates" is incompatible with the weights. With 0.35 on interval and 0.25 on grid, the gap is only 0.10. When all four components are high, interval can't "dominate" the result — it can only nudge it. The targets in the test matrix imply weights closer to 0.55 / 0.15 / 0.15 / 0.15 than 0.35 / 0.25 / 0.20 / 0.20.

**Recommendation:** Before writing any code, sit down with a spreadsheet, plug each of the 12 scenarios into the formula with explicit numbers for every component, and see if the totals land in the target bands. They currently don't. Either the weights need to move, or the targets need to move. Don't discover this in Rust.

---

### 2. The formula can be gamed by under-playing

`onset_efficiency = matched_onsets / total_detected_onsets` is a ratio, so playing fewer notes (as long as those notes match beats) keeps it at 1.0. Combined with `hit_completeness` only counting "active" beats, the gaming strategy is:

> Play 4 perfectly-timed quarter notes. Stop for the rest of the bar. Repeat.

Under the proposed definitions:
- Activity detection marks the silent gaps as resting → they don't count
- `hit_completeness` = 100 (of the beats we're "active" for)
- `interval_consistency` = 100 (perfectly even within each played bar)
- `onset_efficiency` = 100 (every onset matched something)
- `grid_alignment` = 100

You get an S grade for playing 25% of the beats. This is a worse failure mode than the current "rewards random playing" bug — it rewards strategic laziness.

The fix is structural: `hit_completeness` needs a denominator that doesn't shrink based on the player's choices, OR there needs to be a coverage penalty separate from activity detection.

---

### 3. The "no spurious onsets unless far from any beat" rule is exploitable by tremolo / drum rolls

A guitarist doing a fast tremolo near a beat produces 6–8 onsets all within ±40ms of that beat. Under D3b: "Only onsets far from ANY beat penalize." So all 8 register as "near a beat," none penalize, onset_efficiency stays at 1.0. The plan needs a per-beat cap on how many onsets "count as near" before the rest become spurious — or a different framing entirely (e.g., onset density vs expected density per window).

**With instrument profiles (proposed D0), this becomes natural:** drums allow
up to ~6 onsets per beat (legitimate buzz rolls), guitar caps at ~3 (chord
strums hit slightly apart, but tremolo beyond that is sloppy), bass caps at 2,
piano allows ~8 (chord voicings + ornaments). The per-beat cap is no longer a
magic number — it's `instrument.max_onsets_per_beat`. The exploit is only
viable when the player exceeds their own instrument's realistic ceiling.

---

### 4. Interval consistency has no defined ms→score mapping

This is the most-weighted metric (0.35) and the plan never says how a standard deviation in milliseconds becomes a 0–100 number. Linear scaled by what range? Exponential decay with what time constant? Capped at what σ? This is the single most important constant in the entire scoring system and it's missing. Without it, scenarios 11 and 12 — which are designed to test interval vs grid separation — are untestable because the interval-component score is undefined.

**Proposed shape:** Gaussian decay, `score = 100 × exp(-σ² / (2k²))`, where `k`
must be **tempo-aware** (e.g., `k = window_ms × 0.4`). A global `k` is wrong —
σ=30ms is sloppy at 60 BPM but unplayable at 200 BPM 16ths. Reuse the
tempo-aware window logic from D3a so strictness scales the right way.

---

## Phase-by-Phase Findings

### D1 — Diagnostic Logging

- **`MatchDecision` struct contradicts D3b.** The single `onset_index?` implies a 1:1 beat-to-onset relationship. D3b explicitly allows multiple onsets per beat. Either the struct is `Vec<onset_index>` or D3b's multi-onset-per-beat model needs a separate structure.
- **`DetectedOnset.confidence` is referenced in D1 but defined in D2.** If D1 ships first (the sequencing says it does), what fills this field? Default of 1.0? That makes the field useless until D2 lands.
- **`generate_random_onsets(32, 120, 3.0)` is not deterministic.** Synthetic tests have to be reproducible. The plan needs explicit seeds and a defined random distribution (uniform within bar? Poisson? Truncated Gaussian around grid?). Without that, "score < 30" is a flaky test.
- **`score_feedbacks(&feedbacks)` bypasses the matching layer.** The synthetic test helpers operate on `BeatFeedback` sequences — i.e., after matching has already happened. So D3a (tempo-aware windows) is not testable with these helpers. To validate D3a you need synthetic helpers that produce *raw onsets* and exercise the matching pipeline. The plan only provides post-match synthetics.
- **"Auto-prune to last 50" has no size budget.** A 30-minute session log with hundreds of onsets, hundreds of beats, and per-event metadata could be 1–2 MB. 50 logs = 50–100 MB. For a desktop app this is fine, but it needs to be a stated trade-off, not implicit.
- **`export_session_logs` and the 100% local / no telemetry principle.** If logs are exported and shared with a developer, that's a privacy story that needs to be told to users explicitly, or at least the export needs to redact identifiable hooks.

---

### D2 — Onset Detection Hardening

- **Refractory key contradicts polyrhythmic / over-subdivision practice — and the 20ms floor is wrong for non-drums.** `refractory = max(20ms, subdivision_interval × 0.35)` keys off the *grid* subdivision, not what the player is doing. If the grid is quarter notes (500ms) and the player practices 16ths against it (musically valid — and explicitly anticipated by Open Question #2), refractory = 175ms suppresses every off-grid 16th note. **With instrument profiles**, the floor becomes `instrument.refractory_floor_ms`: drums ~15ms (drum rolls), piano ~20ms (trills), bass ~35ms, electric guitar ~40ms, acoustic guitar ~50ms. The grid-subdivision multiplier should be dropped entirely — refractory should depend on the *instrument*, not the metronome setting. A grid of quarter notes doesn't physically prevent the player from playing 16ths.
- **Ambient noise floor assumes the user isn't playing in the first 2 seconds.** There's no signal for "playing started" — onsets are how you detect playing. If a user clicks start and immediately strikes a note, the ambient measurement window samples a loud transient and the noise floor goes to 3× peak → nothing is detected for the rest of the session. Needs either an explicit "calibrate now / start playing now" two-button flow, or a continuously-updated noise floor estimate (e.g., 10th-percentile RMS in a rolling window).
- **"Re-measure when signal drops below threshold for >5s" is circular.** The "threshold" is the noise floor we're trying to set. Use a separate (lower) detection threshold for "playing has stopped."
- **Confidence flows into matching/scoring how, exactly?** D2 says "low-confidence onsets get less weight in scoring." D3c never mentions confidence. Either confidence multiplies into one of the four components or it's vestigial.
- **Click cancellation deferred — but the noise floor is sampled before playing starts, when the metronome IS playing.** So the noise floor already includes click bleed. The plan handwaves "the adaptive noise floor + amplitude threshold already filter most bleed" without quantifying it. At minimum, the calibration window should be aligned to silent portions between clicks.

---

### D3 — Scoring Architecture Overhaul

Beyond the headline issues above:

- **`window_ms = min(beat_interval × 0.4, 80ms)`: cap is undocumented.** 80ms is reasonable in practice for the tempos this app cares about, but the rationale should be written down so it can be re-evaluated when behavior surprises someone. Validate via the test matrix that beginners at slow tempos still land in the "good" band — not a blocker, just a note.
- **Perfect classification at 200 BPM 16ths requires < 6ms accuracy.** That's below the resolution of typical onset detection from spectral flux (which has ~5–10ms inherent jitter). Effectively no one will ever score "perfect" at 200 BPM 16ths, even with deterministic playback. Either the perfect band needs a floor, or the test matrix scenario 9 ("Perfect 16ths at 180 BPM: 90+") will fail because perfect playback registers as "good" only.
- **`hit_completeness` only counts active beats** but activity is defined by onset density, creating the gaming loophole described in Headline #2.
- **Quiet-noise spam between beats — lower severity than I first claimed.** The amplitude-weighted spurious penalty means quiet random onsets contribute little. In theory exploitable, but D2's adaptive noise floor (ambient × 3) gates most low-amplitude artifacts before they're ever detected. A density-cap safety net (penalize when onset density > 2× expected_density regardless of amplitude) is still worth adding, but this isn't day-one critical.
- **`onset_efficiency` thresholds vary wildly by instrument.** A drummer producing 2.5 onsets per beat (ghost notes, hat work, snare comp) is *normal*, not noisy. A bassist producing the same density is over-playing. Without instrument context, `onset_efficiency = matched_onsets / total_detected_onsets` will either over-penalize drummers or under-penalize bassists. With D0 profiles, `expected_onsets_per_beat_range` lets the metric scale: efficiency = `clamp(matched_onsets / max(total_onsets, expected_onsets × beats), 0, 1)` rather than the raw ratio.
- **`grade S–F` mapping is not in this plan.** The current grading thresholds are implicit. If they're carried over from the existing system, the formula change could shift the entire S–F distribution. A 70 today might be a B; with the new formula it might be an A. User-facing grade expectations need re-anchoring.
- **No specification of how segments combine in scoring.** D4 mentions per-segment scoring and "weighted average," but the weighting function isn't defined. Weighted by duration? By beat count? Equally? This affects how a "great start, bad finish" session scores vs. "bad start, great finish."

---

### D3d — Validation Test Matrix

- **Scenario 7 ("Double-time, 70–80") contradicts Open Question #2** ("when grid correlation at harmonic subdivision > 0.7, adjust expected_onsets"). If the adjustment is made, double-time should score *high*, not 70–80. The plan needs to pick one — and the test matrix is the right place to encode the answer.
- **Scenario 6 ("Perfect for 8 bars, then stop: 90+") needs precise definition.** What does "stop" mean for the test? If the session truly ends, why is the partial-session scored at all? If the player just rests for the remaining bars, activity detection should remove them — but where's the transition counted?
- **Scenario 4 ("Random onsets, accent on beat 1 only: <35")** is described as "the known bug" but the synthetic test definition is unclear. Is this random onsets with periodic louder onsets every 4 beats? With a single louder onset at the very start? Both are valid interpretations of "accent on beat 1."
- **No scenarios cover swing.** Open Question #5 says swing must remain implementable. A scenario like "perfect dotted-8th + 16th pattern against straight grid: <X" would validate that the architecture survives a swing extension. Without it, swing is a verbal commitment.
- **No scenarios cover tempo changes mid-session** (adaptive drill is core to the app). Open Question #16 raises this; the test matrix doesn't address it.

---

### D4 — Activity Detection Refinement

- **"N beats of silence scales with time signature" but not tempo.** A 4-bar rest in 3/4 at 60 BPM is 12 seconds; at 200 BPM it's 3.6 seconds. The scaling factor should be `beats × beat_interval`, not just `beats`.
- **"Segment boundary when grid correlation changes significantly"** — threshold is undefined. 0.9 → 0.1 is given as an extreme example, but the actual trigger threshold is vague. Is it any 0.3 drop? An absolute floor crossing?
- **D4 is sequenced after D3, but D3's hit_completeness depends on activity detection.** If D4 changes how activity is detected, D3's test matrix has to be re-run. Real risk of rework. See Sequencing section below.
- **D4 should also emit the Signal B boundary event** (sustained play → activity gap) used by the new *Exercise-Boundary Detection & Coach Timing* design. Same underlying signal D4 already tracks for "is the player playing right now"; the extension is emitting a typed `PracticeSegmentEnded` event with rolling score, duration, BPM, and instrument when the 30s-play-then-4s-silence pattern fires. The "did great then stopped" sub-event (segment score ≥ 85% at gap onset) is the single highest-leverage coach moment in the product.

---

### C1 — Session Narrative

- **"A few hundred bytes" vs Open Question #8's 2KB cap — and this matters more for a local model.** Internal contradiction. A 30-minute session with coach comments every 30s is roughly 60 entries × 80 chars ≈ 5KB unconstrained. With a local model (typical context 4–8K tokens, of which the system prompt + recent chat already consume a chunk), a runaway narrative will silently push other context out. Pick a number, document the truncation strategy (keep session-start + last N + most-recent segment summary), and stress-test against the target model's effective context budget.
- **Coach's prior outputs included in narrative → recursive context.** Feeding the coach's own past utterances back into its context risks style amplification (the model echoes its own phrasings) and apologetic loops ("as I said before..."). For local models this is worse — smaller models are more prone to repetition and echoing. Either strip coach lines from narrative on read, or summarize them ("[coach gave 3 tips, last one about beat 3]").
- **Text format is the right call for local models** (concession to author). Natural language is more reliably parsed by Phi/Gemma-class models than structured JSON. Earlier critique on token economy withdrawn.

---

### C2 — Context-Aware Greetings

- **"Suggest a target" of last session's score + epsilon assumes monotone improvement.** Off days exist. Telling a struggling user to beat their personal best is demoralizing. Need a heuristic that considers recency / trajectory / time of day.
- **"This week" / "putting in solid work" is undefined.** Rolling 7 days? Calendar week starting Monday? And what threshold is "solid work" — 3 sessions? 5? The template engine can't make this choice without spec.
- **Greeting fires at session start, but session history is loaded async.** Race condition if the store load hasn't resolved by the time the greeting builds. Either the greeting has to await store load, or there needs to be a "history-light" greeting fallback for the first session after launch.
- **LLM "naturally infers" preset name semantics — this assumption is the load-bearing risk for the entire LLM-mode coach.** The plan repeatedly relies on the model "naturally" doing something: inferring preset meaning, varying phrasing, deciding when to stay silent, knowing what to comment on. These behaviors are reliable on Sonnet/GPT-4-class models. On Phi-3/Gemma-2B-class local models, they range from "sometimes works" to "doesn't." Since the app is explicitly local-only, every place the plan says "the model naturally..." needs either (a) an empirical test against the target model, or (b) a heuristic/template fallback that doesn't depend on inference quality. The greeting flow is one example — preset-name semantics should be parsed by code (keyword tags on the preset object), not inferred from the name string.

---

### C3 — Preset Awareness

- **"Preset change mid-session": is it the same session or a new one?** The session_log keys off preset. If preset changes mid-session, do you write two log entries? Continue with a marker? Affects whether `compactPresetSummary` sees a 10-minute Spider Exercise + 10-minute Groove 3 as two short sessions or one long one.
- **"BPM threshold where accuracy drops" needs an aggregation rule.** Per session → per-session BPM at which score crossed 70%. Across sessions → average? Median? Most recent? The plan doesn't say.
- **Stamina pattern is confounded with adaptive drill.** Later segments are usually *harder* in a drill, not the same. "Accuracy degrades in later segments" might just mean "drill ramped tempo." Stamina detection needs to control for tempo / difficulty, which isn't mentioned.
- **Minimum 3 sessions (Open Question #12)** is reasonable but arbitrary. 3 sessions of 5 minutes vs 3 sessions of 30 minutes — vastly different signal. Probably also want a minimum total beats or minutes.

---

### C4 — Smart Coaching Timing

- **"Accuracy dropped significantly (>20% over 16 beats)"** — over which window? Comparing the last 16 beats to the prior 16? Rolling? Cumulative session? The threshold is meaningless without the window.
- **0.8s inference + adaptive drill = stale comments.** During a drill ramp, BPM can change every 4–8 bars. A 0.8s+heuristic-delay comment about "your timing improved at 130" can land when the player is already at 140. Latency-tolerance is genuine for most comments but not for "tempo X" callouts during ramps.
- **Heuristic queue under high event density.** If the heuristic fires faster than the model returns, the queue grows. No spec on whether subsequent fires drop, replace, or queue. For local models this is a real issue — first-token latency on consumer hardware can easily exceed the heuristic's 8-beat cadence at fast tempos. **Recommended policy: latest replaces queued; drop intermediate.**
- **Template fallback is described as "the same architecture"** but the LLM step ("decide what to say, or skip") can't be done by templates. When LLM is unavailable, the heuristic both decides when AND picks a template — that's not "the same architecture," that's a parallel path that needs its own design.

---

### C5 — Coach Personality

- **"Pool of 3-5 templates per scenario" with no specified N.** Open Question #11 mandates shuffle-bag without replacement, good. But scenarios like "first-ever session" only happen once per user — 5 templates is wasted authoring effort.
- **"Track last N comments in the session" — N is undefined.** Shuffle-bag handles same-scenario repetition; the "last N" is presumably for cross-scenario similarity. Spec is missing.
- **Tension between "knows when to shut up" (C5) and Open Question #10's 5-minute minimum — author's proposed synthesis is good.** Author's rule: "5-min check-in unless accuracy is above 85% for the whole window, then silence." Cleanly resolves it. **One refinement:** needs hysteresis so the trigger doesn't flap when accuracy oscillates around 85%. Suggested: trigger only after accuracy drops below 85% for ≥30 seconds *and* the cooldown has elapsed. Otherwise a player hovering at 82–88% will get repeated check-ins. **In the rev 4 two-tier design this rule applies per-channel:** the 85%-streak silence applies to TTS only; the written feed continues to annotate during streaks, and the end-of-segment boundary event (Signal B) always fires regardless of the streak rule.
- **"References specific metrics" requires a metric-to-language layer** that isn't specified. Which metrics map to "beat 3 timing"? Which to "stamina"? Without a mapping, templates either hard-code metric names (rigid) or omit them (vague). This deserves its own subsection.
- **Coach vocabulary must be instrument-aware.** "Lock in your kick on beat 1" is great feedback for a drummer and meaningless for a pianist. "Tighten your downstroke" is correct for guitar/bass and meaningless for drums. The template pool should be keyed by instrument: `templates[instrument][scenario][index]`. For the LLM, the instrument name and a short vocabulary hint ("the player is on electric guitar; use terms like downstroke, palm mute, picking hand") should be injected into the system prompt. This is one of the **highest-impact** uses of the D0 profile — generic coach phrasings feel impersonal regardless of model quality.

---

## Scoring Formula Evaluation (D3c specifically)

### Are the weights justified?

The plan's justification is narrative ("interval is the most robust"), not numerical. The 0.35/0.25/0.20/0.20 split doesn't fall out of any test scenario. Worse: as shown above, the targets in D3d don't match what these weights produce. The weights and the test matrix were written independently, and neither was verified against the other.

The "interval dominates" claim for scenario 11 only works if the weights are something like 0.55/0.15/0.15/0.15. With 0.35/0.25, interval merely *contributes more than any single other component* — it does not dominate when the others are all 100.

### Can the formula be gamed?

Yes — two high-severity vectors and one low:

1. **Under-play (high).** Hit perfectly evenly spaced subset of beats; let activity detection mask the rest as resting. → A grades for partial coverage.
2. **Cluster near beats (high).** Fast tremolo near each beat. All onsets are "near a beat," none penalize, efficiency stays at 1.0. → Looks technically dense, scores like clean playing.
3. **Quiet noise spam (low — largely mitigated).** Amplitude-weighted spurious penalty means quiet random onsets contribute little. D2's adaptive noise floor (ambient × 3) gates most of these before detection. A density-cap safety net is still nice-to-have, but the failure mode is much less likely in practice than I initially claimed.

### Counterintuitive results

- **Perfect playing at 200 BPM 16ths probably never gets "perfect" classification** because the perfect band (<6ms) is below detection resolution. Users will see "good" at best regardless of effort.
- **Constant latency offset that's within "good" range scores ~95**, not the 75–85 the test matrix claims. Users who expect calibration to forgive small offsets will be fine; users who expect their 30ms-late style to be penalized will be confused.
- **Swing/shuffle scores poorly** because interval_consistency uses a single expected interval. Open Question #5 says the architecture supports per-beat expected intervals, but the actual formula in D3c uses "(actual_interval - expected_interval)" as if singular. Spec needs to make the array form explicit.

---

## Sequencing — Hidden Dependencies & Rework Risk

The plan claims phases are independently shippable. They are not:

1. **D1's synthetic test helpers test post-match scoring, but D3a changes matching.** If D1's `score_feedbacks(&feedbacks)` ships before D3a, its tests don't validate the new matching windows. After D3a lands, the synthetic helpers either need to be rewritten to emit raw onsets, or D3a is silently untested.

2. **D3's hit_completeness depends on D4's activity detection.** D3 is Phase 3, D4 is Phase 6. So D3 ships with the *current* activity detection (which the plan also says is broken — D4 exists to "refine" it). When D4 lands, hit_completeness behavior changes, the test matrix needs re-running, and any user-facing score calibration shifts. Move D4 before D3, or move D3's activity-dependent components to Phase 6.

3. **D3's onset_efficiency depends on D2's confidence scoring** (the plan says low-confidence onsets contribute less). D2 is Phase 2, D3 is Phase 3 — that's fine, but D3 doesn't actually wire up confidence weighting (see vagueness above). Either D3 explicitly consumes confidence, or D2's confidence work is dead until later.

4. **C4 (smart timing) depends on C1's session narrative AND C3's preset awareness.** That's the sequence (4→5), good. But C4 also depends on D4's segment boundaries to detect "accuracy dropped over the last segment" — and D4 is Phase 6, *after* C4. The "accuracy dropped >20% over 16 beats" can be computed without segments, but the narrative entries like "Segment 2 complete: accuracy dropped to 68%" require segments. So C1's narrative is structurally incomplete until D4 lands.

5. **C2 is "Phase 1, parallel with D1"** but C2 references session history. Session history exists (it's shipped), so this is OK — but C2's "context-aware" content is much weaker without C3's preset awareness and C1's narrative. Shipping C2 in isolation gets you "Welcome back" with no teeth. Worth being honest about that.

**Recommended re-sequence:**
- Phase 1: D1 (logging only — synthetic helpers deferred until D2/D3 land)
- Phase 2: D2 (detection) + D4 (activity detection)
- Phase 3: D3 (scoring, with full synthetic test suite using raw onsets through matching)
- Phase 4: C1 + C3
- Phase 5: C4
- Phase 6: C2 + C5 (polish)

The current ordering ships flashy parallel work but makes scoring depend on subsystems that are scheduled later.

---

## Missing from "Assumptions, Edge Cases & Open Questions"

The existing section is good. Here's what's not in it:

- **Polyphonic / chord instruments — addressed by D0 profiles.** Strumming a guitar chord produces a smeared transient or several closely-spaced onsets depending on attack envelope. Piano chord voicings produce 3–6 onsets within ~25ms. The spurious-onset logic was designed for monophonic playing. With D0, the `cluster_window_ms` parameter collapses onsets within that window into a single "musical event" before matching: guitar ~20ms, piano ~25ms, bass ~5ms (mostly monophonic), drums ~0ms (each hit is a distinct event). This eliminates the false-spurious penalty for chord instruments without special-casing the matching algorithm.
- **Variable audio latency / driver jitter.** "Interval consistency is immune to latency" assumes *constant* latency. USB audio drivers (especially on Windows) can jitter by ±5ms, which directly degrades interval_consistency for a perfectly-timed player.
- **Clock source for `timestamp_ms`.** System monotonic clock? Audio sample clock? Mixing the two introduces drift over long sessions.
- **What happens when no preset is selected.** C3 assumes a preset. The chat/coach behavior in raw-metronome mode (no preset) isn't specified.
- **What happens when the TTS voice is mid-utterance and a new comment fires.** Already-shipped feature, but the heuristic gatekeeper might fire faster than TTS finishes. Queue? Drop? Interrupt?
- **Tempo changes that aren't drill-driven.** User manually changes BPM mid-session. Does this start a new segment? Update expected_intervals? The plan focuses on adaptive drill but ignores manual tempo edits.
- **The "first 8 calibration beats" exclusion** (mentioned in Open Question #4) is the right call but is never reflected in the test matrix. Add a scenario: "First 8 beats wrong, last 24 perfect — score should reflect only the last 24."
- **Score persistence across plan rollout.** Existing users have session history with current-formula scores. When the new formula ships, their old grades don't change but new sessions are scored differently. Their "trend" graph will jump. No migration story.

---

## Instrument Awareness — Proposed Phase D0

The plan currently treats all instruments identically. Onset detection,
spurious-onset logic, refractory periods, expected onset densities, and coach
vocabulary are all written as if there's one "player." This is wrong in the
same way that "one matching window for all tempos" was wrong — the constants
that work for guitar break for drums, and vice versa.

**Solution: an explicit `Instrument` enum + per-instrument profile, set via a
settings dropdown, consumed by every DSP and coach component that currently
hardcodes a constant.**

### Proposed profile structure

```rust
pub enum Instrument {
    Drums,
    ElectricGuitar,
    AcousticGuitar,
    Bass,
    Piano,
}

pub struct InstrumentProfile {
    /// Minimum time between distinct onsets (instrument physics floor)
    pub refractory_floor_ms: u32,

    /// Onsets within this window collapse into one "musical event"
    /// before matching (handles chord voicings, strums)
    pub cluster_window_ms: u32,

    /// Cap on onsets per beat that count as "near the beat";
    /// onsets beyond this become spurious
    pub max_onsets_per_beat: u8,

    /// Expected typical onset density for this instrument
    /// (used to scale onset_efficiency)
    pub expected_onsets_per_beat: RangeInclusive<f32>,

    /// 16-band spectrum weight emphasis for spectral flux
    /// (drums = broadband; bass = low; guitar = mid)
    pub spectral_weights: [f32; 16],

    /// Beats of silence before transitioning to Resting state
    pub activity_silence_beats: u8,

    /// Coach vocabulary hint for LLM system prompt
    /// + template pool selector key
    pub vocabulary: InstrumentVocabulary,
}
```

### Starting values (first pass — must be empirically tuned)

| Param                       | Drums | E-Guitar | A-Guitar | Bass | Piano |
|-----------------------------|-------|----------|----------|------|-------|
| `refractory_floor_ms`       | 15    | 40       | 50       | 35   | 20    |
| `cluster_window_ms`         | 0     | 20       | 25       | 5    | 25    |
| `max_onsets_per_beat`       | 6     | 3        | 4        | 2    | 8     |
| `expected_onsets_per_beat`  | 1.0–3.0 | 0.5–2.0 | 0.5–2.0 | 0.5–1.5 | 1.0–4.0 |
| `activity_silence_beats`    | 8     | 4        | 4        | 4    | 8     |
| `spectral_weights` emphasis | broadband, low+high | mid (200Hz–4kHz) | mid+high (200Hz–8kHz) | low (40Hz–1kHz) | broadband (80Hz–4kHz) |

### Findings this resolves (or substantially mitigates)

- **Headline #3 (tremolo/rolls)** — `max_onsets_per_beat` is now per-instrument.
- **D2 refractory floor** — `refractory_floor_ms` replaces the global 20ms.
- **D3 onset_efficiency over/under-penalty** — `expected_onsets_per_beat` scales
  the metric.
- **Polyphonic / chord instruments** (Open Questions section) — `cluster_window_ms`
  collapses chord onsets cleanly.
- **C5 coach phrasing** — `vocabulary` keys templates and primes the LLM.

### Findings this does NOT resolve

The headline correctness bugs are instrument-agnostic and remain:

- Formula vs test matrix mismatch (Headline #1) — math is wrong regardless.
- Under-play loophole (Headline #2) — structural.
- Missing `interval_consistency` transfer function (Headline #4) — independent.
- D4-before-D3 sequencing — independent.
- Most local-model coach concerns — independent.

D0 is high-leverage, but it's complementary to the critical formula work, not
a substitute.

### New design questions D0 creates

1. **Default value at first launch.** "Generic" is the worst option — every
   constant becomes a compromise that fits no one. Better: surface an
   instrument-picker on first run; default to electric guitar (likely the
   plurality) only if the user skips it.
2. **Auto-detection as a backup.** Onset density patterns over the first 16
   beats can probabilistically suggest the instrument (3+ onsets/beat → drums
   or piano; low spectral centroid → bass; etc.). Useful as a "looks like
   you might be playing drums — switch?" prompt, not as a silent override.
3. **Multi-instrument users.** A drummer who occasionally sings, a guitarist
   who plays piano. Switching mid-session is fine; the DSP profile swap is
   immediate, the coach should briefly acknowledge ("Switched to piano —
   different vocabulary now"). Don't persist the same calibration across
   instruments (mic placement, attack envelope, room differ).
4. **Per-instrument latency calibration.** Auto-calibration converges in ~8
   beats but the offset is partly instrument-dependent (attack envelope).
   Cache calibration offset per `(instrument, audio_device)` pair, not per
   session.
5. **Profile storage and override.** Ship sensible defaults; let advanced
   users override individual parameters via a "Custom" profile that copies
   the closest preset and exposes the fields. Not a Phase 1 feature — but
   the architecture should accommodate it without a rewrite.

### Sequencing impact

**D0 should ship before D2 (Onset Detection Hardening)** because D2's
refractory period and confidence scoring should both consume the profile.
Otherwise D2 lands with hardcoded constants that need re-derivation when D0
arrives.

Revised sequencing:
- **Phase 0: D0 (Instrument Profiles)** — dropdown + struct + default values + wiring
- **Phase 1: D1 (Diagnostic Logging)** — logging includes `instrument` in session log
- **Phase 2: D2 + D4** — both consume the profile
- **Phase 3: D3** — onset_efficiency consumes profile; per-beat cap consumes profile
- **Phase 4: C1 + C3** — narrative includes instrument context
- **Phase 5: C4** — heuristic uses instrument-aware expected densities
- **Phase 6: C2 + C5** — coach vocabulary keyed by instrument

D0 is small (a struct, a dropdown, a default value, and wiring), so adding it
as Phase 0 doesn't push the rest of the schedule meaningfully.

---

## Local Model Considerations

The plan's coach architecture is written as if the LLM is a capable
collaborator. That framing holds for Sonnet/GPT-4-class. For a local model
(Phi-3, Gemma-2B, Llama-3.2-3B, Mistral-7B-class) on consumer hardware, the
assumptions shift in ways the plan should make explicit:

1. **Context is scarce.** Effective context for many small local models is
   4–8K tokens, of which the system prompt + recent chat already consume a
   meaningful share. The session narrative (C1) competes for this budget.
   The 2KB cap from Open Question #8 is the right ceiling, not the "few
   hundred bytes" the C1 body suggests.

2. **Inference quality is lower.** Phrasings repeat. Subtle context cues
   (preset name semantics, sentiment in chat) are missed. "The model
   naturally infers" is not a safe load-bearing assumption — it's a coin
   flip. Anywhere the plan relies on inference quality (preset semantics
   in C2, "decide what to say or skip" in C4, varying phrasing in C5),
   build a deterministic fallback in parallel.

3. **First-token latency varies wildly.** The plan's "0.8s inference latency"
   is optimistic for a cold model on a mid-range laptop CPU. Worst case is
   2–4s. The heuristic-gatekeeper architecture is therefore *more* important
   for local mode, not less — it minimizes inference calls. Define a hard
   timeout (e.g., 3s) after which the heuristic falls back to template
   generation without waiting.

4. **Templates aren't a fallback — they're a co-equal path.** The plan frames
   templates as "what happens when the LLM isn't available." Reality: many
   users will run with no LLM (no compatible hardware, conscious choice to
   skip model download). For those users, templates *are* the coach. Author
   the template pool to that quality standard — not as a graceful
   degradation.

5. **Repetition mitigation matters more.** Local models tend to lock onto
   phrasings and repeat them across calls. Beyond the shuffle-bag for
   templates (Open Question #11), add a post-processing step on LLM output
   that detects repetition against the last N coach utterances and either
   re-rolls or substitutes a template.

6. **Streaming vs blocking.** Local-model streaming output looks worse than
   batched (token-by-token reveal, then "thinking" while sentence completes).
   For coach comments — which are short — generate the whole comment
   server-side, then deliver to the UI as one chunk. The plan doesn't say
   either way; make it explicit.

## Maximizing WOW on a Local Model

The plan implicitly treats the LLM as the source of intelligence. On a local
model (Phi-3, Gemma-2B, Llama-3.2-3B-class) that's the wrong bet — these
models can't analyze, they can only rephrase. The wow has to come from
somewhere else, and the architecture should optimize for that.

### Where the wow actually comes from

In rough order of impact, the moments that make users say "this thing is
amazing" are:

1. **Diagnostic precision that surprises them.**
   "Your beat 3 is consistently 18ms late." Wow because it's *measurably true*
   and the player didn't know. The sentence is dull; the data is magic. Pure
   DSP, zero LLM contribution.

2. **Diagnoses that separate the player from their setup.**
   "Your interval consistency is rock solid (σ=8ms) but you're 25ms behind
   the grid — this looks like input latency, not your playing." Wow because
   it gives the player permission. Pure DSP + a template.

3. **Longitudinal awareness.**
   "Your beat-3 timing has improved 12ms over the last 5 sessions." Wow
   because no other tool tracks this and it's specific. DSP + session history
   + a template.

4. **Instrument-specific framing.**
   "Lock the kick first; the snare follows." vs. "Lock in beat 1." The
   difference is credibility. D0 instrument profiles + instrument-keyed
   templates.

5. **Visual diagnostics.**
   A waveform with grid lines, onset markers colored by classification, and
   a scrubber. More wow per second than any text the LLM produces. Pure UI.

6. **Variety in the LLM's phrasing of the above.**
   The least important of the six. Necessary but not sufficient — and the
   thing the local model is *actually* good at.

The strategic implication: **invest in the first five, use the LLM only for
the sixth.** Do not bet wow on model quality. Bet it on DSP correctness,
instrument awareness, longitudinal data, and visual design.

### Architecture: Template Substance + LLM Style

This is the pattern that gets the most juice out of a local model:

**Two layers, strict separation of concerns:**

```
┌─────────────────────────────────────────────────────────────┐
│  Heuristic Gatekeeper  ─────►  Picks a template + fills it  │
│  (decides WHEN to speak)        (decides WHAT to say)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼  (filled template, plain text)
┌─────────────────────────────────────────────────────────────┐
│  Local LLM                                                  │
│  (rephrases for variety + tone — decides HOW to say it)     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼  (final coach utterance)
                          UI / TTS
```

**Example:**

```
Template:    "Your beat {n} on {drum} tightened up by {delta}ms this session."
Filled:      "Your beat 3 on snare tightened up by 12ms this session."

LLM rephrasings of the same input:
  • "Hey, your snare's locking in on beat 3 — that's 12ms better than
     where you started today."
  • "Beat 3 on snare is tightening up. 12 milliseconds tighter than this
     morning. Nice."
  • "Your snare beat 3 timing improved 12ms today — keep that going."

Worst case (LLM times out or unavailable):
  • The filled template ships as-is. Still a coherent, accurate, specific
    message. Still wow.
```

**Why this works for small local models:**

- The LLM never has to **decide what to say** — the gatekeeper + template
  catalog handle that.
- The LLM never has to **compute metrics** — values are pre-substituted.
- The LLM never has to **be smart** — its only job is paraphrasing, which
  is the one thing small models do reliably well.
- Failure modes are **graceful** — every template is a complete message on
  its own. The LLM is enrichment, not foundation.
- Template authoring is **a one-time cost** — write it once, ship forever.
  Hours of writing, not weeks of prompt engineering.

### Template authoring as a first-class deliverable

The template pool should be treated as a real artifact, not a stub set:

- **Keyed by `(instrument, scenario, severity)`** — five instruments × ~30
  scenarios × ~3 severities = ~450 template slots. Each slot needs 3-5
  variants for the shuffle-bag.
- **Reference real metrics** with named placeholders: `{beat_n}`,
  `{delta_ms}`, `{drum}`, `{tempo_band}`, `{streak_length}`,
  `{personal_best_delta}`, etc.
- **Written in coach voice, not chatbot voice.** "Tighten your downstroke
  on beat 3" — not "I noticed that your timing on beat 3 could be improved."
- **Instrument-specific vocabulary baked in.** Each instrument has a
  curated word list — drums never says "downstroke"; guitar never says
  "ghost note on snare."
- **Severity-graded.** Encouragement, neutral observation, technical
  correction, warning — same observation, different tone.

This is hours-to-days of writing work, not engineering. It's also the
single highest-leverage investment in user-perceived intelligence.

---

## The Variety Budget Problem

The hardest engagement risk isn't "the model will be wrong" — it's "the
coach will feel repetitive by month 2 and users will drift away." This is a
real risk and it deserves a real plan.

### Diagnosis: two budgets, not one

Repetition lives in two separable budgets:

**Phrasing budget (small, exhausts fast):**
How many ways to say *"your beat 3 improved."* Local models exhaust this
in weeks. Templates with 3-5 variants exhaust it in days.

**Substance budget (large, grows with data):**
How many *different things* to talk about. This grows with the user's
data — every session adds metrics, comparisons, milestones, trends. After
30 sessions, the substance space includes "tightest BPM zone," "stamina
pattern," "30-day improvement curve," "fastest recovery after a slip" —
none of which existed in session 1.

**The strategic insight:** users don't notice phrasing repetition if the
*substance* is different. "Your beat 3 improved 8ms" and "your beat 3
improved 12ms" feel different even if the sentence template is identical.
Conversely, the most varied phrasing in the world feels canned if every
comment is about the same thing.

### Mitigations — in priority order

The earlier framing was "speak less." That's wrong for a metronome app
where the user's eyes are on the instrument and the screen is peripheral —
silence makes a paid AI feature feel dead, and the user has every right to
expect the coach to *show up.* The correct lever is **event-driven gating,
not time-throttled silence.** Real coaches in real practice rooms talk
frequently; they just talk at the natural punctuation points of a session
(exercise boundaries, tempo changes, milestones, rests, struggle stretches)
and they vary the *substance* of what they say, not just the words. The
mitigations below operationalize that.

1. **Two-tier channel split — TTS during play, written feed as notebook.**
   The single biggest anti-fatigue lever. The TTS channel runs scarce and
   intervention-grade — only fires when something is worth interrupting
   the user's playing for. The written feed runs generous and granular —
   continuous micro-observations the user scans during pause/end. Two
   budgets, two rates, two purposes. See the *Two-Tier Notification
   System* section for the full design. This pattern alone solves most
   of the variety problem: granular substance lives in the written feed
   where repetition is tolerated; scarce phrasing lives in TTS where
   variety is required but the budget is small enough to author by hand.

2. **Event-driven coach moments (not time-driven).**
   Practice sessions have natural punctuation: exercise-end events, BPM
   changes, preset switches, rest-after-good-run events, struggle
   stretches, milestones. Each event is *intrinsically different
   content* — the substance is the event itself. The phrasing budget
   barely has to work because the substance is doing the heavy lifting.
   See *Exercise-Boundary Detection & Coach Timing* for the signals.

3. **Substance growth via progressive disclosure.**
   Don't ship all metrics on day 1. Week 1: basic timing observations
   only. Week 2: introduce consistency analysis. Week 3: tempo-band
   analysis. Each new metric unlocks a fresh content category. Users get
   a steady drip of "wait, it's tracking *that* now too?" moments instead
   of plateauing.

4. **Milestone & achievement events.**
   Sessions are inherently repetitive (same exercises, same presets), but
   milestones create natural fresh-content moments: first A grade, first
   session above 90%, longest streak, new personal best at a BPM, first
   week with 5 sessions. These are scarce — they only happen on real
   achievement — so they always feel earned. Always cross the TTS
   threshold.

5. **Comparative time-window framing.**
   Same observation, different reference frame:
   - "First time this week at 130 BPM."
   - "Your cleanest run today."
   - "Tightest beat-3 since last Tuesday."
   - "Best 30-second stretch of the session."
   The metric is the same; the comparison varies. This expands substance
   variety with no new metrics needed.

6. **Suggestion chips as a substance multiplier.**
   Context-aware chips after a mini-report (~40-60 chip catalog,
   selection scored by performance band, instrument, BPM, history
   availability) mean every session shows a *different set of questions*
   the coach is ready to answer. The user discovers fresh surface area
   each session without the coach ever having to phrase a new statement.
   Phrasing repetition is irrelevant if the *menu itself* is varying.
   See *User-Initiated Q&A via Suggestion Chips*.

7. **Streak hysteresis on TTS only, not the written feed.**
   The earlier "shut up during long streaks" rule still applies — but it
   applies only to the TTS tier, and only mid-segment. The written feed
   keeps annotating during streaks (those notes are valuable later). And
   the end-of-segment "you just killed that" moment is sacred — even
   after a 5-minute streak, the boundary event always speaks. Streaks
   make the boundary celebration more earned, not less.

8. **Question prompts instead of statements.**
   "Noticed your timing dipped at minute 4 — were you trying something
   new?" Questions invite engagement; statements wash over. Use sparingly
   to avoid feeling probing.

9. **Periodic summaries that aggregate data the user hasn't seen.**
   Sunday weekly digest. End-of-month report. These pull longitudinal
   data into a new format. The substance is data the user already
   generated, but the framing is novel.

10. **User-tunable verbosity.**
    Settings option: "Less talk / Default / More talk / Silent."
    Self-tune protects against fatigue without requiring the coach to
    read the user's mood. Should affect the TTS budget primarily; the
    written feed should remain available regardless.

11. **Don't fake substance variety with phrasing variety.**
    Anti-pattern: "Nice job!" → "Great work!" → "Way to go!" → "Killing
    it!" Same content, different words. Users see through this
    immediately. Better: scarce, specific praise grounded in data
    ("you just hit 92% at 150 — your best at this BPM").

### Honest acknowledgment

Even with all of the above, a yames user who practices daily for a year
*will* feel some repetition. That's unavoidable — this is a metronome
coach, not a music coach. The goal isn't infinite novelty; it's:

- Enough variety to feel fresh through month 3.
- Enough substance growth to keep new things appearing through month 6.
- A graceful "background companion" mode by month 12 where the coach is
  reliable, helpful, and quiet — not constantly trying to impress.

The win condition isn't "users find the coach surprising forever." It's
"users keep the app open during practice because it's quietly useful, and
occasionally says something specific that reminds them why it's there."

---

## Two-Tier Notification System

The single most important UX correction in this revision: **this is a
background app while the user's eyes are on their instrument.** Written
notifications during active play are effectively invisible — the screen is
peripheral. The right mental model is:

- **TTS is the coach's voice.** Audible. Scarce. Intervention-grade. Fires
  during active play when something is worth interrupting the user for.
  This is the primary feedback channel during the session.
- **Written feed is the coach's notebook.** Silent. Generous. Granular.
  Accumulates continuously during the session and is read during pauses,
  exercise transitions, and the post-session report.

Two budgets, two rates, two purposes. The variety budget problem largely
dissolves under this split: the *phrasing* budget stays small because TTS
events are scarce; the *substance* budget runs hot because the written
feed tolerates granularity and the user scans rather than listens.

### What crosses the TTS threshold

The gatekeeper for spoken output should be strict. A spoken event is
warranted when one of these is true:

- **Sustained struggle.** Score < 70% sustained over ≥ N beats (tunable
  per instrument). Trigger an actionable suggestion (see *Actionable
  Interventions*).
- **Notable in-the-moment achievement.** First clean run at a new BPM,
  sudden quality jump, recovery after a struggle stretch, new personal
  best mid-session.
- **Boundary event.** Exercise end with score ≥ 85% ("nice, 92% on that
  one"), BPM/preset change ("switching to 140, here we go"), return from
  rest ("welcome back").
- **Sustained pattern correction.** A specific timing pattern that's
  worth the user knowing about *while they can still fix it* ("you're
  consistently rushing beat 3 — let it breathe").
- **Milestone.** First A grade, longest streak, week goal hit. Always
  speaks regardless of cooldown.
- **User-initiated question.** Always speaks the answer (or chip-driven
  response, see Q&A section).

Everything else routes to the written feed.

### Gatekeeper rules for TTS

- **Hard cooldown after a TTS event:** minimum 20 seconds between any two
  spoken events unless a milestone fires. Prevents stacking.
- **No TTS during the first 4 beats of any segment.** Lets the player
  settle in before the coach starts narrating.
- **No TTS in the last 4 beats of a known segment.** Prevents the coach
  from talking over the user's natural cadence ending.
- **Streak suppression mid-segment only.** During sustained ≥ 85%
  accuracy stretches, the *mid-segment* gatekeeper goes silent. The
  *boundary* event at the end of the segment still fires. The contrast
  makes the boundary celebration feel earned.
- **User verbosity setting** scales TTS frequency: "Less / Default /
  More / Silent." The "Silent" mode keeps the written feed running.

### What the written feed catches

The written feed runs continuously during play and is the substrate the
user scans during any pause. It absorbs everything that doesn't clear the
TTS bar, plus a lot of content that wouldn't survive being spoken at all:

- Per-beat or per-bar micro-stats ("snare hits running 6ms behind for the
  last 8 bars").
- Trend notes that fire too often to speak ("tightest beat 2 in the last
  30 seconds").
- "Almost spoken" events that didn't meet the gatekeeper threshold but
  are still worth logging.
- Mini-report summaries at exercise boundaries (the bulk of the user's
  reading material).
- Suggestion-chip Q&A answers (when the user taps a chip, the answer
  lands in the written feed).

The written feed is also the persistent record the user reviews when they
pause and look up — which is when the suggestion chips appear (see
*User-Initiated Q&A via Suggestion Chips*).

---

## Exercise-Boundary Detection & Coach Timing

The two-tier system depends on detecting *practice punctuation events*
accurately. D4 (activity detection) already needs to know "is the player
playing right now"; extending it to emit boundary events is mostly free.

### Three boundary signals, in order of confidence

**Signal A — Explicit metronome change (highest confidence).**
The user changes BPM, time signature, instrument preset, sound, or
metronome pattern via the UI. This is a deterministic boundary event —
the UI emits it directly. Coach should always have something to say here:

- BPM increase: "let's see how 140 goes."
- BPM decrease: "smart — let's lock 130 in first."
- Preset/sound change: "switching to a tighter click — your hits look
  cleaner already."
- Time signature change: acknowledgment + setup framing.

Implementation: subscribe to settings-change events. Zero ambiguity.

**Signal B — Activity gap after sustained playing (high confidence).**
Player was playing continuously for ≥ 30 seconds, then no onsets for
≥ 4 seconds. This is the "they finished and either rested or are
switching." Most engagement-critical boundary because it includes the
**"did great then stopped"** moment.

Heuristic:

```
if (sustained_play_seconds >= 30 and silence_since_last_onset_ms >= 4000):
    emit PracticeSegmentEnded {
        score: rolling_score_for_segment,
        bpm: current_bpm,
        instrument: current_instrument,
        duration_seconds: sustained_play_seconds,
        ...
    }
```

The 4-second threshold filters out micro-pauses (breath, repositioning,
sip of coffee). The 30-second minimum prevents firing on quick warmup
attempts.

**The "did great then stopped" event specifically:** when Signal B fires
*and* the just-ended segment scored ≥ 85%, that's an unambiguous "say
something positive" moment. This is one of the highest-leverage coach
events in the whole product — the moment the user is most likely to feel
seen. It should *always* speak via TTS, regardless of cooldown timing
within reason, because the alternative is the user putting the
instrument down and the coach having missed the moment.

**Signal C — Rolling-window score discontinuity (medium confidence, v2).**
The last 16 beats scored 92%; the next 16 beats score 45% on a totally
different rhythmic pattern. *Probably* a mid-exercise switch with no
rest. Could also just be the player attempting a harder section or
fumbling. False-positive cost is high (coach saying "nice switch!" when
the user was struggling). **Defer to v2.** Signals A and B catch the
majority of real boundaries.

### Mini-report rendering on Signal B

When Signal B fires, the screen renders a mini-report for the segment
that just ended:

- Segment score (with grade band).
- Per-component breakdown (interval, grid, completeness, efficiency).
- Headline observation (the most-actionable single insight, sourced
  from the template catalog).
- 1-3 micro-stats from the written feed selected for that segment.
- Suggestion chips (see Q&A section) — 3-4 context-aware chips +
  "Ask something else…" escape hatch.
- BPM/preset display so the user can see what they just played.

If TTS is enabled, an audible summary fires concurrently — short, ~5-10
words, e.g., "nice, 92% on that one." The full mini-report is on screen
for whenever the user looks down.

### Why this matters for variety

Every Signal B event is *intrinsically different content* — different
segment, different score, different metrics, different chip set. The
substance variety is "free" from the user's perspective: they aren't
hearing variations on the same sentence; they're getting a fresh
mini-report shaped by what just happened. This is the main reason the
event-driven gating dissolves the variety budget problem.

---

## Actionable Interventions

A category of coach event distinct from observation: an **intervention**
is the coach not just *commenting* but *suggesting a specific change*
and offering an affordance to act on it.

### The canonical pattern: BPM drop

```
Trigger:       score sustained < 70% for ≥ 16 beats AND bpm >= 100
Spoken:        "You're at 150 and struggling a bit — want to drop to 140?"
Written:       same text + structured affordance
Affordance:    [Drop to 140 BPM]  [Stay at 150]
```

The user can accept without picking up the mouse — affordance is
accessible via a keyboard shortcut clearly displayed, or a large click
target that doesn't require precision. The instrument doesn't have to
leave their hands.

### Other intervention types worth authoring

- **Subdivision simplification.** "You're catching the click but missing
  the off-beats. Want to halve the subdivision?" → button to switch
  pattern.
- **Click placement.** "Try the click on 2 and 4 only — see how that
  feels." → toggle.
- **Rest suggestion.** "You've been at this for 12 minutes — want to
  pause for 30 seconds?" → start a rest timer.
- **Calibration retry.** "Latency feels off this session — want to
  recalibrate?" → triggers D2 calibration flow.

### Intervention design rules

- **Grounded in metric, never generic.** "You're struggling" alone is
  not an intervention — "your hit rate dropped 25% in the last 8 bars"
  is. The trigger condition must reference a specific measurable.
- **Reversible.** Every intervention has a one-tap undo. If the user
  drops to 140 and dislikes it, they can return to 150 without leaving
  the instrument.
- **Cooldown after a declined intervention.** If the user declines a
  BPM-drop suggestion, don't suggest it again for ≥ 90 seconds. Avoids
  nag dynamics.
- **No more than 2 interventions per 5-minute window.** Hard cap.
  Interventions are powerful precisely because they're rare.
- **Always crosses the TTS threshold.** An intervention that only
  appears in the written feed is invisible during active play and
  defeats the purpose.

Interventions are probably the single highest-impact "wow" pattern in
the entire coach design. They turn the coach from a narrator into a
participant. Worth treating as a P0 design element alongside the
template catalog and the chip catalog.

---

## User-Initiated Q&A via Suggestion Chips

The earlier voice + text Q&A design is replaced with a tap-driven chip
architecture. No voice input on MVP — the audio environment (click + own
playing + room reverb) is too hostile for reliable on-device transcription,
and voice activation false-positives in a music app would be catastrophic.

### The chip pattern

After the mini-report renders at a Signal B boundary, the screen displays
3-4 **suggestion chips** plus a free-text escape hatch. Each chip is a
pre-curated question the coach is ready to answer. The user taps a chip
→ the answer renders in the written feed (and optionally fires a short
TTS clip if the answer is brief and the user benefits from hearing it).

### Why this works better than free-text Q&A

- **Discovery dissolved.** Users don't have to learn what the coach can
  answer — the questions are sitting on screen.
- **Latency dissolved.** Chip questions have predefined answer pathways;
  ~80% are deterministic template fills (sub-100ms response). No LLM
  call needed for the common case.
- **Hallucination dissolved.** Curated question space → deterministic
  answer space → near-zero hallucination risk for the 80% case.
- **Onboarding implicit.** Users learn the coach's surface area by
  seeing the chips. No documentation needed.
- **Variety solved at near-zero engineering cost.** Different chip sets
  appear based on performance band, instrument, BPM, history
  availability. The user sees a *different menu of questions* after a
  92% run than after a 64% run. This is substance variety that requires
  no LLM cleverness.

### Chip catalog architecture

Author ~40-60 chips total. Each chip is a structured record:

```rust
struct Chip {
    id: ChipId,
    label: &'static str,             // user-facing question
    trigger_predicates: Vec<Predicate>, // when this chip qualifies
    answer_pathway: AnswerPathway,   // Canned | TemplateFill | LLM
    answer_template: &'static str,   // for Canned/TemplateFill
    follow_up_affordances: Vec<Affordance>, // optional action buttons
    category: ChipCategory,          // for diversity constraint
    recency_weight: f32,             // for recency penalty
}

enum AnswerPathway {
    Canned,         // pure string lookup, no data
    TemplateFill,   // template + session-data substitution
    LLM,            // tight system prompt + context
}
```

### Example chips

```
chip: "Should I drop the BPM?"
  triggers when: last_segment_score < 70 AND bpm > 100
  pathway: TemplateFill
  template: "You scored {score}% at {bpm} BPM — your best at this BPM
             is {personal_best}%. Try {bpm-10}?"
  affordance: [Drop to {bpm-10} BPM]

chip: "Ready for faster?"
  triggers when: last_segment_score > 90 AND bpm < 180
  pathway: TemplateFill
  template: "You're locked in at {bpm}. Bump to {bpm+10}?"
  affordance: [Bump to {bpm+10} BPM]

chip: "How does this compare to last session?"
  triggers when: previous_session_exists
  pathway: TemplateFill
  template: "Last session at {bpm} BPM you averaged {prev_score}%. Today
             you're at {today_score}%. {delta_direction} by {delta}%."

chip: "What was my best run today?"
  triggers when: segments_completed >= 3
  pathway: TemplateFill
  template: "Your tightest run was segment {n} at {bpm} BPM — {score}%
             with σ={sigma}ms."

chip: "Why do I keep rushing?"
  triggers when: mean_offset_ms < -5 sustained over last 3 segments
  pathway: TemplateFill
  template: "You're averaging {abs_offset}ms ahead of the click — most
             noticeable on beat {worst_beat}. Try emphasizing the *back*
             of the beat for a minute."

chip: "What should I work on?"
  triggers when: always (lowest priority, fallback)
  pathway: TemplateFill
  template: "{worst_component} is your weakest component this session
             ({score}). Most likely fix: {remediation}."

chip: "Ask something else…"
  triggers when: always (last position)
  pathway: LLM (opens free-text input)
  affordance: text input field
```

### Chip selection algorithm

When a mini-report renders:

1. **Hard filter.** Drop chips whose trigger predicates don't qualify
   against current state.
2. **Relevance score.** Rank qualifying chips by relevance to the
   most-recent segment (e.g., BPM-related chips score higher right after
   a tempo-related struggle).
3. **Recency penalty.** If a chip was shown in the previous session,
   reduce its priority by ~30%. Prevents the same three chips appearing
   every time.
4. **Diversity constraint.** Don't show two chips from the same
   category (no two BPM chips, no two timing-pattern chips).
5. **Final selection.** Take the top 3 scoring chips after diversity
   filtering, plus the "Ask something else…" chip as the always-last
   slot.

### The LLM escape hatch

The "Ask something else…" chip opens a text input. The user types a
question, and the LLM runs with:

- A **tight system prompt:** "You are a metronome coach for the session
  that just ended. Answer only based on the session data provided. If
  asked about anything outside this scope, say you can only help with
  the current practice session."
- **Session context:** the just-finished segment + last 60 seconds of
  bar-level data + current settings. ~1-2KB total, fits any local model.
- **Latency UX:** "Thinking…" indicator. 3-6s response on a 3B-class
  model is acceptable because the user is actively waiting.
- **Hallucination guard:** if the model attempts to answer about
  unsupported topics (music theory, last week, other songs), the
  template catalog has a fallback: "I can only help with the current
  practice session — try asking about your last exercise or your tempo
  consistency."

The LLM is now genuinely a long-tail escape hatch, not the primary path.
It fires maybe 1 in 10 questions. The model can be slower, smaller, or
even occasionally fail without breaking the Q&A experience.

### Why the chip catalog is the most important authoring artifact

The chip catalog is the literal surface area of "what the coach knows
how to talk about." ~50 chips × answer templates × affordances is maybe
a day of writing work, but it's the highest-leverage day on the entire
project. Better chips beat better LLM prompts every time, because the
user *sees* the chips and the chips define what the coach can do.

Treat the chip catalog as a first-class deliverable on the same priority
as the instrument profiles and the template catalog.

### Mid-session Q&A (without a Signal B boundary)

Question: what if the user wants to ask something *during* an exercise,
not at the boundary? V1 answer: there's a dedicated UI affordance (a
small "ask coach" button or hotkey) that pauses the metronome, opens the
chip menu against current state, and resumes when the user dismisses
it. Same chip catalog, same selection algorithm, just triggered by user
action instead of by Signal B.

Multi-session Q&A ("how am I doing this week?") crosses out of the
current session context and is harder. **Defer to v2.** When asked,
return a graceful "I can only see today's session right now."

---

## Concrete Recommendations

**Must-fix before code is written (block correctness):**

1. **Spreadsheet the test matrix against the formula.** Plug each of the 12 scenarios into the proposed weights and component definitions. Confirm totals land in target bands. They currently don't. Adjust weights or targets *now*.
2. **Define `interval_consistency` as a precise function** — Gaussian decay `100 × exp(-σ²/(2k²))` with **tempo-aware** `k` (e.g., `k = window_ms × 0.4`).
3. **Fix the under-play loophole.** Either `hit_completeness` uses total expected beats regardless of activity, or there's a separate "coverage" metric. Author agreed.
4. **Ship D0 (Instrument Profiles) first.** Dropdown + `InstrumentProfile` struct + the five-instrument starting table + wiring through to D2, D3, C5. Cheap to add (a struct, a dropdown, default values), and every downstream phase consumes it. Doing D2/D3 without it means re-deriving constants twice.

**Should-fix before merge:**

5. **Make the per-beat onset cap instrument-aware** — `instrument.max_onsets_per_beat`, not a magic number.
6. **Make the refractory floor instrument-aware** — `instrument.refractory_floor_ms`, replacing the global 20ms.
7. **Collapse chord onsets via `cluster_window_ms`** before matching, instead of special-casing the matching algorithm.
8. **Specify how confidence (D2) flows into scoring (D3)** or remove confidence from D2 until you know.
9. **Move D4 before D3.** Author agreed: activity detection is a scoring dependency.
10. **Anchor the floor on "perfect" classification** at ~8ms regardless of tempo, since onset detection jitter prevents tighter resolution.
11. **Author the template pool keyed by instrument** — `templates[instrument][scenario][index]`. Generic phrasings hurt coach credibility regardless of model quality.
12. **Cap session narrative size at 2KB** with a documented truncation strategy. Resolve the contradiction with the "few hundred bytes" claim in C1.

**Should-fix for the WOW factor (addresses feasibility + engagement):**

13. **Adopt Template Substance + LLM Style as the explicit architecture.**
    Templates carry the metric-grounded observation; LLM rephrases for variety
    only. Don't ask the local model to analyze, decide, or be smart — it
    can't. Use it only for phrasing variation.
14. **Author a real template catalog** — ~450 slots (5 instruments × ~30
    scenarios × ~3 severities), 3-5 phrasings per slot, instrument-specific
    vocabulary, severity-graded tone. This is the single highest-leverage
    investment in user-perceived intelligence. Treat it as a Phase 0
    deliverable alongside D0.
15. **Adopt the two-tier notification architecture as a core design
    primitive.** TTS is the primary channel during active play (scarce,
    intervention-grade, gated on event significance). Written feed is
    the coach's notebook (generous, granular, consumed at pause/end).
    Two budgets, two rates. This replaces the earlier "default to
    silence" recommendation, which conflated frequency with fatigue and
    misread the metronome-app attention model.
16. **Implement exercise-boundary detection (Signals A + B) as a
    first-class event source.** Signal A (UI-driven settings changes) is
    free. Signal B (sustained-play-then-gap) is a small extension of D4.
    Together they cover the majority of natural coach moments. The
    "did great then stopped" sub-event (Signal B with segment score ≥
    85%) is the single highest-leverage moment in the entire UX.
17. **Author the suggestion chip catalog (~40-60 chips).** Each chip
    needs trigger predicates, an answer pathway (canned / template /
    LLM), an answer template, and optional follow-up affordances.
    Selection algorithm: hard filter → relevance score → recency penalty
    → diversity constraint → top 3 + escape hatch. The chip catalog is
    the literal surface area of the coach's intelligence — treat it as
    P0 alongside instrument profiles and the template catalog.
18. **Design actionable interventions as a distinct event class.** The
    BPM-drop pattern is the canonical example: trigger condition
    grounded in metric, spoken suggestion via TTS, on-screen affordance
    that doesn't require leaving the instrument, hard cooldown on
    declined interventions, max 2 per 5-minute window. Highest-impact
    "wow" pattern in the coach design.
19. **Build visual diagnostics.** Waveform with grid lines, onset markers
    colored by classification, scrubber. More wow per second than any LLM
    output, one-time UI build.
20. **Stage substance unlock by week of usage** ("progressive disclosure").
    Week 1: basic timing only. Week 2: consistency analysis. Week 3:
    tempo-band analysis. Stretches the substance budget across the months
    where fatigue would otherwise set in.
21. **Implement milestone events as a first-class system.** First A grade,
    longest streak, new personal best at a BPM, first session above 90%.
    These are inherently scarce, so they always feel earned, and they
    always cross the TTS threshold regardless of cooldown.
22. **Ship a user-tunable verbosity setting** ("Less / Default / More /
    Silent"). Scales the TTS budget only — the written feed remains
    available regardless.
23. **Add weekly/monthly summary digests.** Pulls longitudinal data into
    novel framings; refreshes the conversation cadence on a slower beat.

**Worth documenting:**

24. **Pick a side on swing/over-subdivision.** Test matrix should include at least one scenario that proves the architecture survives a future swing extension.
25. **Add migration spec.** Existing session scores will shift; the user-facing trend graph needs an explanation or a recompute pass. Also: existing sessions have no `instrument` — define the backfill (default to the new selection, or mark as "unknown" and exclude from per-instrument analytics).
26. **Resolve "minimum comment frequency" vs "knows when to shut up"** using the author's 85% rule + hysteresis applied per-channel (TTS strict; written feed generous).
27. **Define a hard inference timeout** (e.g., 3s) after which the heuristic falls back to template generation. Latency on consumer hardware is unpredictable.
28. **Per-instrument calibration cache** — store latency offset per `(instrument, audio_device)` pair so the convergence period isn't repeated on every session.
29. **Pre-warm the local model during splash screen** — first inference call after app launch is genuinely slow (model load). Don't make the user pay that cost mid-session.
30. **Defer voice input to v2.** On-device transcription in a metronome environment (click + own playing + room reverb) is the worst-case ASR setting; voice activation false-positives in a music app would be catastrophic. MVP uses chips + typed free-text only.
31. **Define hotkey or affordance for mid-session Q&A** so the user can ask without grabbing the mouse. Pausing-on-question is the expected behavior; resume on dismiss.

---

## Feasibility Verdict

Honest assessment of the overall vision:

- **DSP scoring: 8/10 feasible.** Well-trodden territory. Provided the
  headline bugs get fixed (formula vs test matrix, under-play loophole,
  transfer function), this will work for 80%+ of practice scenarios on
  day one. Edge cases (heavy distortion, very fast tempos, polyphonic
  chord-melody playing) will need polish.

- **Local-model coach as a "real coach": 5.5/10.** A 3B-parameter local
  model can't do real analysis — it can only paraphrase. If the mental
  model is "ChatGPT but local," users will be disappointed.

- **Local-model coach as a "narrator + chip-driven Q&A": 8.5/10.** Up
  from 7.5 in rev 3. The chip architecture is the reason: it removes the
  LLM from the hot path for ~80% of Q&A (deterministic template fills),
  reserves it for long-tail free-text questions only, and makes the
  user-perceived intelligence a function of the *chip catalog* rather
  than the *model size.* Combined with the two-tier notification split,
  the LLM only needs to do paraphrasing of pre-filled templates and
  occasional bounded Q&A — both well within local-model capability.

- **Overall WOW achievable: yes, with high confidence.** The wow comes
  from DSP precision, instrument-specific framing, longitudinal
  awareness, visual diagnostics, **actionable interventions**, and
  **chip-driven Q&A** that always knows what to suggest next. Not from
  the LLM being clever. The LLM is decoration; the DSP, the templates,
  the chip catalog, and the intervention catalog are the foundation.

- **Month-2 fatigue risk: real but manageable.** Event-driven gating +
  two-tier channel split + chip variety + progressive substance unlock +
  milestone events + user-tunable verbosity buys most of the engagement
  budget. The remaining truth: this is a metronome coach, not a music
  coach. The win condition is "quietly useful, frequently helpful
  companion that knows when to speak and what to offer," not "infinite
  novelty."

- **The bet to make:** invest authoring effort in three catalogs — the
  template catalog (~450 slots), the chip catalog (~50 chips), and the
  intervention catalog (~10-15 interventions). Each is a day to a few
  days of writing work, and together they define the entire surface area
  of the coach's intelligence. The local LLM exists only to make all
  three feel less rigid. Skimping on any of the catalogs and overinvesting
  in prompt engineering is the most likely way this project fails to feel
  "smart."

## Closing

The plan's core architectural insights (interval-first scoring,
heuristic-gatekeeper-plus-model, synthetic tests) are sound. The gap between
those insights and a buildable spec is in seven places now:

1. **Numerical definitions** — the formula vs the test matrix, the missing
   `interval_consistency` transfer function.
2. **Cross-phase dependencies** — D4 belongs before D3.
3. **Unstated local-model constraint** — small-model inference quality is
   the load-bearing risk if the coach is treated as an analyst.
4. **Missing instrument awareness** — every "magic constant" in DSP and
   every "generic phrasing" in the coach is wrong for at least one of the
   five instruments. D0 consolidates all of these into a profile struct.
5. **Missing strategy for WOW on a local model** — the LLM is decoration,
   not foundation. Template Substance + LLM Style is the pattern.
6. **Missing UX channel model** — TTS during play is the primary feedback
   channel, not the screen. The written feed is the coach's notebook,
   read at pauses. The earlier "default to silence" recommendation
   misread this and is replaced with event-driven gating across the
   two-tier system.
7. **Missing user-facing surface area** — without the chip catalog and
   the intervention catalog, the coach has no visible "menu" of what it
   can do. The chip catalog in particular is the literal surface area of
   the coach's intelligence and the cheapest way to scale perceived
   sophistication.

All seven are fixable on paper before any code is touched. D0 in particular
is small and high-leverage — adding it first means D2/D3/C5 each consume
the profile cleanly rather than re-deriving instrument-specific constants
when the dropdown ships later.

**The three authoring catalogs are the foundation of the coach's
intelligence:**

- **Template catalog** (~450 slots) — what the coach can *observe*.
- **Chip catalog** (~50 chips) — what the coach can *answer*.
- **Intervention catalog** (~10-15 interventions) — what the coach can
  *suggest and act on*.

Each is hours-to-days of writing work; together they define the entire
surface area of user-perceived intelligence. Better chips beat better
prompts. Better interventions beat smarter analysis. Better templates
beat fancier phrasing. The local LLM exists to make all three feel less
rigid — it is not, and cannot be, the source of the intelligence.

**The bet to make:** invest in DSP correctness, instrument profiles, the
three catalogs, the two-tier notification system, exercise-boundary
detection, and visual diagnostics. Use the local LLM only for phrasing
variation and long-tail Q&A escape hatches. Done well, this hits "wow"
on consumer hardware — not because the model is clever, but because the
*tool* is, and because it shows up at exactly the right moments.
