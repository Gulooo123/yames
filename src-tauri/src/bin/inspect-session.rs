//! Session-log inspector — P0-DBG-1
//!
//! Prints a single-screen summary of a captured SessionLog so you can
//! see at a glance where the score is being eaten without opening raw JSON.
//!
//! Usage:
//!   cargo run --bin inspect-session -- <session-log.json>
//!
//! Sections:
//!   1. Session headline (BPM, subdivision, instrument, duration, score)
//!   2. Onset summary (window, refractory, low-confidence list)
//!   3. Beat timeline (ASCII, one musical beat per row)
//!   4. Spurious clusters (bursts of ≥3 unmatched onsets in 200ms)
//!   5. Segment breakdown (per-segment scores + component sub-scores)

use std::env;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use yames_lib::session_log::{Classification, SegmentEndReason, load_log};
use yames_lib::timing::{tempo_aware_window_ms, REFRACTORY_SUBDIVISION_FACTOR};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Sliding window for spurious-onset cluster detection (ms).
const SPURIOUS_CLUSTER_WINDOW_MS: u64 = 200;
/// Minimum cluster size to report.
const SPURIOUS_CLUSTER_MIN: usize = 3;
/// Onset confidence below this is flagged as low-quality.
const LOW_CONF_THRESHOLD: f32 = 0.50;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

fn subdivision_name(s: u8) -> &'static str {
    match s {
        1 => "quarters",
        2 => "8ths",
        3 => "triplets",
        4 => "16ths",
        6 => "sextuplets",
        _ => "beats",
    }
}

fn class_char(c: Classification) -> char {
    match c {
        Classification::Perfect => '*',
        Classification::Good    => '+',
        Classification::Ok      => 'o',
        Classification::Miss    => '·',
        Classification::Skipped => 'S',
    }
}

fn end_reason_label(r: &SegmentEndReason) -> &'static str {
    match r {
        SegmentEndReason::SettingsChange    => "settings-change",
        SegmentEndReason::ActivityGap       => "activity-gap",
        SegmentEndReason::GridDiscontinuity => "grid-discontinuity",
        SegmentEndReason::SessionEnd        => "session-end",
        SegmentEndReason::UserStopped       => "user-stopped",
    }
}

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

/// Find clusters of ≥ `SPURIOUS_CLUSTER_MIN` spurious onsets that all fall
/// within a single `SPURIOUS_CLUSTER_WINDOW_MS` sliding window.
/// Returns `(start_ms, end_ms, count)` for each cluster found.
fn find_spurious_clusters(
    log: &yames_lib::session_log::SessionLog,
) -> Vec<(u64, u64, usize)> {
    let mut ts: Vec<u64> = log
        .spurious_onsets
        .iter()
        .filter_map(|&idx| log.detected_onsets.get(idx as usize))
        .map(|o| o.timestamp_ms)
        .collect();
    ts.sort_unstable();

    let mut clusters: Vec<(u64, u64, usize)> = Vec::new();
    let n = ts.len();
    let mut i = 0;
    while i < n {
        let window_end = ts[i] + SPURIOUS_CLUSTER_WINDOW_MS;
        let mut j = i;
        while j + 1 < n && ts[j + 1] <= window_end {
            j += 1;
        }
        let count = j - i + 1;
        if count >= SPURIOUS_CLUSTER_MIN {
            clusters.push((ts[i], ts[j], count));
            i = j + 1; // skip past cluster
        } else {
            i += 1;
        }
    }
    clusters
}

/// Format a sorted slice of indices as compact ranges.
/// e.g. `[1,2,3,7,8,9]` → `"1–3, 7–9"`
fn format_index_ranges(indices: &[usize]) -> String {
    if indices.is_empty() {
        return String::new();
    }
    let mut parts: Vec<String> = Vec::new();
    let mut start = indices[0];
    let mut prev = indices[0];
    for &idx in indices.iter().skip(1) {
        if idx == prev + 1 {
            prev = idx;
        } else {
            parts.push(if start == prev {
                format!("{start}")
            } else {
                format!("{start}–{prev}")
            });
            start = idx;
            prev = idx;
        }
    }
    parts.push(if start == prev {
        format!("{start}")
    } else {
        format!("{start}–{prev}")
    });
    parts.join(", ")
}

fn print_usage() {
    eprintln!(
        "usage: cargo run --bin inspect-session -- <session-log.json>\n\
         \n\
         Prints a single-screen summary of a captured SessionLog:\n\
         session headline, onset stats, beat timeline, spurious clusters,\n\
         and per-segment score breakdown."
    );
}

// ---------------------------------------------------------------------------
// Core inspector
// ---------------------------------------------------------------------------

