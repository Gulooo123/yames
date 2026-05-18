//! D1 — Diagnostic Logging
//!
//! Comprehensive per-session capture: ground truth (expected beats),
//! raw detections (onsets), matching decisions, activity transitions,
//! practice segments, and the final report. Stored as JSON in
//! `app_data_dir/session_logs/` and auto-pruned to the last
//! `MAX_SESSION_LOGS` files.
//!
//! "You can't fix what you can't see." This module unblocks D2 (onset
//! hardening), D3 (scoring formula iteration), D4 (segment tuning), and
//! C1 (narrative authoring). The wider pipeline (engine → eval → log)
//! is wired in later phases; D1 ships the types + storage + synthetic
//! test helpers so the subsequent phases have a stable foundation.
//!
//! Two layers of synthetic helpers (the plan emphasizes both):
//!   * **Layer 1** (post-match): operates on `BeatFeedback` to iterate
//!     the scoring formula in isolation. Fast, deterministic.
//!   * **Layer 2** (raw-onset): operates on `DetectedOnset` +
//!     `ExpectedBeat` and exercises the matching pipeline. Required
//!     for D3a validation — the matcher is what Phase 3 changes most.
//!
//! Determinism: every synthetic helper takes an explicit `seed: u64`.
//! No `rand::random()` calls. Test failures must be reproducible.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::instrument::{Instrument, InstrumentProfile, INSTRUMENT_PROFILE_VERSION};
use crate::session::SessionReport;
use crate::timing::BeatFeedback;

/// Maximum number of session logs to retain on disk. ~30-min sessions
/// average 1–2 MB so 50 logs ≈ 50–100 MB. This is dev/debug data, not
/// user-facing — the trade-off is explicit (storage vs. ability to
/// debug regressions retroactively).
pub const MAX_SESSION_LOGS: usize = 50;

/// Subdirectory under app_data_dir for session log JSON files.
pub const SESSION_LOGS_DIR: &str = "session_logs";

// ---------------------------------------------------------------------------
// Data types — mirror plan D1 §"What to capture per session"
// ---------------------------------------------------------------------------

