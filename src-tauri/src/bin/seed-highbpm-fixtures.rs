//! Write all 9 Layer-2 raw-onset fixture inputs for the `highbpm_fixtures`
//! test suite.
//!
//! Usage:
//!   cargo run --bin seed-highbpm-fixtures
//!
//! Outputs to `src-tauri/tests/highbpm_fixtures/`. After running, bake
//! the goldens with:
//!   UPDATE_FIXTURES=1 cargo test --test highbpm_fixtures
//! then commit both the `.input.json` and `.golden.json` files.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use yames_lib::instrument::Instrument;
use yames_lib::session_log::{
    generate_raw_onsets_jittered, generate_raw_onsets_perfect, DetectedOnset, ExpectedBeat,
};

/// On-disk shape for `tests/highbpm_fixtures/<name>.input.json`.
#[derive(serde::Serialize)]
struct FixtureInput {
    name: String,
    description: String,
    bpm: u16,
    beats: u32,
    onsets: Vec<DetectedOnset>,
    expected: Vec<ExpectedBeat>,
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("highbpm_fixtures")
}

struct FixtureSpec {
    name: &'static str,
    description: &'static str,
    bpm: u16,
    beats: u32,
    kind: FixtureKind,
}

enum FixtureKind {
    Perfect,
    Jittered { jitter_std_ms: f32, seed: u64 },
    ChordStrum,
}

fn build_fixtures() -> Vec<FixtureSpec> {
    vec![
        FixtureSpec {
            name: "80bpm_16ths_perfect",
            description: "80 BPM 16th-note grid, 64 beats, electric guitar, zero jitter. \
                          Baseline: all onsets land exactly on the expected beat timestamp.",
            bpm: 80,
            beats: 64,
            kind: FixtureKind::Perfect,
        },
        FixtureSpec {
            name: "100bpm_16ths_perfect",
            description: "100 BPM 16th-note grid, 64 beats, electric guitar, zero jitter.",
            bpm: 100,
            beats: 64,
            kind: FixtureKind::Perfect,
        },
        FixtureSpec {
            name: "120bpm_16ths_perfect",
            description: "120 BPM 16th-note grid, 64 beats, electric guitar, zero jitter.",
            bpm: 120,
            beats: 64,
            kind: FixtureKind::Perfect,
        },
        FixtureSpec {
            name: "140bpm_16ths_perfect",
            description: "140 BPM 16th-note grid, 64 beats, electric guitar, zero jitter.",
            bpm: 140,
            beats: 64,
            kind: FixtureKind::Perfect,
        },
        FixtureSpec {
            name: "160bpm_16ths_perfect",
            description: "160 BPM 16th-note grid, 64 beats, electric guitar, zero jitter. \
                          Synthetic high-tempo case.",
            bpm: 160,
            beats: 64,
            kind: FixtureKind::Perfect,
        },
        FixtureSpec {
            name: "180bpm_16ths_perfect",
            description: "180 BPM 16th-note grid, 64 beats, electric guitar, zero jitter. \
                          Synthetic high-tempo case.",
            bpm: 180,
            beats: 64,
            kind: FixtureKind::Perfect,
        },
        FixtureSpec {
            name: "120bpm_16ths_jittered_5ms",
            description: "120 BPM 16th-note grid, 64 beats, electric guitar, Gaussian jitter \
                          σ=5ms (seed=0xC005). Mild human-like timing variation.",
            bpm: 120,
            beats: 64,
            kind: FixtureKind::Jittered {
                jitter_std_ms: 5.0,
                seed: 0xC005,
            },
        },
        FixtureSpec {
            name: "140bpm_16ths_jittered_10ms",
            description: "140 BPM 16th-note grid, 64 beats, electric guitar, Gaussian jitter \
                          σ=10ms (seed=0xE010). Moderate timing variation.",
            bpm: 140,
            beats: 64,
            kind: FixtureKind::Jittered {
                jitter_std_ms: 10.0,
                seed: 0xE010,
            },
        },
        FixtureSpec {
            name: "120bpm_16ths_chord_strum",
            description: "120 BPM 16th-note grid, 64 beats, electric guitar. Each beat has two \
                          onsets: one on the beat timestamp and one 15ms later, simulating a \
                          two-string chord strum. 128 total onsets, 64 expected beats.",
            bpm: 120,
            beats: 64,
            kind: FixtureKind::ChordStrum,
        },
    ]
}

fn make_onsets_and_expected(
    spec: &FixtureSpec,
    profile: &yames_lib::instrument::InstrumentProfile,
) -> (Vec<DetectedOnset>, Vec<ExpectedBeat>) {
    match &spec.kind {
        FixtureKind::Perfect => generate_raw_onsets_perfect(spec.beats, spec.bpm, profile),
        FixtureKind::Jittered {
            jitter_std_ms,
            seed,
        } => generate_raw_onsets_jittered(spec.beats, spec.bpm, *jitter_std_ms, *seed, profile),
        FixtureKind::ChordStrum => {
            let (mut onsets, expected) = generate_raw_onsets_perfect(spec.beats, spec.bpm, profile);
            // Duplicate each onset at +15ms to simulate a two-string strum.
            let strums: Vec<DetectedOnset> = onsets
                .iter()
                .map(|o| DetectedOnset {
                    timestamp_ms: o.timestamp_ms + 15,
                    amplitude: o.amplitude,
                    centroid: o.centroid,
                    confidence: o.confidence,
                })
                .collect();
            onsets.extend(strums);
            onsets.sort_by_key(|o| o.timestamp_ms);
            (onsets, expected)
        }
    }
}

fn write_fixture(dir: &Path, spec: &FixtureSpec) -> Result<PathBuf, String> {
    let profile = Instrument::ElectricGuitar.profile();
    let (onsets, expected) = make_onsets_and_expected(spec, &profile);

    let payload = FixtureInput {
        name: spec.name.to_string(),
        description: spec.description.to_string(),
        bpm: spec.bpm,
        beats: spec.beats,
        onsets,
        expected,
    };

    let dest = dir.join(format!("{}.input.json", spec.name));
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("serialize {}: {e}", spec.name))?;
    fs::write(&dest, format!("{json}\n")).map_err(|e| format!("write {}: {e}", dest.display()))?;

    Ok(dest)
}

fn main() -> ExitCode {
    let dir = fixtures_dir();
    fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("create fixtures dir: {e}"));

    let specs = build_fixtures();
    let mut ok = 0usize;
    let mut fail = 0usize;

    for spec in &specs {
        match write_fixture(&dir, spec) {
            Ok(path) => {
                println!("wrote {}", path.display());
                ok += 1;
            }
            Err(e) => {
                eprintln!("ERROR {}: {e}", spec.name);
                fail += 1;
            }
        }
    }

    println!("\n{ok}/{} fixture inputs written.", specs.len());
    if fail > 0 {
        eprintln!("{fail} fixture(s) failed.");
        return ExitCode::FAILURE;
    }

    println!(
        "\nnext: UPDATE_FIXTURES=1 cargo test --test highbpm_fixtures --manifest-path src-tauri/Cargo.toml"
    );
    ExitCode::SUCCESS
}
