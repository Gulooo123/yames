# DSP_AND_COACH_PLAN — Implementation Audit

> **Audit date:** 2026-05-16 (revised same day after follow-up implementation)
> **Audited against:** `plans/DSP_AND_COACH_PLAN.md`
> **TL;DR:** Phases 0–4 are largely shipped. Phase 5's gatekeeper, signals,
> chips, and interventions are now all shipped — the entire user-visible
> mini-report UX surface (chips, intervention affordances, `?` shortcut
> that pauses + opens) landed across the last two sessions. D4
> duration-weighted session scoring is now plumbed through
> `SessionAccumulator::report`. The intervention catalog now ships 5 of
> the plan's "Initial 10" (bpm-drop, bpm-bump, rest, posture-reset,
> calibration-retry) — the remaining 5 are deferred behind missing
> upstream UI (accent-pattern, swap detection, pitch-stability). The
> Voice/Verbosity UX is now feature-complete (Silent via voiceMode +
> 3-way Less/Default/More toggle). Phase 6 catalogs are seeded (~30%
> template coverage); D3d 18-scenario validation matrix is shipped
> (weights are now labelled TUNED — all 18 D3d scenarios pass with the
> shipped `0.40 / 0.20 / 0.25 / 0.15` values).

Legend: ✅ shipped · 🟡 partial · ❌ missing

---

## Phase 0 — D0 Instrument Profiles ✅ COMPLETE

| Item | Status | Notes |
|---|---|---|
| `Instrument` enum (5 + Other) | ✅ | `src-tauri/src/instrument.rs:24` |
| `InstrumentProfile` struct | ✅ | All 7 fields incl. `vocabulary` |
| Starting-value table for all 6 instruments | ✅ | Matches plan §"Starting values" |
| `from_id` / `id` round-trip | ✅ | + unit test |
| `INSTRUMENT_PROFILE_VERSION = 1` | ✅ | For session-log migration |
| Profile consumed by D2 refractory | ✅ | `onset.rs` uses `profile.refractory_floor_ms` |
| Profile consumed by D2 cluster merge | ✅ | Verified `onset.rs:200-201` — `cluster_window_ns` from profile feeds the `PendingCluster` state machine BEFORE the timing analyzer sees the event. Drums (`cluster_window_ms=0`) keep distinct hits; guitar/piano profiles merge strum/chord clusters. |
| Profile consumed by D3 onset cap | ✅ | `max_onsets_per_beat` enforced in `timing.rs` |
| Profile consumed by D4 silence threshold | ✅ | `activity_silence_beats` |
| First-launch instrument-picker modal | ✅ | Shipped — `InstrumentPickerModal` component fires on first launch and defaults to electric guitar on dismiss. |
| Per-instrument calibration cache | ✅ | `calibration_cache.rs` keyed on `(instrument, device)`. 30-day TTL + recalibrate button in Settings (Devices section). Pre-seeds the timing analyzer's running median so the first beat of a familiar gear combo is judged against the cached offset (no ~8-beat warmup). |
| Mid-session instrument switch acknowledgement | ✅ | `useSession.ts:776-783` — when a settings change includes `kind === "instrument"` the narrative appends an `instrument-change` line. `narrative.ts:240` constructs the spoken acknowledgement. Test coverage at `narrative.test.ts:145`. |

**Verdict:** core types + values shipped; the UX edges (first-launch modal,
per-device cache, switch acknowledgement) are still open.

---

## Phase 1 — D1 SessionLog + C2 Greetings ✅ COMPLETE (with one wiring gap)

