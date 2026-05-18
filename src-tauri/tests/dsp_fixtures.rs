//! DSP scoring regression fixtures.
//!
//! The fixture suite captures `Vec<BeatFeedback>` inputs and their
//! resulting `SessionReport` (the "golden" output) for the post-match
//! scoring pipeline. On each run we replay every input through
//! `score_feedbacks()` and assert the output is byte-identical (within
//! a tight epsilon for f64 fields) to the recorded golden.
//!
//! This is the cheap-feedback-loop tier of DSP iteration that the
//! consolidated plan calls for. The matrix tests in `timing.rs` cover
//! synthetic clean signals; D1 session logs cover end-to-end DSP
//! including onset detection. Fixtures cover the middle layer:
//! "given these per-beat decisions, did the score formula change?"
//!
//! Adding a fixture
//! ----------------
//! 1. Create an `<name>.input.json` file in `tests/dsp_fixtures/` with
//!    shape `{ "name": "...", "description": "...", "feedbacks": [...] }`
//!    where each feedback is the JSON shape that `BeatFeedback`
//!    serializes to (camelCase field names).
//! 2. Run `UPDATE_FIXTURES=1 cargo test --test dsp_fixtures` once. The
//!    harness will write `<name>.golden.json` next to your input file
//!    using the CURRENT scoring output. Commit both files.
//! 3. Subsequent test runs compare actual vs golden and fail on drift.
//!
//! Accepting an intentional scoring change
//! ---------------------------------------
//! Re-run with `UPDATE_FIXTURES=1` and review the diff against the
//! committed golden files. If the new numbers are correct, commit the
//! updated goldens. The diff IS the audit trail for any scoring
//! formula tweak.

use std::fs;
use std::path::{Path, PathBuf};

use yames_lib::session::SessionReport;
use yames_lib::session_log::score_feedbacks;
use yames_lib::timing::BeatFeedback;

/// On-disk fixture format. `expected` is optional so an `.input.json`
/// can be authored standalone — the harness pairs it with a
/// `.golden.json` sibling for the SessionReport baseline.
#[derive(serde::Serialize, serde::Deserialize)]
struct FixtureInput {
    name: String,
    description: String,
    feedbacks: Vec<BeatFeedback>,
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("dsp_fixtures")
}

fn collect_input_files() -> Vec<PathBuf> {
    let dir = fixtures_dir();
    let mut out = Vec::new();
    if !dir.exists() {
        return out;
    }
    for entry in fs::read_dir(&dir).expect("read fixtures dir") {
        let entry = entry.expect("read dir entry");
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.ends_with(".input.json") {
            out.push(path);
        }
    }
    // Stable ordering so test output is grep-able across runs.
    out.sort();
    out
}

fn golden_path(input_path: &Path) -> PathBuf {
    let stem = input_path
        .file_name()
        .and_then(|n| n.to_str())
        .expect("input filename")
        .trim_end_matches(".input.json");
    input_path.with_file_name(format!("{stem}.golden.json"))
}

/// f64 comparison tolerance. Scoring math is deterministic on the same
/// inputs, but we still leave a 1e-9 epsilon so JSON round-tripping
/// (which truncates trailing zeros) doesn't flake the suite.
const F64_EPS: f64 = 1e-9;

fn approx_eq_f64(a: f64, b: f64) -> bool {
    if a.is_nan() || b.is_nan() {
        // Both NaN should compare equal in this context; otherwise fail.
        return a.is_nan() && b.is_nan();
    }
    (a - b).abs() <= F64_EPS
}

