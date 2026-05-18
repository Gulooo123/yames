//! Convert a captured `SessionLog` JSON file into a `dsp_fixtures`
//! `<name>.input.json` so real-world sessions become regression
//! fixtures with one command.
//!
//! Usage:
//!   cargo run --bin dump-fixture -- <session-log.json> [fixture-name]
//!
//!   <session-log.json>  path to a SessionLog JSON (typically under
//!                       `~/Library/Application Support/<bundle>/
//!                       session_logs/` on macOS, or anywhere `export_logs`
//!                       wrote one).
//!   [fixture-name]      optional fixture stem; defaults to the input
//!                       file's stem (minus any `.json`). The output goes
//!                       to `src-tauri/tests/dsp_fixtures/<stem>.input.json`.
//!
//! After running, follow the README in `tests/dsp_fixtures/`:
//!   1. UPDATE_FIXTURES=1 cargo test --test dsp_fixtures
//!   2. Inspect & commit `<stem>.input.json` + `<stem>.golden.json`.
//!
//! Why a binary and not a `#[test]` helper?
//! ----------------------------------------
//! The fixture suite is intentionally hermetic — its inputs live in the
//! tree, no I/O at test time. Capturing a real session means reaching
//! INTO the user's app data dir, which is a one-shot author flow, not a
//! test-time concern. Keeping it as a separate `cargo run --bin` makes
//! that distinction explicit and keeps the test binary lean.
//!
//! Conversion notes (lossy, by design):
//!   * `BeatFeedback::interval_error_ms` isn't recorded by the live
//!     pipeline, so it's defaulted to `0.0`. That's fine because the
//!     scoring formula doesn't currently consume it — the field is
//!     reserved for future jitter-aware grading.
//!   * `BeatFeedback::amplitude` is pulled from the matched onset
//!     (first entry of `onset_indices`) when present; misses get `0.0`
//!     to mirror the legacy semantics in `timing.rs`.
//!   * `calibration_*` and `grid_correlation` aren't on the session log,
//!     so we use the neutral defaults the existing fixtures use
//!     (`offset = 0.0`, `confidence = 1.0`, `gridCorrelation = 1.0`).
//!     Any future formula that consumes those will need a session-log
//!     upgrade to capture them — not the fixture binary's problem.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use yames_lib::session_log::{load_log, Classification, DetectedOnset, MatchDecision, SessionLog};
use yames_lib::timing::BeatFeedback;

/// On-disk shape for `tests/dsp_fixtures/<name>.input.json`. Kept in
/// sync (manually) with the private `FixtureInput` struct in
/// `tests/dsp_fixtures.rs`. If the test's shape changes, this binary's
/// `cargo run --bin dump-fixture` output stops loading — the fixture
/// suite is the source of truth and you get a loud test failure rather
/// than a silent drift.
#[derive(serde::Serialize)]
struct FixtureInput<'a> {
    name: &'a str,
    description: String,
    feedbacks: Vec<BeatFeedback>,
}

fn print_usage() {
    eprintln!(
        "usage: cargo run --bin dump-fixture -- <session-log.json> [fixture-stem]\n\
         \n\
         Converts a captured SessionLog into a dsp_fixtures input file.\n\
         After running, follow tests/dsp_fixtures/README.md to bake the\n\
         matching golden output."
    );
}

fn fixtures_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR is the crate dir during `cargo run`. The
    // fixtures live one level down inside `tests/dsp_fixtures/`.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("dsp_fixtures")
}

fn stem_for(path: &Path, override_name: Option<&str>) -> String {
    if let Some(name) = override_name {
        // Strip trailing `.input.json` / `.json` if the caller supplied
        // a filename instead of a bare stem — common slip in shell args.
        let trimmed = name
            .strip_suffix(".input.json")
            .or_else(|| name.strip_suffix(".json"))
            .unwrap_or(name);
        return trimmed.to_string();
    }
    // Session logs are typically named like `1715800000-130bpm.json`
    // — use the stem unchanged. Strip the `.json` if the OS-level stem
    // didn't pick it up (which it shouldn't, but defensive).
    let raw = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("captured_session")
        .to_string();
    raw.strip_suffix(".input").unwrap_or(&raw).to_string()
}