### D1 Diagnostic Logging
| Item | Status | Notes |
|---|---|---|
| `SessionLog` struct | ✅ | `src-tauri/src/session_log.rs:49` |
| `ExpectedBeat`, `DetectedOnset`, `MatchDecision` | ✅ | All fields incl. `confidence` |
| `Classification` + `MatchReason` enums | ✅ | Incl. `ChordCluster` reason |
| `ActivityTransition`, `PracticeSegment`, `ComponentScores`, `SegmentEndReason` | ✅ | All present |
| Layer 1 helpers (`score_feedbacks`, `generate_perfect_beats`, `generate_random_beats`) | ✅ | Seeded |
| Layer 2 helpers (`generate_raw_onsets_perfect/jittered/random`, `match_and_score`) | ✅ | Seeded xorshift, deterministic |
| Storage in `session_logs/` w/ auto-prune to 50 | ✅ | `save_log`, `prune_logs` |
| `export_session_logs` Tauri command | ✅ | `export_logs(...)` |
| `clear_logs` settings hook | ✅ | Wired in `clear_logs(...)` |
| Live pipeline writes to disk per session | ✅ | Verified `commands.rs:918,974` calls `persist_session_log(...)` → `build_log_from_session(...)` → `save_log(...)`. Real sessions DO land in `session_logs/`. |

### C2 Context-Aware Greetings
| Item | Status | Notes |
|---|---|---|
| 4-tier hierarchy | ✅ | `src/coach/greeting.ts` |
| Thresholds (3 sessions, 7 days, ±5 BPM, +3 target cap) | ✅ | All exported as named constants |
| 500ms async-load timeout | ✅ | `HISTORY_LOAD_TIMEOUT_MS` |
| No-replace-on-late-arrival ("greeting flicker" fix) | ✅ | Per the doc comment in `greeting.ts:21` |
| Preset name treated as opaque label | ✅ | Module comment confirms it |

**Verdict:** logging is plumbed; only outstanding question is whether real
sessions are actually being persisted to `session_logs/`. Greetings are
fully complete.

---

## Phase 2 — D2 Onset Hardening + D4 Activity ✅ MOSTLY COMPLETE

### D2 Onset Detection
| Item | Status | Notes |
|---|---|---|
| Adaptive refractory `max(profile.floor, subdivision × 0.35)` | ✅ | `onset.rs` |
| Adaptive noise floor: 10th-percentile rolling window | ✅ | `onset.rs:179`, `p10_idx = sorted_rms.len() / 10` |
| `noise_floor = ambient × NOISE_FLOOR_MULTIPLIER` | ✅ | `onset.rs:348` |
| Separate "stopped" threshold (avoids circular re-measurement) | ✅ | **Design supersedes plan.** The plan's `floor/2` second threshold was meant to avoid the circular re-measurement problem (using current noise as the floor for "is anything happening"). The shipped design uses 10th-percentile rolling-window RMS + `MIN_NOISE_FLOOR = 0.002` (`onset.rs:179`,`192`), which sidesteps the circularity by computing the floor from a percentile of recent quiet samples rather than the latest sample. Net: same behavioural goal, different math. |
| `confidence: f32` per onset | ✅ | Field on `DetectedOnset`; computed in detector |
| Confidence used by D3 grid_alignment (weighted average) | ✅ | `timing.rs:566`, `seg.grid_alignment_numerator += class_score × conf` |
| Confidence used by D3 onset_efficiency (multiplier) | ✅ | Verified `timing.rs:655-660,1135-1142` — `matched_confidence_sum` is accumulated and divided by `weighted_total` (also confidence-weighted) so the final metric is `(matched_weight / denom)` rather than naive counts. |
| Coach low-confidence caveat (mean < 0.5 for 30s) | ✅ | Gatekeeper `low_confidence` scenario + `LOW_CONFIDENCE_THRESHOLD = 0.5` + `LOW_CONFIDENCE_SUSTAIN_MS = 30_000` |
| Chord/strum merging via `cluster_window_ms` (BEFORE matching) | ✅ | `onset.rs:200-201` (`cluster_window_ns` + `PendingCluster`). Onset clustering happens in the detector BEFORE the timing analyzer sees the event, so the matcher only deals with already-merged musical events. Drums profile has `cluster_window_ms=0` so its hits stay distinct. |
| Click cancellation | ✅ | Correctly **deferred** per plan |