fn assert_reports_equivalent(actual: &SessionReport, golden: &SessionReport, fixture_name: &str) {
    macro_rules! check_eq {
        ($field:ident) => {
            assert_eq!(
                actual.$field, golden.$field,
                "fixture {fixture_name}: field `{}` drifted (actual={:?}, golden={:?})",
                stringify!($field),
                actual.$field,
                golden.$field,
            );
        };
    }
    macro_rules! check_f64 {
        ($field:ident) => {
            assert!(
                approx_eq_f64(actual.$field, golden.$field),
                "fixture {fixture_name}: field `{}` drifted (actual={}, golden={}, tolerance={F64_EPS})",
                stringify!($field),
                actual.$field,
                golden.$field,
            );
        };
    }

    check_eq!(total_beats);
    check_eq!(hits_count);
    check_eq!(miss_count);
    check_eq!(skipped_beats);
    check_eq!(perfect_count);
    check_eq!(good_count);
    check_eq!(ok_count);
    check_eq!(grade);
    check_eq!(score);
    check_eq!(longest_streak);
    check_eq!(comment);
    check_eq!(insights);

    check_f64!(mean_deviation_ms);
    check_f64!(std_deviation_ms);
    check_f64!(mean_abs_deviation_ms);
    check_f64!(mean_interval_error_ms);
    check_f64!(dynamics_std);
    check_f64!(mean_amplitude);
    check_f64!(tempo_stability_ms);
    check_f64!(grid_correlation);

    assert_eq!(
        actual.deviations.len(),
        golden.deviations.len(),
        "fixture {fixture_name}: `deviations` length drifted",
    );
    for (i, (a, g)) in actual
        .deviations
        .iter()
        .zip(golden.deviations.iter())
        .enumerate()
    {
        assert!(
            approx_eq_f64(*a, *g),
            "fixture {fixture_name}: deviations[{i}] drifted (actual={a}, golden={g})",
        );
    }
}

#[test]
fn all_fixtures_replay_stably() {
    let inputs = collect_input_files();
    assert!(
        !inputs.is_empty(),
        "No fixtures found in {}",
        fixtures_dir().display(),
    );

    let update_mode = std::env::var("UPDATE_FIXTURES")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let mut failures = Vec::new();

    for input_path in &inputs {
        let raw = fs::read_to_string(input_path)
            .unwrap_or_else(|e| panic!("read {}: {e}", input_path.display()));
        let fixture: FixtureInput = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("parse {}: {e}", input_path.display()));

        let actual = score_feedbacks(&fixture.feedbacks);
        let golden_file = golden_path(input_path);

        if update_mode {
            let pretty = serde_json::to_string_pretty(&actual)
                .expect("serialize SessionReport");
            fs::write(&golden_file, format!("{pretty}\n"))
                .unwrap_or_else(|e| panic!("write {}: {e}", golden_file.display()));
            eprintln!(
                "  UPDATED {}  ({})",
                golden_file
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("<?>"),
                fixture.name,
            );
            continue;
        }

        if !golden_file.exists() {
            failures.push(format!(
                "fixture {} ({}): no golden file at {} — run `UPDATE_FIXTURES=1 cargo test --test dsp_fixtures` to create it",
                fixture.name,
                input_path.display(),
                golden_file.display(),
            ));
            continue;
        }

        let golden_raw = fs::read_to_string(&golden_file)
            .unwrap_or_else(|e| panic!("read {}: {e}", golden_file.display()));
        let golden: SessionReport = serde_json::from_str(&golden_raw)
            .unwrap_or_else(|e| panic!("parse {}: {e}", golden_file.display()));

        // Capture per-fixture failures into a single test failure so
        // the report names every regression at once instead of stopping
        // at the first.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_reports_equivalent(&actual, &golden, &fixture.name);
        }));
        if let Err(payload) = result {
            let msg = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&'static str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "<non-string panic>".to_string());
            failures.push(format!("[{}] {}", fixture.name, msg));
        }
    }

    if update_mode {
        eprintln!(
            "UPDATE_FIXTURES=1 — wrote {} golden file(s). Review the diff before committing.",
            inputs.len(),
        );
        return;
    }

    assert!(
        failures.is_empty(),
        "DSP scoring regression(s):\n  - {}",
        failures.join("\n  - "),
    );
}