fn run(path: &Path) -> Result<(), String> {
    let log = load_log(path)?;

    let subdiv_u = log.subdivision.max(1) as usize;
    let tick_interval_ms = 60_000.0 / (log.bpm as f64 * subdiv_u as f64);
    let profile = log.instrument.profile();
    let refractory_ms = (tick_interval_ms * REFRACTORY_SUBDIVISION_FACTOR as f64)
        .max(profile.refractory_floor_ms as f64);
    let window_ms = tempo_aware_window_ms(tick_interval_ms);
    let musical_beats = log.expected_beats.len() / subdiv_u;

    // Instrument display name from serde's kebab-case representation.
    let instrument_name = serde_json::to_value(&log.instrument)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| format!("{:?}", log.instrument));

    // ── Header ───────────────────────────────────────────────────────────────
    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("?");
    println!("=== SESSION INSPECT: {filename} ===");
    println!();

    println!(
        "BPM: {} | Subdiv: {} (×{}) | Instrument: {} | Duration: {}s",
        log.bpm,
        subdivision_name(log.subdivision),
        log.subdivision,
        instrument_name,
        log.duration_ms / 1000,
    );

    // The report's beat counts reflect the accumulator's mini-report window,
    // which JS clears (clearSession) after each per-segment mini-report.  If
    // the window was cleared before stop_evaluation fired, the persisted report
    // has stale/incomplete totals even though the match telemetry is complete.
    // Always prefer match-derived counts when we have match data; annotate when
    // the two sources disagree so the discrepancy is visible.
    let (beats_total, beats_hits, beats_miss, beats_skip) = if !log.matches.is_empty() {
        let total = log.matches.len() as u32;
        let hits = log.matches.iter().filter(|m| !matches!(
            m.classification, Classification::Miss | Classification::Skipped
        )).count() as u32;
        let miss = log.matches.iter().filter(|m| {
            m.classification == Classification::Miss
        }).count() as u32;
        let skip = log.matches.iter().filter(|m| {
            m.classification == Classification::Skipped
        }).count() as u32;
        (total, hits, miss, skip)
    } else {
        (
            log.report.total_beats,
            log.report.hits_count,
            log.report.miss_count,
            log.report.skipped_beats,
        )
    };
    // Flag when the report disagrees so the stale-window issue is visible.
    let beats_note = if !log.matches.is_empty()
        && log.report.total_beats != beats_total
    {
        format!(
            " [report says {}; match log used]",
            log.report.total_beats
        )
    } else {
        String::new()
    };
    println!(
        "Beats: {} expected, {} hits, {} misses, {} skipped{}",
        beats_total, beats_hits, beats_miss, beats_skip, beats_note,
    );
    let oe_str = log
        .report
        .onset_efficiency
        .map(|v| format!("{v:.2}"))
        .unwrap_or_else(|| "n/a".to_string());
    println!(
        "Score: {} ({}) | Grid corr: {:.2} | Onset eff: {}",
        log.report.score,
        log.report.grade,
        log.report.grid_correlation,
        oe_str,
    );
    let (perf_n, good_n, ok_n) = if !log.matches.is_empty() {
        let p = log.matches.iter().filter(|m| m.classification == Classification::Perfect).count();
        let g = log.matches.iter().filter(|m| m.classification == Classification::Good).count();
        let o = log.matches.iter().filter(|m| m.classification == Classification::Ok).count();
        (p as u32, g as u32, o as u32)
    } else {
        (log.report.perfect_count, log.report.good_count, log.report.ok_count)
    };
    println!(
        "Perf: {}  Good: {}  Ok: {}  Miss: {}  Skip: {}",
        perf_n, good_n, ok_n, beats_miss, beats_skip,
    );
    let tendency = if log.report.mean_deviation_ms > 0.5 {
        format!("+{:.1}ms (late)", log.report.mean_deviation_ms)
    } else if log.report.mean_deviation_ms < -0.5 {
        format!("{:.1}ms (early)", log.report.mean_deviation_ms)
    } else {
        format!("{:.1}ms (on time)", log.report.mean_deviation_ms)
    };
    println!(
        "Timing: mean dev {}  | std dev {:.1}ms | streak: {}",
        tendency,
        log.report.std_deviation_ms,
        log.report.longest_streak,
    );
    println!();

    // ── Onset summary ────────────────────────────────────────────────────────
    println!(
        "Onsets: {} detected, {} spurious",
        log.detected_onsets.len(),
        log.spurious_onsets.len(),
    );
    println!(
        "  Window: ±{:.0}ms | Refractory: {:.0}ms (floor={}ms × {:.2})",
        window_ms,
        refractory_ms,
        profile.refractory_floor_ms,
        REFRACTORY_SUBDIVISION_FACTOR,
    );

    let low_conf_indices: Vec<usize> = log
        .detected_onsets
        .iter()
        .enumerate()
        .filter(|(_, o)| o.confidence < LOW_CONF_THRESHOLD)
        .map(|(i, _)| i)
        .collect();
    if low_conf_indices.is_empty() {
        println!("  Low-confidence (<{LOW_CONF_THRESHOLD:.2}): none");
    } else {
        println!(
            "  Low-confidence (<{:.2}): onset(s) {}",
            LOW_CONF_THRESHOLD,
            format_index_ranges(&low_conf_indices),
        );
    }
    println!();

    // ── Beat timeline ─────────────────────────────────────────────────────────
    if log.matches.is_empty() || log.expected_beats.is_empty() {
        println!("Beat timeline: (no per-beat data recorded)");
    } else {
        println!(
            "Beat timeline  (* perfect  + good  o ok  · miss  S skip  ! spurious-miss):"
        );

        // Build tick-index → classification lookup.
        let mut class_map: std::collections::HashMap<u32, Classification> =
            std::collections::HashMap::new();
        for m in &log.matches {
            class_map.insert(m.beat_index, m.classification);
        }

        // Sorted spurious timestamps for per-slot window overlap checks.
        let mut spur_ts: Vec<u64> = log
            .spurious_onsets
            .iter()
            .filter_map(|&idx| log.detected_onsets.get(idx as usize))
            .map(|o| o.timestamp_ms)
            .collect();
        spur_ts.sort_unstable();

        let win_u64 = window_ms as u64;

        for mb in 0..musical_beats {
            let first_tick = (mb * subdiv_u) as u32;
            let mut slots = String::with_capacity(subdiv_u * 2);
            let mut row_has_spurious_miss = false;

            for tick_offset in 0..subdiv_u {
                let tick_idx = first_tick + tick_offset as u32;
                let c = class_map
                    .get(&tick_idx)
                    .copied()
                    .unwrap_or(Classification::Miss);

                // '!' replaces '·' only when this missed slot has a spurious
                // onset within the matching window of its expected timestamp.
                let ch = if c == Classification::Miss {
                    if let Some(exp_ts) = log
                        .expected_beats
                        .iter()
                        .find(|b| b.index == tick_idx)
                        .map(|b| b.timestamp_ms)
                    {
                        let lo = exp_ts.saturating_sub(win_u64);
                        let hi = exp_ts + win_u64;
                        let any_spur = spur_ts.partition_point(|&t| t < lo)
                            < spur_ts.partition_point(|&t| t <= hi);
                        if any_spur {
                            row_has_spurious_miss = true;
                            '!'
                        } else {
                            class_char(c)
                        }
                    } else {
                        class_char(c)
                    }
                } else {
                    class_char(c)
                };

                slots.push(ch);
                if tick_offset + 1 < subdiv_u {
                    slots.push(' ');
                }
            }

            let marker = if row_has_spurious_miss { "  !" } else { "" };
            println!("  beat {:4}:  {}{}", first_tick, slots, marker);
        }
    }
    println!();

    // ── Spurious clusters ─────────────────────────────────────────────────────
    let clusters = find_spurious_clusters(&log);
    if clusters.is_empty() {
        println!("Spurious clusters: none");
    } else {
        println!("Spurious clusters: {}", clusters.len());
        for (i, (start_ms, end_ms, count)) in clusters.iter().enumerate() {
            let nearest = log
                .expected_beats
                .iter()
                .min_by_key(|b| (b.timestamp_ms as i64 - *start_ms as i64).unsigned_abs());
            let near_str = nearest
                .map(|b| format!(" (near tick {})", b.index))
                .unwrap_or_default();
            println!(
                "  [{i}] {count} onsets in {}ms at t={start_ms}ms{near_str}",
                end_ms - start_ms,
            );
        }
    }
    println!();

    // ── Segment breakdown ─────────────────────────────────────────────────────
    if log.segments.is_empty() {
        println!("Segments: (none — session may predate segment tracking)");
    } else {
        println!("Segments: {}", log.segments.len());
        for (i, seg) in log.segments.iter().enumerate() {
            let start_s = seg.start_ms as f64 / 1000.0;
            let end_s = seg.end_ms as f64 / 1000.0;
            let dur_s = seg.end_ms.saturating_sub(seg.start_ms) as f64 / 1000.0;
            let cs = &seg.component_scores;
            let div_str = if seg.inferred_divisor > 0 {
                format!(
                    "div={} ({:.0}%)",
                    seg.inferred_divisor,
                    seg.inferred_divisor_confidence * 100.0,
                )
            } else {
                "div=?".to_string()
            };
            println!(
                "  [{i}] {start_s:.1}s–{end_s:.1}s ({dur_s:.1}s) \
                 | score={:.0} \
                 | ic={:.0} ga={:.0} hc={:.0} oe={:.0} \
                 | {div_str} | {}",
                seg.score,
                cs.interval_consistency * 100.0,
                cs.grid_alignment * 100.0,
                cs.hit_completeness * 100.0,
                cs.onset_efficiency * 100.0,
                end_reason_label(&seg.end_reason),
            );
        }
    }

    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        return ExitCode::from(2);
    }
    let path = PathBuf::from(&args[1]);
    match run(&path) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("inspect-session: {e}");
            ExitCode::FAILURE
        }
    }
}