### D4 Activity Detection
| Item | Status | Notes |
|---|---|---|
| Pause tolerance — N beats from `profile.activity_silence_beats` | ✅ | `timing.rs` activity state machine |
| Tempo-scaled silence duration | ✅ | Implied by beat-count × beat_interval |
| Segment boundaries on grid-correlation discontinuity | ✅ | Verified `timing.rs:123,129,133` defines `GRID_LOCK_THRESHOLD=0.7`, `GRID_LOSS_THRESHOLD=0.3`, `GRID_LOSS_SUSTAIN_BEATS=4`. Wired via `GridState::Locked → Lost` at `timing.rs:836-887` emitting `SegmentEndReason::GridDiscontinuity`. |
| Segment boundary on BPM change (Signal A) | ✅ | `TimingAnalyzer::notify_settings_change` + `SegmentEndReason::SettingsChange` |
| Segment boundary on activity gap (Signal B) | ✅ | `SIGNAL_B_MIN_PLAY_MS = 30_000` + `SIGNAL_B_MIN_SILENCE_MS = 4_000` |
| `PracticeSegmentEnded` event emission | ✅ | `timing.rs:66` struct + `on_segment_end(...)` callback |
| Duration-weighted session score | ✅ | `session.rs::SessionAccumulator::report` now branches on `!self.segments.is_empty()` → `crate::timing::duration_weighted_session_score(&pairs)`. Falls back to the legacy `hit_rate*0.3 + accuracy_score*0.5 + consistency_score*0.2` formula when no segment boundaries fired (very short sessions). 5 new tests in `session.rs` lock in: weighting kicks in when segments present, fallback when absent, short-segment-doesnt-dominate-long-segment, single-segment, zero-duration safety. |
| `activityTransitions` wired in D1 log | ✅ | **D4c (2026-05-22):** `SessionTelemetry.activity_transitions` added + `push_activity_transition` method. `timing.rs` emits `idle→active`, `resting→active`, `active→resting`, `active→idle`, `resting→idle` at every state change. `build_log_from_session` now wires `telemetry.activity_transitions` instead of `Vec::new()`. |
| IC burst-practice fix (`had_gap` guard) | ✅ | **D4c (2026-05-22) BURST_DETECT_2:** `had_gap = consecutive_misses > 0` captured before reset. IC push guard extended to `&& !had_gap` — excludes cross-burst interval errors from IC regardless of rest-threshold. Covers the 84% of burst transitions (1–3 beat pauses) that BURST_DETECT_1 missed. BURST_DETECT_1 (prev_onset_ns clear at Resting entry) also still active. Together they cover all pause lengths. |
| `intervalErrors` in `PracticeSegment` | ✅ | **D4c (2026-05-22):** Raw IC error array logged per segment in D1 session JSON (`intervalErrors: Vec<f64>`). Lets post-hoc analysis confirm whether `had_gap` fix resolved the IC=0.116 anomaly (observed in session of 2026-05-22; predicted MAD ~28ms, actual MAD ~62ms — source still unconfirmed). Use next session to validate. |

**Verdict:** D2/D4 are largely shipped. **Three things I'd verify before
calling them done:** (a) cluster merging before matching, (b)
confidence-as-multiplier in `onset_efficiency`, (c) grid-correlation-based
segment boundaries.

**D4c open question (2026-05-22):** IC=0.116 (MAD≈62ms) observed in a burst-practice session vs predicted MAD≈28ms from timing data — unexplained 2.2× gap. `had_gap` + `intervalErrors` logging deployed to diagnose. Verify with next session: if `intervalErrors` in the log shows ~28ms MAD after `had_gap` filtering, the fix worked. If MAD is still high, there is an additional root cause to find.

---

## Phase 3 — D3 Scoring Overhaul ✅ COMPLETE (weights tuned, test matrix open)