/// Full per-session diagnostic log. Persisted as one JSON file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionLog {
    pub bpm: u16,
    #[serde(rename = "timeSignature")]
    pub time_signature: u8,
    pub subdivision: u8,
    /// Seconds since UNIX epoch (session start).
    pub timestamp: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub instrument: Instrument,
    /// Version of the `InstrumentProfile` defaults this log was
    /// produced with. Allows migration if profile defaults change.
    #[serde(rename = "instrumentProfileVersion")]
    pub instrument_profile_version: u32,

    /// Ground truth — when beats were expected.
    #[serde(rename = "expectedBeats")]
    pub expected_beats: Vec<ExpectedBeat>,

    /// Raw detections — what the onset detector found.
    #[serde(rename = "detectedOnsets")]
    pub detected_onsets: Vec<DetectedOnset>,

    /// How onsets were paired to beats.
    pub matches: Vec<MatchDecision>,

    /// Indices into `detected_onsets` for onsets that didn't pair with
    /// any beat (i.e. didn't fall inside any beat's matching window).
    #[serde(rename = "spuriousOnsets")]
    pub spurious_onsets: Vec<u32>,

    /// State transitions of the activity detector (D4 will populate
    /// this; D1 reserves the field).
    #[serde(rename = "activityTransitions")]
    pub activity_transitions: Vec<ActivityTransition>,

    /// Practice segments (D4 emits these; D1 reserves the field).
    pub segments: Vec<PracticeSegment>,

    /// Final aggregate report.
    pub report: SessionReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpectedBeat {
    pub index: u32,
    #[serde(rename = "timestampMs")]
    pub timestamp_ms: u64,
    #[serde(rename = "isAccent")]
    pub is_accent: bool,
    /// May change per-beat under an adaptive drill ramp.
    #[serde(rename = "expectedBpm")]
    pub expected_bpm: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedOnset {
    #[serde(rename = "timestampMs")]
    pub timestamp_ms: u64,
    pub amplitude: f32,
    /// Spectral centroid (Hz).
    pub centroid: f32,
    /// 0.0–1.0. D1 fills with `1.0` for synthetic data; D2 will
    /// produce real values once confidence enters the detector.
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchDecision {
    #[serde(rename = "beatIndex")]
    pub beat_index: u32,
    /// First entry is the "best match"; rest are accepted-but-not-scored
    /// (chord voicings, ghost notes).
    #[serde(rename = "onsetIndices")]
    pub onset_indices: Vec<u32>,
    /// Best-match deviation in ms (signed — negative = early).
    #[serde(rename = "deviationMs")]
    pub deviation_ms: i32,
    pub classification: Classification,
    pub reason: MatchReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Classification {
    Perfect,
    Good,
    Ok,
    Miss,
    Skipped,
}

// `from_str`/`as_str` are part of the synthetic-test surface in
// `timing.rs::tests` and `session_log.rs::tests`; lib-only builds
// don't reach them so cargo flags the items as never used. The
// allow-attr keeps the default build warning-clean without losing
// the helpers (they're plan-mandated for D1 fixture generation).
#[allow(dead_code)]
impl Classification {
    /// Map the legacy `String` classification (from `BeatFeedback`) to
    /// the enum. Unknown values map to `Skipped` defensively.
    pub fn from_str(s: &str) -> Self {
        match s {
            "perfect" => Classification::Perfect,
            "good" => Classification::Good,
            "ok" => Classification::Ok,
            "miss" => Classification::Miss,
            _ => Classification::Skipped,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Classification::Perfect => "perfect",
            Classification::Good => "good",
            Classification::Ok => "ok",
            Classification::Miss => "miss",
            Classification::Skipped => "skipped",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchReason {
    /// Onset landed within the per-class matching window.
    InsideWindow,
    /// Onset(s) existed near the beat but outside the matching window.
    OutsideWindow,
    /// Activity detector said the user wasn't playing (warmup/idle).
    NoActivity,
    /// Onset existed but the detector's confidence was below the floor.
    BelowConfidence,
    /// Multiple onsets within `cluster_window_ms` collapsed into one.
    ChordCluster,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityTransition {
    #[serde(rename = "timestampMs")]
    pub timestamp_ms: u64,
    /// e.g. "idle→active", "active→resting". Free-form to keep D4 nimble.
    pub transition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PracticeSegment {
    #[serde(rename = "startMs")]
    pub start_ms: u64,
    #[serde(rename = "endMs")]
    pub end_ms: u64,
    #[serde(rename = "startBpm")]
    pub start_bpm: u16,
    #[serde(rename = "endBpm")]
    pub end_bpm: u16,
    /// Composite D3 score in **0–100** range.
    ///
    /// Produced by `timing::score_segment` which weights its four
    /// [0, 1] sub-components and multiplies by 100 at the bottom. Do
    /// not confuse with `component_scores.*`, which are individual
    /// 0–1 fractions. `SessionAccumulator::report` consumes this
    /// field directly via `duration_weighted_session_score` (scale
    /// preserving) so any tests that synthesise segments must use
    /// 0–100 here too — passing 0.75 by accident here produces a
    /// session score of `1` instead of `75` (v0.9 regression).
    pub score: f32,
    #[serde(rename = "componentScores")]
    pub component_scores: ComponentScores,
    #[serde(rename = "endReason")]
    pub end_reason: SegmentEndReason,
    /// Path B — divisor the rhythm-inference settled on for this
    /// segment. 1 = quarters, 2 = 8ths, 3 = triplets, 4 = 16ths,
    /// 6 = sextuplets. `#[serde(default)]` so historic logs (written
    /// before Path B) still deserialize cleanly: missing field is read
    /// as 0 and the JS / post-hoc tooling can treat 0 as "unknown".
    #[serde(rename = "inferredDivisor", default)]
    pub inferred_divisor: u8,
    /// Path B — confidence of the inferred divisor at segment close
    /// (fit ratio, 0.0–1.0). 0.0 if the matcher never locked.
    #[serde(rename = "inferredDivisorConfidence", default)]
    pub inferred_divisor_confidence: f64,
}

/// D3c — four-component scoring breakdown. Each component is in `[0, 1]`
/// (multiply by 100 to get the "0–100" form the plan documents).
///
/// Plan formula (see D3c in `plans/DSP_AND_COACH_PLAN.md`):
/// ```text
/// score = interval_consistency × W1
///       + grid_alignment       × W2
///       + hit_completeness     × W3
///       + onset_efficiency     × W4
/// ```
///
/// `interval_consistency` is latency-independent (it measures spacing
/// only). `grid_alignment` rewards on-grid placement. `hit_completeness`
/// uses TOTAL expected beats — not active-only — to close the under-play
/// loophole. `onset_efficiency` distinguishes structured practice from
/// random noodling.
///
/// Wire format uses camelCase to match the JS-side `ComponentScores` type.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComponentScores {
    #[serde(rename = "intervalConsistency")]
    pub interval_consistency: f32,
    #[serde(rename = "gridAlignment")]
    pub grid_alignment: f32,
    #[serde(rename = "hitCompleteness")]
    pub hit_completeness: f32,
    #[serde(rename = "onsetEfficiency")]
    pub onset_efficiency: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SegmentEndReason {
    /// Signal A — BPM, time signature, subdivision, etc. changed.
    SettingsChange,
    /// Signal B — activity detector saw a gap longer than threshold.
    ActivityGap,
    /// Signal D — grid-correlation discontinuity. Player was locked
    /// to the subdivision grid (correlation ≥ GRID_LOCK_THRESHOLD)
    /// and then dropped to ≤ GRID_LOSS_THRESHOLD for at least
    /// GRID_LOSS_SUSTAIN_BEATS consecutive beat ticks. Distinct from
    /// ActivityGap: the player is still playing, just not following
    /// the grid anymore.
    GridDiscontinuity,
    SessionEnd,
    UserStopped,
}

// ---------------------------------------------------------------------------
// Storage — JSON per session in `app_data_dir/session_logs/`.
// ---------------------------------------------------------------------------

/// Build a deterministic file name from session start timestamp.
/// Adding monotonic ns suffix avoids collisions on rapid re-creates.
fn build_filename(session: &SessionLog) -> String {
    format!(
        "session_{:010}_{:020}.json",
        session.timestamp,
        crate::clock::now_ns()
    )
}

/// Persist a session log to `app_data_dir/session_logs/`. Auto-prunes
/// to `MAX_SESSION_LOGS` files (oldest by filename → oldest first).
///
/// Returns the path that was written.
pub fn save_log(app_data_dir: &Path, log: &SessionLog) -> Result<PathBuf, String> {
    let dir = app_data_dir.join(SESSION_LOGS_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("create session_logs dir: {e}"))?;

    let path = dir.join(build_filename(log));
    let json = serde_json::to_string_pretty(log)
        .map_err(|e| format!("serialize session log: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write session log: {e}"))?;

    // Prune oldest if we exceed the cap.
    prune_logs(&dir, MAX_SESSION_LOGS)?;

    Ok(path)
}

/// List all session log files in chronological order (oldest first).
pub fn list_log_paths(app_data_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let dir = app_data_dir.join(SESSION_LOGS_DIR);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| format!("read session_logs dir: {e}"))?
        .filter_map(|r| r.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    // Filenames embed timestamp + ns suffix so lexicographic sort = chronological.
    entries.sort();
    Ok(entries)
}

/// Load a single session log by path.
pub fn load_log(path: &Path) -> Result<SessionLog, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read session log: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse session log: {e}"))
}

/// Delete oldest session logs beyond `max_count`. Idempotent.
pub fn prune_logs(dir: &Path, max_count: usize) -> Result<(), String> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| format!("read session_logs dir: {e}"))?
        .filter_map(|r| r.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    if entries.len() <= max_count {
        return Ok(());
    }
    entries.sort(); // oldest first
    let to_drop = entries.len() - max_count;
    for path in entries.iter().take(to_drop) {
        let _ = fs::remove_file(path); // best-effort
    }
    Ok(())
}

/// Export every session log into a single tarball-style JSON array file.
/// Privacy: logs are local-only; export is a deliberate user action.
/// Audio metadata only — no raw audio is captured anywhere in the
/// pipeline, so there's nothing more to redact.
pub fn export_logs(app_data_dir: &Path, dest: &Path) -> Result<usize, String> {
    let paths = list_log_paths(app_data_dir)?;
    let mut all: Vec<SessionLog> = Vec::with_capacity(paths.len());
    for p in &paths {
        if let Ok(log) = load_log(p) {
            all.push(log);
        }
    }
    let json = serde_json::to_string_pretty(&all)
        .map_err(|e| format!("serialize export: {e}"))?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create export parent dir: {e}"))?;
    }
    fs::write(dest, json).map_err(|e| format!("write export: {e}"))?;
    Ok(all.len())
}

/// Delete every persisted log. Used by Settings "clear diagnostics".
pub fn clear_logs(app_data_dir: &Path) -> Result<(), String> {
    let dir = app_data_dir.join(SESSION_LOGS_DIR);
    if !dir.exists() {
        return Ok(());
    }
    for p in list_log_paths(app_data_dir)? {
        let _ = fs::remove_file(p);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tiny seeded PRNG — xorshift64. The plan REQUIRES every synthetic
// helper to take an explicit seed; we keep it dependency-free to avoid
// dragging in `rand`.
// ---------------------------------------------------------------------------

/// Xorshift64. Stateless wrapper — callers thread the state themselves.
///
/// Test-only by design: the D1 synthetic-fixture helpers below need a
/// dependency-free seeded PRNG, but production code never touches it.
/// `#[allow(dead_code)]` keeps the lib-target build warning-clean
/// without losing visibility from the cross-module `#[cfg(test)]`
/// suites in `timing.rs`.
#[allow(dead_code)]
pub struct Xorshift64(u64);

#[allow(dead_code)]
impl Xorshift64 {
    pub fn new(seed: u64) -> Self {
        // Zero is a degenerate state for xorshift; promote to 1.
        Self(if seed == 0 { 0x9E3779B97F4A7C15 } else { seed })
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    /// Uniform `f32` in `[0.0, 1.0)`.
    pub fn next_f32(&mut self) -> f32 {
        // Top 24 bits → 0..2^24, divide by 2^24.
        ((self.next_u64() >> 40) as f32) / ((1u32 << 24) as f32)
    }
    /// Box–Muller standard-normal sample (one call returns one sample,
    /// pair partner is discarded — D1 doesn't need cache).
    pub fn next_gauss(&mut self) -> f32 {
        let mut u1: f32;
        loop {
            u1 = self.next_f32();
            if u1 > 1e-9 {
                break;
            }
        }
        let u2 = self.next_f32();
        let r = (-2.0_f32 * u1.ln()).sqrt();
        let theta = 2.0 * std::f32::consts::PI * u2;
        r * theta.cos()
    }
}

// ---------------------------------------------------------------------------
// Layer 1 — post-match synthetic helpers (cheap, fast, scoring-formula
// iteration). Operates on `BeatFeedback` and reuses the existing
// `SessionAccumulator::report()` path so changes to the scoring formula
// flow through automatically.
// ---------------------------------------------------------------------------

/// Score a vec of feedbacks → SessionReport. Thin wrapper over the
/// existing `SessionAccumulator` so plan-level test code can compute a
/// report without standing up a full evaluation session.
pub fn score_feedbacks(feedbacks: &[BeatFeedback]) -> SessionReport {
    let mut acc = crate::session::SessionAccumulator::new();
    for fb in feedbacks {
        acc.push(fb.clone());
    }
    acc.report()
}

/// Generate `count` perfectly on-time beats (deviation ≈ 0).
/// Determinism: no jitter, no randomness — pure baseline.
/// Lives outside `#[cfg(test)]` so cross-module test code in
/// `timing.rs` can pull it in via `use crate::session_log::...`;
/// `#[allow(dead_code)]` keeps the lib build clean.
#[allow(dead_code)]
pub fn generate_perfect_beats(count: u32, _bpm: u16) -> Vec<BeatFeedback> {
    (0..count)
        .map(|i| BeatFeedback {
            beat_index: i,
            deviation_ms: 0.0,
            interval_error_ms: 0.0,
            classification: "perfect".to_string(),
            amplitude: 0.5,
            calibration_offset_ms: 0.0,
            calibration_confidence: 1.0,
            grid_correlation: 1.0,
        })
        .collect()
}

/// Generate `count` random feedbacks scattered uniformly across the
/// classification bands. `onset_density` ∈ [0,1] is the probability
/// that a given beat is hit at all (rest = miss). Seeded.
/// Same cross-module test-only constraint as `generate_perfect_beats`.
#[allow(dead_code)]
pub fn generate_random_beats(
    count: u32,
    _bpm: u16,
    onset_density: f32,
    seed: u64,
) -> Vec<BeatFeedback> {
    let mut rng = Xorshift64::new(seed);
    (0..count)
        .map(|i| {
            let hit = rng.next_f32() < onset_density;
            if !hit {
                return BeatFeedback {
                    beat_index: i,
                    deviation_ms: 0.0,
                    interval_error_ms: 0.0,
                    classification: "miss".to_string(),
                    amplitude: 0.0,
                    calibration_offset_ms: 0.0,
                    calibration_confidence: 1.0,
                    grid_correlation: 0.5,
                };
            }
            // Uniform deviation in ±60ms — exercises all classes.
            let dev = (rng.next_f32() - 0.5) * 120.0;
            let abs = dev.abs();
            let class = if abs < 10.0 {
                "perfect"
            } else if abs < 25.0 {
                "good"
            } else if abs < 50.0 {
                "ok"
            } else {
                "miss"
            };
            BeatFeedback {
                beat_index: i,
                deviation_ms: dev as f64,
                interval_error_ms: (rng.next_f32() * 20.0) as f64,
                classification: class.to_string(),
                amplitude: 0.3 + rng.next_f32() * 0.6,
                calibration_offset_ms: 0.0,
                calibration_confidence: 1.0,
                grid_correlation: (0.5 + rng.next_f32() * 0.5) as f64,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Layer 2 — raw-onset synthetic helpers (exercises matching pipeline).
//
// The matcher below is intentionally simple in D1 — closest-onset to
// beat, single classification window. D2/D3 will replace it with the
// adaptive, confidence-aware matcher. Until then this version gives
// future-phase code something stable to run against.
// ---------------------------------------------------------------------------

/// Default per-class matching thresholds (ms). Match the live classifier
/// in `timing.rs` so Layer-1 and Layer-2 helpers produce comparable
/// distributions on the same input.
///
/// `#[allow(dead_code)]` on each constant — these are consumed by the
/// `match_and_score` test apparatus below (and by future Phase 3d
/// 18-scenario validation tests) but not by the live runtime, so a
/// lib-only build flags them.
#[allow(dead_code)]
pub const PERFECT_MS: f64 = 10.0;
#[allow(dead_code)]
pub const GOOD_MS: f64 = 25.0;
#[allow(dead_code)]
pub const OK_MS: f64 = 50.0;
/// Hard cutoff — onsets beyond this are not matched to a beat.
#[allow(dead_code)]
pub const MISS_WINDOW_MS: f64 = 80.0;

/// Build `(onsets, expected_beats)` for `beats` perfect hits at `bpm`.
/// Each onset lands exactly on its beat. Centroid set to the profile's
/// onset-spectrum mid so D2 tuning has a realistic baseline.
#[allow(dead_code)]
pub fn generate_raw_onsets_perfect(
    beats: u32,
    bpm: u16,
    profile: &InstrumentProfile,
) -> (Vec<DetectedOnset>, Vec<ExpectedBeat>) {
    let beat_ms = 60_000.0 / bpm as f64;
    let centroid = profile_centroid_hint(profile);

    let expected: Vec<ExpectedBeat> = (0..beats)
        .map(|i| ExpectedBeat {
            index: i,
            timestamp_ms: (i as f64 * beat_ms).round() as u64,
            is_accent: i % 4 == 0,
            expected_bpm: bpm,
        })
        .collect();

    let onsets: Vec<DetectedOnset> = expected
        .iter()
        .map(|b| DetectedOnset {
            timestamp_ms: b.timestamp_ms,
            amplitude: 0.6,
            centroid,
            confidence: 1.0,
        })
        .collect();

    (onsets, expected)
}

/// Same as `generate_raw_onsets_perfect` but onsets are perturbed by a
/// Gaussian with std `jitter_std_ms`. Seeded for determinism.
#[allow(dead_code)]
pub fn generate_raw_onsets_jittered(
    beats: u32,
    bpm: u16,
    jitter_std_ms: f32,
    seed: u64,
    profile: &InstrumentProfile,
) -> (Vec<DetectedOnset>, Vec<ExpectedBeat>) {
    let (mut onsets, expected) = generate_raw_onsets_perfect(beats, bpm, profile);
    let mut rng = Xorshift64::new(seed);
    for o in onsets.iter_mut() {
        let jitter = rng.next_gauss() * jitter_std_ms;
        // Saturating-add to keep u64. Jitter rarely exceeds beat_ms so
        // the clamp is just defensive.
        let new_ts = (o.timestamp_ms as i64 + jitter.round() as i64).max(0) as u64;
        o.timestamp_ms = new_ts;
    }
    (onsets, expected)
}

/// Spurious-onset stream — Poisson-like uniformly distributed across
/// `duration_ms`. Used to test the matcher's rejection of off-beat
/// noise. Centroid varies randomly. Seeded.
#[allow(dead_code)]
pub fn generate_raw_onsets_random(
    duration_ms: u64,
    onset_rate_per_sec: f32,
    seed: u64,
) -> Vec<DetectedOnset> {
    let mut rng = Xorshift64::new(seed);
    let expected_count =
        ((duration_ms as f32 / 1000.0) * onset_rate_per_sec).round() as u32;
    let mut onsets: Vec<DetectedOnset> = (0..expected_count)
        .map(|_| DetectedOnset {
            timestamp_ms: (rng.next_f32() * duration_ms as f32) as u64,
            amplitude: 0.2 + rng.next_f32() * 0.6,
            centroid: 100.0 + rng.next_f32() * 4000.0,
            confidence: 0.4 + rng.next_f32() * 0.6,
        })
        .collect();
    onsets.sort_by_key(|o| o.timestamp_ms);
    onsets
}

/// Run the D1 reference matcher over raw onsets + expected beats and
/// produce both `MatchDecision`s (for the diagnostic log) and a
/// `SessionReport` (for scoring-formula iteration).
///
/// **NOTE:** This matcher is intentionally simple — closest onset per
/// beat within `MISS_WINDOW_MS`, one onset per beat (no chord cluster
/// collapsing yet). D2 replaces it with the adaptive matcher. D1's job
/// is to provide a stable baseline so the rest of the test apparatus
/// can be built.
#[allow(dead_code)]
pub fn match_and_score(
    onsets: &[DetectedOnset],
    expected: &[ExpectedBeat],
    _profile: &InstrumentProfile,
) -> (Vec<MatchDecision>, Vec<u32>, SessionReport) {
    let mut matched_onset_ids: std::collections::HashSet<u32> =
        std::collections::HashSet::new();
    let mut decisions: Vec<MatchDecision> = Vec::with_capacity(expected.len());
    let mut feedbacks: Vec<BeatFeedback> = Vec::with_capacity(expected.len());

    for beat in expected {
        // Find closest onset within ±MISS_WINDOW_MS that isn't already
        // claimed (the simple matcher is greedy, beat-order — fine for
        // D1, plan acknowledges D3 changes this).
        let mut best: Option<(usize, i64)> = None;
        for (i, o) in onsets.iter().enumerate() {
            if matched_onset_ids.contains(&(i as u32)) {
                continue;
            }
            let dev = o.timestamp_ms as i64 - beat.timestamp_ms as i64;
            if (dev.abs() as f64) > MISS_WINDOW_MS {
                continue;
            }
            match best {
                None => best = Some((i, dev)),
                Some((_, prev)) if dev.abs() < prev.abs() => best = Some((i, dev)),
                _ => {}
            }
        }

        let (classification, deviation_ms, onset_indices, amplitude, reason) = match best {
            Some((idx, dev)) => {
                matched_onset_ids.insert(idx as u32);
                let abs = (dev as f64).abs();
                let class = if abs < PERFECT_MS {
                    Classification::Perfect
                } else if abs < GOOD_MS {
                    Classification::Good
                } else if abs < OK_MS {
                    Classification::Ok
                } else {
                    // Inside window but outside Ok — counts as miss with
                    // the onset still acknowledged for diagnostic value.
                    Classification::Miss
                };
                let reason = if class == Classification::Miss {
                    MatchReason::OutsideWindow
                } else {
                    MatchReason::InsideWindow
                };
                (
                    class,
                    dev as i32,
                    vec![idx as u32],
                    onsets[idx].amplitude,
                    reason,
                )
            }
            None => (
                Classification::Miss,
                0,
                Vec::new(),
                0.0_f32,
                MatchReason::OutsideWindow,
            ),
        };

        decisions.push(MatchDecision {
            beat_index: beat.index,
            onset_indices: onset_indices.clone(),
            deviation_ms,
            classification,
            reason,
        });

        feedbacks.push(BeatFeedback {
            beat_index: beat.index,
            deviation_ms: deviation_ms as f64,
            interval_error_ms: 0.0,
            classification: classification.as_str().to_string(),
            amplitude,
            calibration_offset_ms: 0.0,
            calibration_confidence: 1.0,
            grid_correlation: 1.0,
        });
    }

    let spurious: Vec<u32> = (0..onsets.len() as u32)
        .filter(|i| !matched_onset_ids.contains(i))
        .collect();

    let report = score_feedbacks(&feedbacks);
    (decisions, spurious, report)
}

/// Wrapper that builds the full `SessionLog` from raw onsets + beats.
/// Convenience for D3 unit tests so they can assert on log shape too.
#[allow(dead_code)]
pub fn build_log_from_raw(
    bpm: u16,
    time_signature: u8,
    subdivision: u8,
    timestamp: u64,
    duration_ms: u64,
    instrument: Instrument,
    onsets: Vec<DetectedOnset>,
    expected: Vec<ExpectedBeat>,
    profile: &InstrumentProfile,
) -> SessionLog {
    let (matches, spurious, report) = match_and_score(&onsets, &expected, profile);
    SessionLog {
        bpm,
        time_signature,
        subdivision,
        timestamp,
        duration_ms,
        instrument,
        instrument_profile_version: INSTRUMENT_PROFILE_VERSION,
        expected_beats: expected,
        detected_onsets: onsets,
        matches,
        spurious_onsets: spurious,
        activity_transitions: Vec::new(),
        segments: Vec::new(),
        report,
    }
}

/// Per-session raw telemetry buffer. Populated by the live timing
/// analyzer (`TimingAnalyzer::analysis_loop`) so the D1 diagnostic log
/// can carry the full streams of detected onsets, expected beats,
/// match decisions, and spurious onsets — not just the aggregated
/// report.
///
/// History: D1 originally shipped these as empty `Vec`s (see the prior
/// comment on `build_log_from_session`) because no upstream stage
/// buffered them across a whole session. That left us unable to
/// diagnose "user played 90 16ths but only 60 onsets were detected"
/// scenarios — we had no record of what the detector saw vs. what the
/// matcher matched. Phase 2 (this struct) fixes that: the analyzer
/// pushes events into a shared buffer as they happen, and the buffer
/// is drained at `stop_evaluation` time.
///
/// All timestamps are wall-clock ms (Unix epoch) so the JSON is
/// human-readable without a clock-offset conversion. `expected_beats`
/// and `detected_onsets` are dense (every observation), `matches` is
/// one entry per processed beat, and `spurious_onset_indices` lists
/// indices into `detected_onsets` of onsets that never matched a beat
/// (matches the `SessionLog::spurious_onsets` schema).
///
/// Buffer cap (`TELEMETRY_BUFFER_CAP`) defends against pathological
/// long-running sessions: each stream is capped at 50,000 events
/// (~4 hours of dense 16th-note playing at 200 BPM). On cap we stop
/// pushing for that stream — we don't rotate, because rotation would
/// invalidate the indices in `matches` and `spurious_onset_indices`.
#[derive(Debug, Default, Clone)]
pub struct SessionTelemetry {
    pub expected_beats: Vec<ExpectedBeat>,
    pub detected_onsets: Vec<DetectedOnset>,
    pub matches: Vec<MatchDecision>,
    pub spurious_onset_indices: Vec<u32>,
}

/// Hard cap on each telemetry stream. Beyond this we stop pushing
/// rather than evict (eviction would invalidate `matches` /
/// `spurious_onset_indices` cross-references). 50k events ≈ 4h of
/// dense playing — well beyond any realistic single session.
pub const TELEMETRY_BUFFER_CAP: usize = 50_000;

impl SessionTelemetry {
    /// Append a detected onset. Returns its stable index for use in
    /// downstream `MatchDecision.onset_indices` / `spurious_onset_indices`.
    /// Returns `None` when the buffer is full (caller should still
    /// process the onset musically; we just stop telemetry-logging it).
    pub fn push_onset(&mut self, o: DetectedOnset) -> Option<u32> {
        if self.detected_onsets.len() >= TELEMETRY_BUFFER_CAP {
            return None;
        }
        let idx = self.detected_onsets.len() as u32;
        self.detected_onsets.push(o);
        Some(idx)
    }

    /// Append an expected beat tick.
    pub fn push_beat(&mut self, b: ExpectedBeat) {
        if self.expected_beats.len() >= TELEMETRY_BUFFER_CAP {
            return;
        }
        self.expected_beats.push(b);
    }

    /// Append a match decision (one per processed beat).
    pub fn push_match(&mut self, m: MatchDecision) {
        if self.matches.len() >= TELEMETRY_BUFFER_CAP {
            return;
        }
        self.matches.push(m);
    }

    /// Mark an onset index as spurious (no beat matched it within the
    /// pending-cutoff window).
    pub fn push_spurious(&mut self, onset_idx: u32) {
        if self.spurious_onset_indices.len() >= TELEMETRY_BUFFER_CAP {
            return;
        }
        self.spurious_onset_indices.push(onset_idx);
    }
}

/// Build a `SessionLog` from accumulator state (final report + any
/// Signal-B segments) plus the AppState snapshot taken at stop time.
///
/// `telemetry` carries the per-session raw streams populated by the
/// live timing analyzer (see `SessionTelemetry`). Pass
/// `SessionTelemetry::default()` for code paths that don't run the
/// live analyzer (synthetic tests, fixture sessions).
pub fn build_log_from_session(
    bpm: u16,
    time_signature: u8,
    subdivision: u8,
    timestamp_secs: u64,
    duration_ms: u64,
    instrument: Instrument,
    feedbacks: &[BeatFeedback],
    segments: Vec<PracticeSegment>,
    telemetry: SessionTelemetry,
) -> SessionLog {
    let report = score_feedbacks(feedbacks);
    SessionLog {
        bpm,
        time_signature,
        subdivision,
        timestamp: timestamp_secs,
        duration_ms,
        instrument,
        instrument_profile_version: INSTRUMENT_PROFILE_VERSION,
        expected_beats: telemetry.expected_beats,
        detected_onsets: telemetry.detected_onsets,
        matches: telemetry.matches,
        spurious_onsets: telemetry.spurious_onset_indices,
        activity_transitions: Vec::new(),
        segments,
        report,
    }
}

/// Best-guess centroid for a given instrument profile, used as a
/// synthetic-onset default. Picks the band index with the highest
/// weight; D2 may refine this once we have empirical centroid
/// distributions.
#[allow(dead_code)]
fn profile_centroid_hint(profile: &InstrumentProfile) -> f32 {
    let (band_idx, _) = profile
        .spectral_weights
        .iter()
        .enumerate()
        .fold((0usize, 0.0_f32), |(bi, bw), (i, &w)| {
            if w > bw { (i, w) } else { (bi, bw) }
        });
    // 16 bands across the audible spectrum (assume 22 kHz Nyquist).
    let band_hz = 22_000.0 / 16.0;
    (band_idx as f32 + 0.5) * band_hz
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "yames-session-log-test-{}-{}",
            name,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn xorshift_is_deterministic_given_seed() {
        let mut a = Xorshift64::new(42);
        let mut b = Xorshift64::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn xorshift_seed_zero_does_not_collapse() {
        // A naive xorshift implementation gets stuck at 0 forever if
        // seeded with 0. We promote to a non-zero constant — verify
        // that the stream evolves.
        let mut rng = Xorshift64::new(0);
        let first = rng.next_u64();
        let second = rng.next_u64();
        assert_ne!(first, 0);
        assert_ne!(first, second);
    }

    #[test]
    fn generate_perfect_beats_are_all_perfect() {
        let fbs = generate_perfect_beats(32, 120);
        assert_eq!(fbs.len(), 32);
        assert!(fbs.iter().all(|f| f.classification == "perfect"));
        assert!(fbs.iter().all(|f| f.deviation_ms == 0.0));
        let r = score_feedbacks(&fbs);
        assert_eq!(r.grade, "S");
    }

    #[test]
    fn generate_random_beats_is_seed_reproducible() {
        let a = generate_random_beats(64, 100, 0.8, 7);
        let b = generate_random_beats(64, 100, 0.8, 7);
        assert_eq!(a.len(), b.len());
        for (x, y) in a.iter().zip(b.iter()) {
            assert_eq!(x.classification, y.classification);
            assert!((x.deviation_ms - y.deviation_ms).abs() < 1e-9);
        }
    }

    #[test]
    fn raw_onsets_perfect_score_S() {
        let profile = Instrument::ElectricGuitar.profile();
        let (onsets, expected) = generate_raw_onsets_perfect(64, 120, &profile);
        let (decisions, spurious, report) = match_and_score(&onsets, &expected, &profile);
        assert_eq!(decisions.len(), 64);
        assert!(spurious.is_empty());
        assert!(
            decisions
                .iter()
                .all(|d| d.classification == Classification::Perfect),
            "expected all perfect"
        );
        assert_eq!(report.grade, "S");
    }

    #[test]
    fn raw_onsets_jittered_degrades_score_smoothly() {
        let profile = Instrument::ElectricGuitar.profile();
        let (o0, e0) = generate_raw_onsets_jittered(64, 120, 0.0, 1, &profile);
        let (o20, e20) = generate_raw_onsets_jittered(64, 120, 20.0, 1, &profile);
        let (o60, e60) = generate_raw_onsets_jittered(64, 120, 60.0, 1, &profile);

        let r0 = match_and_score(&o0, &e0, &profile).2;
        let r20 = match_and_score(&o20, &e20, &profile).2;
        let r60 = match_and_score(&o60, &e60, &profile).2;

        assert!(
            r0.score >= r20.score,
            "0ms jitter ({}) should score ≥ 20ms jitter ({})",
            r0.score,
            r20.score
        );
        assert!(
            r20.score >= r60.score,
            "20ms jitter ({}) should score ≥ 60ms jitter ({})",
            r20.score,
            r60.score
        );
    }

    #[test]
    fn raw_onsets_random_are_spurious() {
        let profile = Instrument::Other.profile();
        // No expected beats — everything is spurious by definition.
        let onsets = generate_raw_onsets_random(10_000, 5.0, 99);
        let (_, spurious, _) = match_and_score(&onsets, &[], &profile);
        assert_eq!(spurious.len(), onsets.len());
    }

    #[test]
    fn save_and_load_log_roundtrip() {
        let tmp = tmp_dir("roundtrip");
        let profile = Instrument::AcousticGuitar.profile();
        let (onsets, expected) = generate_raw_onsets_perfect(8, 120, &profile);
        let log = build_log_from_raw(
            120,
            4,
            1,
            1_700_000_000,
            4_000,
            Instrument::AcousticGuitar,
            onsets,
            expected,
            &profile,
        );

        let path = save_log(&tmp, &log).expect("save_log");
        assert!(path.exists());
        let loaded = load_log(&path).expect("load_log");
        assert_eq!(loaded.bpm, log.bpm);
        assert_eq!(loaded.instrument, log.instrument);
        assert_eq!(loaded.expected_beats.len(), log.expected_beats.len());
        assert_eq!(loaded.matches.len(), log.matches.len());
        assert_eq!(loaded.report.grade, log.report.grade);
        // Profile version is persisted for migration.
        assert_eq!(
            loaded.instrument_profile_version,
            INSTRUMENT_PROFILE_VERSION
        );
    }

    #[test]
    fn save_log_prunes_to_max() {
        let tmp = tmp_dir("prune");
        let profile = Instrument::Drums.profile();

        // Save MAX + 5 logs.
        for i in 0..(MAX_SESSION_LOGS + 5) {
            let (onsets, expected) = generate_raw_onsets_perfect(4, 100, &profile);
            let log = build_log_from_raw(
                100,
                4,
                1,
                1_700_000_000 + i as u64,
                1000,
                Instrument::Drums,
                onsets,
                expected,
                &profile,
            );
            save_log(&tmp, &log).expect("save_log");
            // Ensure unique filenames even on fast machines.
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        let paths = list_log_paths(&tmp).expect("list");
        assert_eq!(
            paths.len(),
            MAX_SESSION_LOGS,
            "expected exactly {} logs after prune, got {}",
            MAX_SESSION_LOGS,
            paths.len()
        );
    }

    #[test]
    fn export_writes_combined_json() {
        let tmp = tmp_dir("export");
        let profile = Instrument::Bass.profile();
        for i in 0..3 {
            let (onsets, expected) = generate_raw_onsets_perfect(4, 100, &profile);
            let log = build_log_from_raw(
                100,
                4,
                1,
                1_700_000_000 + i,
                1000,
                Instrument::Bass,
                onsets,
                expected,
                &profile,
            );
            save_log(&tmp, &log).expect("save_log");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let dest = tmp.join("export.json");
        let n = export_logs(&tmp, &dest).expect("export");
        assert_eq!(n, 3);
        let raw = fs::read_to_string(&dest).expect("read export");
        let parsed: Vec<SessionLog> = serde_json::from_str(&raw).expect("parse export");
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn classification_roundtrip_via_string() {
        for c in [
            Classification::Perfect,
            Classification::Good,
            Classification::Ok,
            Classification::Miss,
            Classification::Skipped,
        ] {
            assert_eq!(Classification::from_str(c.as_str()), c);
        }
    }

    #[test]
    fn match_decision_assigns_correct_class() {
        let profile = Instrument::ElectricGuitar.profile();
        let expected = vec![ExpectedBeat {
            index: 0,
            timestamp_ms: 1000,
            is_accent: true,
            expected_bpm: 120,
        }];
        // Onset 5ms early → Perfect.
        let onsets = vec![DetectedOnset {
            timestamp_ms: 995,
            amplitude: 0.5,
            centroid: 500.0,
            confidence: 1.0,
        }];
        let (decisions, _, _) = match_and_score(&onsets, &expected, &profile);
        assert_eq!(decisions[0].classification, Classification::Perfect);
        assert_eq!(decisions[0].deviation_ms, -5);
    }

    /// `build_log_from_session` is the production code path used at
    /// `stop_evaluation`. Verify it produces a roundtrippable, schema-
    /// compatible log even when raw onsets/expected beats are not
    /// captured (the synthetic-test path passes a default empty
    /// `SessionTelemetry`; the live analyzer populates it for real
    /// sessions).
    #[test]
    fn build_log_from_session_minimal_roundtrips() {
        let feedbacks = generate_perfect_beats(8, 120);
        let segments = vec![PracticeSegment {
            start_ms: 1_000,
            end_ms: 31_000,
            start_bpm: 120,
            end_bpm: 120,
            score: 92.0,
            component_scores: ComponentScores {
                interval_consistency: 0.95,
                grid_alignment: 0.92,
                hit_completeness: 0.90,
                onset_efficiency: 0.88,
            },
            end_reason: SegmentEndReason::ActivityGap,
            // Path B — fixture data, divisor inference not exercised
            // by this test. Sentinel 0 / 0.0 matches the default that
            // historic logs deserialize with.
            inferred_divisor: 0,
            inferred_divisor_confidence: 0.0,
        }];
        let log = build_log_from_session(
            120,
            4,
            1,
            1_700_000_000,
            45_000,
            Instrument::ElectricGuitar,
            &feedbacks,
            segments.clone(),
            SessionTelemetry::default(),
        );

        // Headline fields propagate.
        assert_eq!(log.bpm, 120);
        assert_eq!(log.time_signature, 4);
        assert_eq!(log.subdivision, 1);
        assert_eq!(log.timestamp, 1_700_000_000);
        assert_eq!(log.duration_ms, 45_000);
        assert_eq!(log.instrument, Instrument::ElectricGuitar);
        assert_eq!(log.instrument_profile_version, INSTRUMENT_PROFILE_VERSION);

        // Report is built from feedbacks — perfect hits → S grade.
        assert_eq!(log.report.hits_count, 8);
        assert_eq!(log.report.grade, "S");

        // Segments roundtripped without mutation.
        assert_eq!(log.segments.len(), 1);
        assert_eq!(log.segments[0].score, 92.0);
        assert_eq!(log.segments[0].end_reason, SegmentEndReason::ActivityGap);

        // Raw-data fields stay empty (D1 ships persistence path only).
        assert!(log.expected_beats.is_empty());
        assert!(log.detected_onsets.is_empty());
        assert!(log.matches.is_empty());
        assert!(log.spurious_onsets.is_empty());
        assert!(log.activity_transitions.is_empty());

        // JSON roundtrip — schema must stay stable.
        let json = serde_json::to_string(&log).expect("serialize");
        let parsed: SessionLog = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.report.score, log.report.score);
        assert_eq!(parsed.segments.len(), 1);
    }

    /// Save-roundtrip integration: build a log via the production helper,
    /// persist it via `save_log`, list it back, and verify the file lands
    /// on disk with the expected report grade.
    #[test]
    fn build_log_from_session_persists_to_disk() {
        let dir = tmp_dir("build_session_persist");
        let feedbacks = generate_perfect_beats(16, 100);
        let log = build_log_from_session(
            100,
            4,
            1,
            1_700_000_000,
            60_000,
            Instrument::Drums,
            &feedbacks,
            Vec::new(),
            SessionTelemetry::default(),
        );
        let path = save_log(&dir, &log).expect("save log");
        assert!(path.exists(), "log file should exist on disk");

        let listed = list_log_paths(&dir).expect("list logs");
        assert_eq!(listed.len(), 1);

        let loaded = load_log(&listed[0]).expect("load log");
        assert_eq!(loaded.bpm, 100);
        assert_eq!(loaded.report.grade, "S");
        assert_eq!(loaded.instrument, Instrument::Drums);
    }

    /// Empty-feedback edge case: the log builder must still produce a
    /// valid, serializable log when no beats were captured (early stop).
    #[test]
    fn build_log_from_session_handles_empty_feedbacks() {
        let log = build_log_from_session(
            120,
            4,
            1,
            1_700_000_000,
            0,
            Instrument::Piano,
            &[],
            Vec::new(),
            SessionTelemetry::default(),
        );
        // Empty report grade should be F (consistent with SessionAccumulator).
        assert_eq!(log.report.grade, "F");
        assert_eq!(log.report.total_beats, 0);
        // Still JSON-serializable.
        let json = serde_json::to_string(&log).expect("serialize empty log");
        assert!(json.contains("\"grade\":\"F\""));
    }
}