/// Convert one `MatchDecision` + its source `DetectedOnset` slice into
/// the `BeatFeedback` shape that the fixture suite replays. The
/// `intervalErrorMs` is not present in the log so we use `0.0`. The
/// amplitude comes from the best-match onset when there is one — i.e.
/// the first entry of `onset_indices` — and from `0.0` on misses, to
/// mirror what `timing.rs::record_beat` produces in production.
fn to_feedback(decision: &MatchDecision, onsets: &[DetectedOnset]) -> BeatFeedback {
    let amplitude = decision
        .onset_indices
        .first()
        .and_then(|idx| onsets.get(*idx as usize))
        .map(|o| o.amplitude)
        .unwrap_or(0.0);

    BeatFeedback {
        beat_index: decision.beat_index,
        deviation_ms: decision.deviation_ms as f64,
        // The live pipeline doesn't persist this; defaulting to 0.0 is
        // safe because `score_feedbacks` doesn't currently read it. If
        // a future formula starts consuming `interval_error_ms`, fix
        // the session-log capture, not this conversion.
        interval_error_ms: 0.0,
        classification: decision.classification.as_str().to_string(),
        amplitude,
        // Calibration + grid fields aren't on the session log either.
        // The seeded fixtures use these "neutral" defaults so the new
        // captured fixtures stay shape-compatible.
        calibration_offset_ms: 0.0,
        calibration_confidence: 1.0,
        grid_correlation: 1.0,
    }
}

fn build_description(log: &SessionLog, stem: &str) -> String {
    // Quick, scannable description so somebody opening the fixture in a
    // year can tell at a glance what they're looking at. The detailed
    // metrics live in the golden; this is the "what was the session"
    // header.
    format!(
        "Captured session: {} at {} BPM, {}/{} ({}s, {} beats, {} hits, {} miss, score {}). \
         Generated by `cargo run --bin dump-fixture`.",
        stem,
        log.bpm,
        log.time_signature,
        log.subdivision,
        (log.duration_ms / 1000),
        log.expected_beats.len(),
        log.report.hits_count,
        log.report.miss_count,
        log.report.score,
    )
}

fn run(input: &Path, override_stem: Option<&str>) -> Result<PathBuf, String> {
    let log = load_log(input).map_err(|e| format!("load session log: {e}"))?;

    if log.matches.is_empty() {
        return Err(
            "session log has zero MatchDecisions — nothing to convert. \
             Was the session ended before any onsets were scored?"
                .into(),
        );
    }
    if matches!(
        log.matches.first().map(|m| &m.classification),
        Some(Classification::Skipped),
    ) && log.matches.iter().all(|m| matches!(m.classification, Classification::Skipped))
    {
        // Refuse all-skipped logs — they'd produce a trivial fixture
        // that doesn't exercise the score formula and would just sit in
        // the suite as noise.
        return Err(
            "every MatchDecision in this log is `Skipped` — refusing to write \
             a fixture that wouldn't exercise the scoring path."
                .into(),
        );
    }

    let feedbacks: Vec<BeatFeedback> = log
        .matches
        .iter()
        .map(|m| to_feedback(m, &log.detected_onsets))
        .collect();

    let stem = stem_for(input, override_stem);
    let description = build_description(&log, &stem);

    let payload = FixtureInput {
        name: &stem,
        description,
        feedbacks,
    };

    let dir = fixtures_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create fixtures dir: {e}"))?;
    let dest = dir.join(format!("{stem}.input.json"));

    // serde_json::to_string_pretty matches the formatting of the
    // hand-authored fixtures; the only nit is that arrays of structs
    // each get their own line, which is exactly what we want for diff
    // legibility on subsequent updates.
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("serialize fixture: {e}"))?;
    fs::write(&dest, format!("{json}\n")).map_err(|e| format!("write fixture: {e}"))?;

    Ok(dest)
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        return ExitCode::from(2);
    }
    let input = PathBuf::from(&args[1]);
    let override_stem = args.get(2).map(String::as_str);

    match run(&input, override_stem) {
        Ok(path) => {
            println!("wrote {}", path.display());
            println!(
                "next: UPDATE_FIXTURES=1 cargo test --test dsp_fixtures to bake the golden, \
                 then commit both files."
            );
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("dump-fixture: {e}");
            ExitCode::FAILURE
        }
    }
}