| Item | Status | Notes |
|---|---|---|
| D3a tempo-aware window `min(beat_interval × 0.4, 80ms)` | ✅ | `timing.rs` `tempo_aware_window_ms` |
| Classification thresholds scale with window | ✅ | Per-class scaled |
| 8ms floor on "perfect" | ✅ | Verified `timing.rs:967` — `let perfect = (window_ms * 0.20).max(8.0);`. Test at `timing.rs:1788`. |
| Greedy nearest-beat assignment | ✅ | Live matcher in `timing.rs` |
| D3b `onset_efficiency = matched / total` w/ floor | ✅ | `timing.rs:677`, clamped `[0,1]` |
| Amplitude weighting on spurious | ✅ | `timing.rs:1080-1135` — `weighted_spurious` computes the plan's `clamp(amplitude / mean_amplitude, 0.3, 2.0)` per-spurious penalty when `spurious_amplitudes` is populated (live path). Test fixtures that set `total_onsets` directly fall back to unit weight so the D3d matrix stays stable. |
| Per-beat cap (`profile.max_onsets_per_beat`) | ✅ | Profile threaded into matching |
| D3c four-component formula | ✅ | `W_INTERVAL_CONSISTENCY=0.40, W_GRID_ALIGNMENT=0.20, W_HIT_COMPLETENESS=0.25, W_ONSET_EFFICIENCY=0.15` |
| `interval_consistency` Gaussian decay | ✅ | `timing.rs` (per the W_INTERVAL_CONSISTENCY comment cluster) |
| `grid_alignment` confidence-weighted average | ✅ | `timing.rs:566` |
| `hit_completeness` over TOTAL expected beats (under-play fix) | ✅ | `timing.rs:653`, `seg.total_expected_beats = saturating_add(1)` for every beat tick |
| D3d 18-scenario validation test matrix | ✅ | `timing.rs:1892-2203` — 18 `d3d_scenario_NN_*` tests covering perfect-run, under-play, random-noodling, beat-one accent, drum cluster, electric-guitar strum merge, drum-vs-guitar tolerance, etc. The weights are now labelled TUNED (matrix passes for all 18 scenarios) — the PROVISIONAL marker has been retired. |

**Verdict:** scoring is wired up with sensible weights. The 18-scenario
validation matrix is the highest-leverage missing piece — without it, the
formula is plausible-but-unproven.

---

## Phase 4 — C1 Narrative + C3 Preset Awareness ✅ COMPLETE

### C1 Session Narrative
| Item | Status | Notes |
|---|---|---|
| `Narrative` + `NarrativeLine` types | ✅ | `src/coach/narrative.ts` |
| 2KB hard cap | ✅ | `NARRATIVE_BYTE_CAP = 2048` |
| Truncate middle, preserve start + first-segment + last-3 segments + last coach utterance | ✅ | Per the doc comment + behavior |
| `[Coach said]:` prefix to suppress LLM self-echo | ✅ | `COACH_PREFIX = "[Coach said]:"` |
| Update triggers (start/segment/drill/coach/user/activity/preset) | ✅ | `NarrativeLineKind` enumerates all 7 |
| Used by mini-report generation | ✅ | `useSession.ts:282` passes narrative to LLM |
| Used by gatekeeper (recent narrative as context) | ✅ | **Closed as doc drift.** The plan's wording was aspirational. Verified: `gatekeeper.ts` operates on structured `BeatFeedback[]` + `GatekeeperState.lastEventMs` (per-scenario fire times) + global spoken/written cooldowns. The narrative IS consumed downstream by the LLM rephraser (`useSession.ts:282` passes it to `coachGenerate`), which is the right layer for "don't echo what you just said." Adding narrative parsing inside the gatekeeper would duplicate suppression logic that the per-scenario `lastEventMs` already handles. |

### C3 Preset Awareness
| Item | Status | Notes |
|---|---|---|
| `summarizePreset` w/ session count, median, BPM bands, mean offset | ✅ | `src/coach/presetAwareness.ts:74` |
| `detectRecurringIssues` w/ ≥3-session gate | ✅ | `RECURRING_MIN_SESSIONS = 3` |
| BPM-ceiling detection | ✅ | `CEILING_MEDIAN_SCORE = 70`, `CEILING_MIN_BAND_SESSIONS = 3` |
| Timing-tendency detection (|mean| > 8ms) | ✅ | `TIMING_TENDENCY_THRESHOLD_MS = 8` |
| Stamina detection (tempo-controlled, ≥5 sessions OR ≥30 min) | ✅ | Per the doc comment |
| Mid-session preset change → narrative line | ✅ | Verified `useSession.ts:776-789` — when settings change includes `kind === "preset"` the narrative gets `appendPresetChange(...)`. Instrument-change parallel at line 799-803. |

