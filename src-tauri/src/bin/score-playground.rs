//! Score-formula playground binary.
//!
//! Usage:
//!   cargo run --bin score-playground -- <input.json> [--w1=0.40 --w2=0.20 --w3=0.25 --w4=0.15]
//!
//! Reads a `dsp_fixtures` input file (same `FixtureInput` schema used by
//! `tests/dsp_fixtures/`), runs `score_feedbacks`, computes the four D3
//! proxy components from the resulting `SessionReport`, and prints:
//!
//! 1. Per-component breakdown with raw sub-values.
//! 2. Baseline total under the hardcoded `W_*` constants.
//! 3. Custom-weight total (and delta) if `--w1/--w2/--w3/--w4` flags are
//!    provided.
//!
//! Component proxy formulas (applied to the raw-feedback report, where no
//! D3 segments exist and `report.onset_efficiency` is always `None`):
//!
//!   interval_consistency = (1 − std_deviation_ms / 50.0).clamp(0, 1)
//!     (mirrors `consistency_score` in `session.rs`)
//!
//!   grid_alignment = report.grid_correlation
//!     (mean grid correlation across all hit beats, already averaged in the
//!     report)
//!
//!   hit_completeness = hits_count / total_beats
//!     (total_beats includes misses + skipped — the under-play loophole
//!     closure that matches `score_segment`'s intent; skipped beats do
//!     deflate this, but the fixture suite doesn't produce them)
//!
//!   onset_efficiency = hits_count / scored_beats  (= hit_rate fallback)
//!     `report.onset_efficiency` is always `None` for raw-feedback inputs
//!     because no `PracticeSegment`s are pushed through the accumulator.
//!     We fall back to the hit-rate proxy (matched / scored), which is the
//!     closest analogue of the D3 `onset_efficiency` for this code path.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

use yames_lib::session_log::score_feedbacks;
use yames_lib::timing::{
    BeatFeedback, W_GRID_ALIGNMENT, W_HIT_COMPLETENESS, W_INTERVAL_CONSISTENCY,
    W_ONSET_EFFICIENCY,
};

// ── Fixture input schema ─────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct FixtureInput {
    name: String,
    #[allow(dead_code)]
    description: String,
    feedbacks: Vec<BeatFeedback>,
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

fn print_usage() {
    eprintln!(
        "usage: cargo run --bin score-playground -- <input.json> [--w1=0.40 --w2=0.20 --w3=0.25 --w4=0.15]\n\
         \n\
         Reads a dsp_fixtures input file and prints the per-component score\n\
         breakdown plus the weighted total under the current and, optionally,\n\
         custom weights.\n\
         \n\
         Flags:\n\
           --w1=<f>  interval_consistency weight (default {W_INTERVAL_CONSISTENCY:.2})\n\
           --w2=<f>  grid_alignment weight       (default {W_GRID_ALIGNMENT:.2})\n\
           --w3=<f>  hit_completeness weight     (default {W_HIT_COMPLETENESS:.2})\n\
           --w4=<f>  onset_efficiency weight     (default {W_ONSET_EFFICIENCY:.2})\n\
         \n\
         Unknown flags: exit 2."
    );
}

struct Args {
    input: PathBuf,
    custom_weights: Option<[f64; 4]>,
}

fn parse_args() -> Result<Args, ExitCode> {
    let raw: Vec<String> = env::args().collect();
    if raw.len() < 2 {
        print_usage();
        return Err(ExitCode::from(2));
    }

    let input = PathBuf::from(&raw[1]);
    let mut w: [Option<f64>; 4] = [None; 4];

    for flag in raw.iter().skip(2) {
        if let Some(val) = flag.strip_prefix("--w1=") {
            w[0] = Some(val.parse().unwrap_or_else(|_| {
                eprintln!("score-playground: bad value for --w1: {val}");
                std::process::exit(2);
            }));
        } else if let Some(val) = flag.strip_prefix("--w2=") {
            w[1] = Some(val.parse().unwrap_or_else(|_| {
                eprintln!("score-playground: bad value for --w2: {val}");
                std::process::exit(2);
            }));
        } else if let Some(val) = flag.strip_prefix("--w3=") {
            w[2] = Some(val.parse().unwrap_or_else(|_| {
                eprintln!("score-playground: bad value for --w3: {val}");
                std::process::exit(2);
            }));
        } else if let Some(val) = flag.strip_prefix("--w4=") {
            w[3] = Some(val.parse().unwrap_or_else(|_| {
                eprintln!("score-playground: bad value for --w4: {val}");
                std::process::exit(2);
            }));
        } else {
            eprintln!("score-playground: unknown flag: {flag}");
            print_usage();
            return Err(ExitCode::from(2));
        }
    }

    // Any wx present → all four must be present (or we fill in the defaults
    // for the ones that weren't given).
    let any_given = w.iter().any(|x| x.is_some());
    let custom_weights = if any_given {
        Some([
            w[0].unwrap_or(W_INTERVAL_CONSISTENCY as f64),
            w[1].unwrap_or(W_GRID_ALIGNMENT as f64),
            w[2].unwrap_or(W_HIT_COMPLETENESS as f64),
            w[3].unwrap_or(W_ONSET_EFFICIENCY as f64),
        ])
    } else {
        None
    };

    Ok(Args { input, custom_weights })
}

// ── Component proxy computation ──────────────────────────────────────────────

struct Components {
    interval_consistency: f64,
    grid_alignment: f64,
    hit_completeness: f64,
    onset_efficiency: f64,

