//! Layer-2 raw-onset regression fixtures for the high-BPM range (80–180 BPM).
//!
//! Exercises the full `match_and_score` pipeline (onset → beat matching →
//! `SessionReport`) with electric-guitar profile across 9 synthetic fixture
//! inputs. This sits one layer deeper than `dsp_fixtures`, which starts from
//! already-matched `BeatFeedback` values.
//!
//! Adding a fixture
//! ----------------
//! 1. Add a new `<name>.input.json` in `tests/highbpm_fixtures/` with the
//!    shape produced by `cargo run --bin seed-highbpm-fixtures` (or hand-craft
//!    one following the schema in `src/bin/seed-highbpm-fixtures.rs`).
//! 2. Run `UPDATE_FIXTURES=1 cargo test --test highbpm_fixtures` once. The
//!    harness writes `<name>.golden.json` containing the serialized
//!    `SessionReport`. Commit both files.
//! 3. Subsequent runs compare actual vs golden and fail on any drift.
//!
//! Accepting an intentional scoring change
//! ----------------------------------------
//! Re-run with `UPDATE_FIXTURES=1` and review the diff. The diff is the
//! audit trail for any matcher or scoring formula change.

use std::fs;
use std::path::{Path, PathBuf};

use yames_lib::instrument::Instrument;
use yames_lib::session::SessionReport;
use yames_lib::session_log::{match_and_score, DetectedOnset, ExpectedBeat};

/// On-disk shape of `tests/highbpm_fixtures/<name>.input.json`.
/// Must stay in sync with `FixtureInput` in `src/bin/seed-highbpm-fixtures.rs`.
#[derive(serde::Deserialize)]
struct FixtureInput {
    name: String,
    #[allow(dead_code)]
    description: String,
    #[allow(dead_code)]
    bpm: u16,
    #[allow(dead_code)]
    beats: u32,
    onsets: Vec<DetectedOnset>,
    expected: Vec<ExpectedBeat>,
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("highbpm_fixtures")
}

fn collect_input_files() -> Vec<PathBuf> {
    let dir = fixtures_dir();
    let mut out = Vec::new();
    if !dir.exists() {
        return out;
    }
    for entry in fs::read_dir(&dir).expect("read highbpm_fixtures dir") {
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

    let profile = Instrument::ElectricGuitar.profile();
    let mut failures = Vec::new();

    for input_path in &inputs {
        let raw = fs::read_to_string(input_path)
            .unwrap_or_else(|e| panic!("read {}: {e}", input_path.display()));
        let fixture: FixtureInput = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("parse {}: {e}", input_path.display()));

        let (_, _, actual) = match_and_score(&fixture.onsets, &fixture.expected, &profile);
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
                "fixture {} ({}): no golden file at {} — run \
                 `UPDATE_FIXTURES=1 cargo test --test highbpm_fixtures` to create it",
                fixture.name,
                input_path.display(),
                golden_file.display(),
            ));
            continue;
        }

        let golden_raw = fs::read_to_string(&golden_file)
            .unwrap_or_else(|e| panic!("read {}: {e}", golden_file.display()));

        // Parse both sides so we catch deserialization errors early, then
        // compare via re-serialized pretty JSON. This gives byte-identical
        // comparison (the acceptance criterion) while tolerating whitespace
        // differences between how the golden was written and how the current
        // serde_json serializes.
        let golden: SessionReport = serde_json::from_str(&golden_raw)
            .unwrap_or_else(|e| panic!("parse {}: {e}", golden_file.display()));

        let actual_json = serde_json::to_string_pretty(&actual)
            .expect("serialize actual SessionReport");
        let golden_json = serde_json::to_string_pretty(&golden)
            .expect("serialize golden SessionReport");

        if actual_json != golden_json {
            failures.push(format!(
                "[{}] SessionReport drifted.\n  actual:\n{}\n  golden:\n{}",
                fixture.name, actual_json, golden_json,
            ));
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
        "Layer-2 raw-onset regression(s):\n  - {}",
        failures.join("\n  - "),
    );
}