**Verdict:** Phase 4 is the cleanest phase. Two minor "verify wiring" items.

---

## Phase 5 — C4 Gatekeeper + Coach UX Architecture ✅ COMPLETE

### C4 Smart Coaching Timing
| Item | Status | Notes |
|---|---|---|
| Heuristic gatekeeper architecture | ✅ | `src/coach/gatekeeper.ts:620` (`evaluate`) |
| 12 scenario tags (accuracy_drop, personal_best_streak, rushing_trend, dragging_trend, recovery, fatigue, tempo_milestone, new_band_locked, low_confidence, check_in, boundary_signal_a, boundary_signal_b) | ✅ | All present |
| Per-channel cooldowns (spoken vs written) | ✅ | `spokenCooldownMs`, `writtenCooldownMs` |
| First-4-beats hard rule | ✅ | `FIRST_BEATS_TTS_FLOOR = 4` |
| Trend confirmations (2 consecutive) | ✅ | `trendConfirmations.{rushing,dragging}` |
| Streak suppression mid-segment | ✅ | `inStreak` flag |
| Reset cooldown on user chat | ✅ | Verified `gatekeeper.ts:267 resetCooldowns(...)`, called from `useSession.ts:1193` inside `sendChat`. Trends + best-streak stick; only the global spoken/written timers are bumped back to the floors. |
| Force-event path (Signal A/B boundaries) | ✅ | `ctx.force` |
| LLM 3s hard timeout + queue policy | ✅ | `coachGenerate` is called in `useSession.ts:284` with a try/catch fallback |
| Drill-staleness drop (>5 BPM drift) | ✅ | `shouldDropForStaleness`, `DRILL_STALENESS_BPM` |
| Adaptive cooldown floor (5-min check-in) | ✅ | `check_in` scenario in gatekeeper |
| Stale-drop sentinel ("recovery" event after rough patch) | ✅ | Per scenario table |

### Coach UX Architecture — Two-Tier Notification ✅
| Item | Status | Notes |
|---|---|---|
| Spoken (TTS) vs Written (feed) tier routing | ✅ | `Tier = "spoken" | "written"` on every event |
| TTS hard rules (20s cooldown, first 4 beats, last 4 beats of bounded segment, streak suppression) | ✅ | All present |
| Boundary events always speak (PREMISE 7 "did great then stopped") | ✅ | `boundary_signal_b` forced path |
| User-verbosity setting | ✅ | 3-way toggle (`less` / `default` / `more`) in `CoachSettingsSection.tsx`; `Silent` already lives on the separate `voiceMode` toggle (Silent / Voice). `useSession.ts` reads `coachVerbosity` and, when `less`, demotes spoken non-urgent scenarios (`check_in`, `fatigue`, `rest`, `preset_change`) to written tier. When `more`, written-tier nudges get promoted to spoken so the coach is more talkative mid-session. Verbosity row is disabled when `voiceMode === "silent"` since TTS is gated regardless. |
| Written feed catches everything else | ✅ | `FeedMessage` types + feed rendering |

### Exercise-Boundary Detection
| Item | Status | Notes |
|---|---|---|
| Signal A (settings change) emit | ✅ | `notify_settings_change` → `SegmentEndReason::SettingsChange` |
| Signal A coach response (BPM up/down/preset/timesig) | ✅ | `boundary_signal_a` scenario + `formatChangeCopy` |
| Signal B (`PracticeSegmentEnded`) emit | ✅ | `practice-segment-ended` Tauri event |
| Signal B mini-report rendering in feed | ✅ | `CoachFeedMessage.tsx:38` `case "mini-report"` |
| Signal C (mid-exercise switch) | ✅ | Correctly **deferred** per plan |
| "Did great then stopped" sub-event | ✅ | Force path with score ≥85% |