    // Raw sub-values shown next to each component
    std_deviation_ms: f64,
    grid_correlation: f64,
    hits_count: u32,
    total_beats: u32,
    scored_beats: u32, // hits + misses (excl. skipped)
}

fn compute_components(feedbacks: &[BeatFeedback]) -> Components {
    let report = score_feedbacks(feedbacks);

    let scored_beats = report.hits_count + report.miss_count;

    // interval_consistency — mirrors `consistency_score` in `session.rs`
    let interval_consistency =
        (1.0 - report.std_deviation_ms / 50.0).clamp(0.0, 1.0);

    // grid_alignment — mean grid correlation across hit beats
    let grid_alignment = report.grid_correlation;

    // hit_completeness — hits / total_beats (includes misses + skipped)
    let hit_completeness = if report.total_beats > 0 {
        report.hits_count as f64 / report.total_beats as f64
    } else {
        0.0
    };

    // onset_efficiency — hit-rate fallback (report.onset_efficiency is None
    // for raw-feedback inputs because no PracticeSegments are accumulated).
    let onset_efficiency = if scored_beats > 0 {
        report.hits_count as f64 / scored_beats as f64
    } else {
        0.0
    };

    Components {
        interval_consistency,
        grid_alignment,
        hit_completeness,
        onset_efficiency,
        std_deviation_ms: report.std_deviation_ms,
        grid_correlation: report.grid_correlation,
        hits_count: report.hits_count,
        total_beats: report.total_beats,
        scored_beats,
    }
}

fn weighted_total(c: &Components, w1: f64, w2: f64, w3: f64, w4: f64) -> f64 {
    (c.interval_consistency * w1
        + c.grid_alignment * w2
        + c.hit_completeness * w3
        + c.onset_efficiency * w4)
        * 100.0
}

// ── Grade lookup (mirrors session.rs) ────────────────────────────────────────

fn grade(score: f64) -> &'static str {
    match score.round() as u32 {
        95..=100 => "S",
        85..=94 => "A",
        70..=84 => "B",
        55..=69 => "C",
        40..=54 => "D",
        _ => "F",
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

fn run(args: &Args) -> Result<(), String> {
    // Read + parse input
    let raw = fs::read_to_string(&args.input)
        .map_err(|e| format!("cannot read '{}': {e}", args.input.display()))?;
    let fixture: FixtureInput =
        serde_json::from_str(&raw).map_err(|e| {
            format!("cannot parse '{}': {e}", args.input.display())
        })?;

    if fixture.feedbacks.is_empty() {
        return Err(format!(
            "fixture '{}' has an empty feedbacks array — nothing to score",
            fixture.name,
        ));
    }

    let file_name = args
        .input
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("<input>");
    let n = fixture.feedbacks.len();

    let c = compute_components(&fixture.feedbacks);

    let w1 = W_INTERVAL_CONSISTENCY as f64;
    let w2 = W_GRID_ALIGNMENT as f64;
    let w3 = W_HIT_COMPLETENESS as f64;
    let w4 = W_ONSET_EFFICIENCY as f64;
    let baseline = weighted_total(&c, w1, w2, w3, w4);

    // ── Weights-not-summing-to-1 warning ──────────────────────────────
    let baseline_sum = w1 + w2 + w3 + w4;
    if (baseline_sum - 1.0).abs() > 0.01 {
        eprintln!(
            "warning: baseline weights sum to {baseline_sum:.4}, not 1.0 — \
             total will not be in [0, 100]"
        );
    }
    if let Some(cw) = &args.custom_weights {
        let custom_sum: f64 = cw.iter().sum();
        if (custom_sum - 1.0).abs() > 0.01 {
            eprintln!(
                "warning: custom weights sum to {custom_sum:.4}, not 1.0 — \
                 total will not be in [0, 100]"
            );
        }
    }

    // ── Output ────────────────────────────────────────────────────────
    println!("Input: {file_name} ({n} feedbacks)");
    println!();

    println!(
        "Components (weights {w1:.2} / {w2:.2} / {w3:.2} / {w4:.2}):"
    );
    println!(
        "  interval_consistency:  {:5.1}   (std_dev={:.2}ms)",
        c.interval_consistency * 100.0,
        c.std_deviation_ms,
    );
    println!(
        "  grid_alignment:        {:5.1}   (mean_grid_correlation={:.4})",
        c.grid_alignment * 100.0,
        c.grid_correlation,
    );
    println!(
        "  hit_completeness:      {:5.1}   (hits={}/{} total beats)",
        c.hit_completeness * 100.0,
        c.hits_count,
        c.total_beats,
    );
    println!(
        "  onset_efficiency:      {:5.1}   (hits={}/{} scored beats, fallback=hit_rate)",
        c.onset_efficiency * 100.0,
        c.hits_count,
        c.scored_beats,
    );
    println!("  \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}");
    println!(
        "  Total:                 {:5.1}  \u{2192}  {}",
        baseline,
        grade(baseline),
    );

    if let Some(cw) = &args.custom_weights {
        let [cw1, cw2, cw3, cw4] = *cw;
        let custom_total = weighted_total(&c, cw1, cw2, cw3, cw4);
        let delta = custom_total - baseline;
        let sign = if delta >= 0.0 { "+" } else { "" };
        println!();
        println!(
            "With weights {cw1:.2} / {cw2:.2} / {cw3:.2} / {cw4:.2}:"
        );
        println!(
            "  Total:                 {:5.1}  ({sign}{delta:.1})",
            custom_total,
        );
    }

    Ok(())
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(code) => return code,
    };

    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("score-playground: {e}");
            ExitCode::FAILURE
        }
    }
}