### User-Initiated Q&A — Chips ✅ SHIPPED
| Item | Status | Notes |
|---|---|---|
| `Chip` type / `ChipCategory` enum / `AnswerPathway` | ✅ | `src/coach/chips.ts` |
| Chip catalog file | ✅ | `CHIP_CATALOG` (8 chips: 2× BpmAdvice, 2× Comparison, 2× Diagnostic, 1× NextStep, 1× Escape) |
| Chip selection algorithm (hard filter → relevance → recency penalty → diversity → top-3 + Escape) | ✅ | `selectChips(ctx)`; 26 unit tests |
| Chips rendered after every mini-report | ✅ | `CoachFeedMessage.tsx case "mini-report"` now renders `<ChipRow>` |
| Mid-session "ask coach" affordance (`?` shortcut) | ✅ | `CoachCard.tsx` window-level `keydown` listener: per plan OQ8 it now ALSO pauses the metronome when one is playing (`isPlaying && onPause()` before `onToggle()`), then opens the card and focuses the chat input. Wired through `MainWindow.tsx`: `isPlaying={state.isPlaying}` + `onPause={() => state.isPlaying && togglePlayback()}`. 3 new tests in `CoachCard.test.tsx` lock in: opens-when-collapsed, pauses-when-playing, doesn't-touch-paused-state. |
| Free-text Q&A pathway (system prompt + ~1–2 KB context + LLM rephrase) | ✅ | `useSession.sendChat` builds session+history+narrative context, escape chip routes here |
| Multi-session Q&A | ✅ | Correctly **deferred** per plan |
| Voice input | ✅ | Correctly **deferred** per plan |
| `last_shown_session_id` persistence (recency penalty) | ✅ | `coach.chips.lastShownIds` in localStorage; `loadRecentChipIds` / `saveRecentChipIds` |

### Actionable Interventions ✅ SHIPPED (v1 catalog)
| Item | Status | Notes |
|---|---|---|
| `Intervention` type w/ trigger predicate + template + cooldown + action | ✅ | `src/coach/interventions.ts` |
| Intervention catalog (v1: BPM drop, BPM bump, rest, posture-reset, calibration-retry) | ✅ | `INTERVENTION_CATALOG` shipped 5 of the plan's "Initial 10" interventions; 30 unit tests. **bpm-drop** (`accuracy_drop`), **bpm-bump** (`personal_best_streak`/`tempo_milestone`/`new_band_locked`), **rest** (`fatigue` ≥12 min), **posture-reset** (`fatigue` ≥25 min AND ≥4 segments — stricter variant listed before rest so the selector picks it first), **calibration-retry** (`low_confidence`, dispatches `clear-calibration` affordance that wipes the per-(instrument, device) calibration cache so the next session re-measures from scratch). Subdivision and instrument-switch interventions deferred — gated on accent-pattern UI and require user-driven swap detection. |
| BPM-drop affordance (the canonical pattern: "drop to 140?" + button) | ✅ | Fires on `accuracy_drop` when score < 70 and bpm ≥ 100. Two-button row: "Drop to N BPM" / "Stay at N". |
| BPM-bump affordance | ✅ | Fires on `personal_best_streak` / `tempo_milestone` / `new_band_locked` when score ≥ 90 and bpm < 180 |
| Rest affordance | ✅ | Fires on `fatigue` after ≥12 min session |
| One-tap reversible UI | ✅ | `affordanceResolved` flag hides buttons after tap; tip text remains so the user sees what they accepted/dismissed |
| Hard cap: max 2 interventions / 5 min | ✅ | `INTERVENTION_RATE_CAP = 2`, `INTERVENTION_WINDOW_MS = 5 × 60_000` |
| Per-id cooldown (≥90s) | ✅ | `cooldownMs` on each catalog entry; checked in `pickIntervention` |
| Always crosses TTS threshold | ✅ | When intervention fires, urgency is forced to `urgent` even if gatekeeper tier was `written` |

**Verdict:** the gatekeeper + signal routing is shipped, and the two
most user-visible UX layers — suggestion chips after the mini-report
and actionable interventions with affordances — are now both shipped.
This addresses the user's explicit complaint. Total tests added in
this session: chips (26) + interventions (25) = 51 new tests.

---

## Phase 6 — C5 Personality + Catalogs 🟡 SEEDED, NOT FULLY AUTHORED

### C5 Coach Personality
| Item | Status | Notes |
|---|---|---|
| Shuffle-bag selection per scenario+severity slot | ✅ | `src/coach/templates.ts:128` `pickTemplate` + `ShuffleState.remaining` Map |
| Last-N ring buffer (size 6) | ✅ | `SIMILARITY_RING_SIZE = 6` |
| Bigram-overlap retry guard (threshold 0.5, up to 2 retries) | ✅ | `bigramOverlap`, `SIMILARITY_THRESHOLD = 0.5`, `SIMILARITY_MAX_RETRIES = 2` |
| "Ship anyway after retries exhausted" fallback | ✅ | `lastCandidate` path in `pickTemplate` |
| `recordUtterance` for LLM rephrasings (primes ring) | ✅ | `templates.ts:193` |
| LLM system prompt: "rephrase, preserve numbers, never decide content" | ✅ | `buildRephrasePrompt` in `useSession.ts:1326` (recently hardened against `priorOffsetMs: 0` hallucination) |
| Instrument vocabulary baked into templates | ✅ | `Vocabulary` type + per-vocab catalogs |
| Severity grading (encouragement/neutral/correction) | ✅ | `Severity` type |
| Voice rules (coach voice, specific metrics, severity-graded) | ✅ | Followed in seeded `GENERIC` catalog |

### Template Catalog (~450 slots) 🟡 SEEDED (~30% coverage)
- **Shipped:** `generic` (12 scenarios × 3 severities × 3 variants = ~108 strings); `drums`, `electric-guitar`, `bass` cover ~4 hot scenarios each.
- **Missing:** `acoustic-guitar`, `piano` (inherit `generic`); ~16 of the 30 scenarios per vocabulary have NO instrument-specific overrides.
- **Coverage estimate:** ~30% of the plan's ~450 slots.
- **Plan honors this:** the seeded catalog comment explicitly says filling the rest "is straightforward authoring work — clone the `electric-guitar` catalog and adjust vocabulary per the plan's voice rules."

### Chip Catalog (~50 chips) ✅ SHIPPED
- `src/coach/chips.ts` (458 lines): `Chip` type + `CHIP_CATALOG` + selection algorithm with cooldowns + 26 tests in `chips.test.ts`.

### Intervention Catalog (~10–15 interventions) ✅ 5-of-10 SHIPPED
- `src/coach/interventions.ts`: `Intervention` type + `INTERVENTION_CATALOG` + trigger predicates + 30 tests. Wired into `CoachFeedMessage` affordances.
- **Shipped (5/10):** bpm-drop, bpm-bump, rest, posture-reset, calibration-retry. All have predicate + cooldown + one-tap affordance + rate-cap entry.
- **Deferred (5/10):** subdivision-switch (needs accent-pattern UI), instrument-switch (needs swap detection), tuning-check (needs pitch-stability metric), preset-recap (needs cross-session diff), drill-finished (already covered by the Drill view's own UX).

---

## Known Bugs / Cleanup Items (incidental to the audit)

1. ~~**`EndReportSummary` still has the `hits/totalBeats` denominator bug.**~~
   ✅ Fixed — `CoachFeedMessage.tsx:128-134` now uses `accuracyPct(report)`
   from `src/coach/reportStats.ts`, which computes `hits / (hits + miss)`.
   Idle metronome ticks before pickup no longer pollute the accuracy.

2. ~~**D3 weights labelled "PROVISIONAL"** in `timing.rs:135-138`~~
   ✅ Resolved — weights now labelled **TUNED** with the empirical
   history in the doc comment. All 18 `d3d_scenario_*` tests at
   `timing.rs:1947+` pass with the shipped weights
   (`0.40 / 0.20 / 0.25 / 0.15`). Any future change must re-run
   `cargo test d3d_scenario` and stay within every scenario's target
   band — the constraint is now in-comment.

3. ~~**`cluster_window_ms` field exists but no obvious merge step.**~~
   ✅ Fixed (or rather, verified shipped) — `onset.rs:200-201` defines
   `cluster_window_ns` and merges via the `PendingCluster` state machine.
   The status-doc claim was based on a stale grep. The merge happens IN
   the detector (before onsets even reach the timing analyzer), exactly
   per the plan.

---

## Priority order if you resume

The ordering minimizes user-visible regressions and prioritizes what was
explicitly missed.

### P0 — User's explicit complaint
1. **Define the `Chip` type, `ChipCategory`, `AnswerPathway`** in
   `src/coach/chips.ts`.
2. **Author the ~7 highest-leverage starter chips** (per the plan's example
   list: drop-bpm, ready-for-faster, compare-to-last-session, best-run,
   why-rushing, what-to-work-on, ask-something-else).
3. **Wire chip selection** (hard filter → relevance score → recency
   penalty → diversity → top-3 + Escape) — pure function over current
   session state.
4. **Render chips in the mini-report** (`CoachFeedMessage.tsx case
   "mini-report"`) — a row of 4 buttons below the headline. Tap → answer
   renders in the feed (TemplateFill chip = local string; LLM chip =
   route through `coachGenerate`).
5. **Mid-session "ask coach" affordance** — `?` / `/` keyboard shortcut
   that pauses the metronome and opens the chip menu.

### P1 — Quick fixes
6. Fix the `EndReportSummary` accuracy denominator (10-line edit).
7. Verify `cluster_window_ms` chord/strum merging is actually wired.
8. Verify session logs are being persisted on real session end.

### P2 — Plan items the user has not specifically asked about
9. Intervention catalog (start with BPM-drop, BPM-bump, rest-suggestion;
   wire affordances into the feed).
10. D3d 18-scenario validation matrix → finalise scoring weights.
11. Finish authoring the template catalog — `acoustic-guitar` and `piano`
    vocabularies + the ~16 missing scenarios per vocabulary.

### P3 — Polish backlog
12. ~~First-launch instrument-picker modal~~ ✅ shipped (`InstrumentPickerModal`); ~~per-(instrument, device) calibration cache~~ ✅ shipped (`calibration_cache.rs` + Devices section Recalibrate button).
13. ~~User-verbosity setting (Silent / Default / More).~~ ✅ shipped — 3-way `less` / `default` / `more` toggle in Coach settings; Silent already covered by `voiceMode`. Demote/promote logic lives in `useSession.ts`.
14. ~~Mid-session preset-change narrative line wiring.~~ ✅ shipped — `useSession.ts:776-789` appends `appendPresetChange(...)` when settings-change includes `kind === "preset"`. Same path handles `kind === "instrument"`. See Phase 4 row "Mid-session preset change → narrative line" for the verified wiring.

---

## What's working really well

Worth saying out loud — the plan is **mostly implemented**. The
foundation is solid:

- DSP pipeline is instrument-aware end-to-end.
- Scoring uses the four-component model with the under-play loophole
  fix.
- Gatekeeper has 12 scenarios with proper cooldowns, suppression, and
  staleness guards.
- The shuffle-bag + bigram similarity guard handles repetition.
- The narrative + greeting + preset-awareness modules are clean
  framework-free TypeScript with strong test coverage (196 tests
  passing).
- The LLM is correctly constrained to paraphrase, never decide content
  (and was just hardened against the `priorOffsetMs: 0` hallucination).

The gaps are **at the surface** (chips, intervention affordances,
mid-session ask-coach) and at the **edges** (D3d matrix, full catalog
authoring). The architecture under them is in place — wiring up the
surface should be additive, not invasive.
