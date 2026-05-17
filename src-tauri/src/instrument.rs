//! Instrument profiles (D0 of the DSP & Coach plan).
//!
//! Every "magic constant" in onset detection, beat matching, and scoring is
//! wrong for at least one of the five instruments we support. This module is
//! the single source of those constants. Every downstream phase (D2, D3, D4,
//! C5) consumes the profile rather than baking in globals.
//!
//! The starting values here are a first pass — they're the seed for the
//! Phase 3 validation matrix. Empirical tuning against real recordings is
//! how they reach their final values.
//!
//! Sequencing rule from the plan: D0 ships first. Reordering means
//! re-deriving instrument-specific constants twice.

use serde::{Deserialize, Serialize};
use std::ops::RangeInclusive;

/// The five instruments we calibrate for, plus a neutral fallback.
///
/// Strings are kebab-case to match the React-side dropdown ids
/// (see `src/constants/metronome.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Instrument {
    Drums,
    ElectricGuitar,
    AcousticGuitar,
    Bass,
    Piano,
    /// Neutral fallback — used when the user dismisses the first-launch
    /// picker or runs an instrument we don't have explicit values for.
    /// Coach vocabulary is generic in this mode.
    Other,
}

impl Default for Instrument {
    fn default() -> Self {
        // We don't auto-pick a real instrument here; the first-launch UX
        // is responsible for surfacing the picker. `Other` is the safest
        // backend default — it's the explicit "no specific calibration"
        // value, not a silent guess.
        Instrument::Other
    }
}

impl Instrument {
    /// Parse from the kebab-case string used by the React frontend.
    /// Returns `Instrument::Other` for unknown values so we degrade
    /// gracefully rather than crashing on store schema drift.
    pub fn from_id(id: &str) -> Self {
        match id {
            "drums" => Instrument::Drums,
            "electric-guitar" => Instrument::ElectricGuitar,
            "acoustic-guitar" => Instrument::AcousticGuitar,
            "bass" => Instrument::Bass,
            "piano" => Instrument::Piano,
            _ => Instrument::Other,
        }
    }

    /// Inverse of `from_id` for frontend serialization.
    pub fn id(self) -> &'static str {
        match self {
            Instrument::Drums => "drums",
            Instrument::ElectricGuitar => "electric-guitar",
            Instrument::AcousticGuitar => "acoustic-guitar",
            Instrument::Bass => "bass",
            Instrument::Piano => "piano",
            Instrument::Other => "other",
        }
    }

    /// Returns the calibrated profile for this instrument. Per the plan,
    /// these values are the seed for empirical tuning in Phase 3, not the
    /// final calibration.
    pub fn profile(self) -> InstrumentProfile {
        match self {
            Instrument::Drums => InstrumentProfile {
                refractory_floor_ms: 15,
                cluster_window_ms: 0,
                max_onsets_per_beat: 6,
                expected_onsets_per_beat: 1.0..=3.0,
                spectral_weights: spectral_weights_broadband_low_high(),
                activity_silence_beats: 8,
                vocabulary: InstrumentVocabulary::Drums,
            },
            Instrument::ElectricGuitar => InstrumentProfile {
                refractory_floor_ms: 40,
                cluster_window_ms: 20,
                max_onsets_per_beat: 3,
                expected_onsets_per_beat: 0.5..=2.0,
                spectral_weights: spectral_weights_mid(),
                activity_silence_beats: 4,
                vocabulary: InstrumentVocabulary::Guitar,
            },
            Instrument::AcousticGuitar => InstrumentProfile {
                refractory_floor_ms: 50,
                cluster_window_ms: 25,
                max_onsets_per_beat: 4,
                expected_onsets_per_beat: 0.5..=2.0,
                spectral_weights: spectral_weights_mid_high(),
                activity_silence_beats: 4,
                vocabulary: InstrumentVocabulary::Guitar,
            },
            Instrument::Bass => InstrumentProfile {
                refractory_floor_ms: 35,
                cluster_window_ms: 5,
                max_onsets_per_beat: 2,
                expected_onsets_per_beat: 0.5..=1.5,
                spectral_weights: spectral_weights_low(),
                activity_silence_beats: 4,
                vocabulary: InstrumentVocabulary::Bass,
            },
            Instrument::Piano => InstrumentProfile {
                refractory_floor_ms: 20,
                cluster_window_ms: 25,
                max_onsets_per_beat: 8,
                expected_onsets_per_beat: 1.0..=4.0,
                spectral_weights: spectral_weights_broadband(),
                activity_silence_beats: 8,
                vocabulary: InstrumentVocabulary::Piano,
            },
            Instrument::Other => InstrumentProfile {
                refractory_floor_ms: 30,
                cluster_window_ms: 15,
                max_onsets_per_beat: 4,
                expected_onsets_per_beat: 0.5..=2.0,
                spectral_weights: spectral_weights_moderate_broadband(),
                activity_silence_beats: 5,
                vocabulary: InstrumentVocabulary::Other,
            },
        }
    }
}

/// Per-instrument vocabulary key for coach templates + LLM system prompt
/// hints. Used by C5 (`templates[vocabulary][scenario][severity]`) and the
/// LLM prefix ("the player is on bass; use terms like fretting hand, root,
/// octave"). Multiple instruments can share a vocabulary key when their
/// coach language is identical (electric + acoustic guitar both use
/// `Guitar`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstrumentVocabulary {
    Drums,
    Guitar,
    Bass,
    Piano,
    Other,
}

/// The instrument-aware constants every downstream phase consumes.
///
/// All `ms` values are millisecond integers (we never need sub-ms
/// resolution; the onset detector's hop size is ~10ms anyway). Ranges
/// are inclusive on both ends so e.g. `1.0..=3.0` is "between 1 and 3
/// onsets per beat is normal."
#[derive(Debug, Clone)]
pub struct InstrumentProfile {
    /// Minimum time between distinct onsets (instrument physics floor).
    /// D2 will compute `max(this, subdivision_interval_ms × 0.35)` —
    /// this floor protects fast articulations that the grid wouldn't
    /// otherwise allow (drum rolls, guitar tremolo) while the grid
    /// multiplier handles the tempo-relative case.
    pub refractory_floor_ms: u32,

    /// Onsets within this window collapse into one "musical event"
    /// before matching. Handles chord voicings, strums, polyphonic piano.
    /// Drums = 0 (each hit including simultaneous hi-hat + snare is a
    /// distinct musical event). Bass mostly monophonic so a tight value.
    /// Piano needs 25ms for chord voicings without flattening fast runs.
    pub cluster_window_ms: u32,

    /// Cap on onsets-per-beat that count as "near a beat." Onsets beyond
    /// this become spurious. Closes the tremolo/roll exploit: a guitarist
    /// playing 8 onsets in one beat-window gets 3 counted near the beat
    /// + 5 spurious, instead of 1.0 onset_efficiency for free.
    ///
    /// **Not yet wired into the live matcher** — the live matcher in
    /// `timing.rs` currently bounds spurious onsets by amplitude weighting
    /// rather than a per-beat cap. The field is preserved in the profile
    /// schema (Phase 0 plan contract) so the matcher can adopt the cap
    /// once the D3d 18-scenario validation matrix lands. `allow(dead_code)`
    /// suppresses the lib-target unused-field warning until then.
    #[allow(dead_code)]
    pub max_onsets_per_beat: u8,

    /// Expected typical onset density per beat. Used to scale
    /// `onset_efficiency` so a drummer producing 2.5 onsets/beat (ghost
    /// notes, hat work) isn't penalized for being above 1.0.
    pub expected_onsets_per_beat: RangeInclusive<f32>,

    /// 16-band spectrum weight emphasis for spectral flux computation.
    /// Drums = broadband; bass = low; guitar = mid; piano = broadband.
    /// Sums to roughly 16.0 (uniform = 1.0 per band).
    pub spectral_weights: [f32; 16],

    /// Beats of silence before transitioning to Resting state. Drums +
    /// piano tolerate longer rests (musical phrasing, sustain pedal);
    /// bass + guitar are tighter.
    pub activity_silence_beats: u8,

    /// Coach vocabulary hint. See `InstrumentVocabulary`.
    ///
    /// Consumed on the JS side (`src/coach/templates.ts` picks the
    /// matching catalog) but not read by Rust runtime code; the field
    /// is part of the profile contract exported to the front-end via
    /// `get_active_instrument`. `allow(dead_code)` keeps the Rust lib
    /// build warning-free.
    #[allow(dead_code)]
    pub vocabulary: InstrumentVocabulary,
}

/// Schema version for `InstrumentProfile`. Bumped when the default values
/// or struct shape change. Session logs persist this number so historical
/// analytics can apply the right interpretation. Increment on any tuning
/// pass; never decrement.
pub const INSTRUMENT_PROFILE_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Spectral weight presets
// ---------------------------------------------------------------------------
//
// The 16 bands cover the audible range with rough log spacing. We don't
// need exact frequency boundaries here — the spectral flux detector is
// already coarse. These weights bias the flux computation toward the
// instrument's characteristic energy band.

/// Drums: broadband emphasis with extra weight on low (kick) and high
/// (hi-hat, snare crack) ends.
fn spectral_weights_broadband_low_high() -> [f32; 16] {
    [
        1.4, 1.4, 1.3, 1.1, // low (kick / floor tom)
        0.9, 0.8, 0.8, 0.9, // low-mid (toms, body)
        1.0, 1.0, 1.1, 1.2, // mid (snare body)
        1.3, 1.4, 1.4, 1.4, // high (cymbals, snare crack)
    ]
}

/// Guitar electric: mid-focused (200Hz–4kHz).
fn spectral_weights_mid() -> [f32; 16] {
    [
        0.6, 0.7, 0.9, 1.1, // low
        1.3, 1.4, 1.5, 1.5, // low-mid → mid
        1.4, 1.3, 1.2, 1.1, // mid → upper-mid
        0.9, 0.7, 0.6, 0.5, // high
    ]
}

/// Acoustic guitar: mid + high (200Hz–8kHz). More high-end than electric
/// because of the natural body resonance and string brightness.
fn spectral_weights_mid_high() -> [f32; 16] {
    [
        0.5, 0.6, 0.8, 1.0, // low
        1.2, 1.3, 1.4, 1.4, // low-mid → mid
        1.3, 1.3, 1.2, 1.2, // mid → upper-mid
        1.1, 1.0, 0.9, 0.8, // high
    ]
}

/// Bass: low emphasis (40Hz–1kHz).
fn spectral_weights_low() -> [f32; 16] {
    [
        1.6, 1.6, 1.5, 1.4, // sub / low
        1.3, 1.2, 1.1, 1.0, // low-mid
        0.9, 0.8, 0.7, 0.6, // mid
        0.5, 0.4, 0.4, 0.3, // high (largely irrelevant)
    ]
}

/// Piano: broadband with slight emphasis 80Hz–4kHz.
fn spectral_weights_broadband() -> [f32; 16] {
    [
        1.0, 1.2, 1.3, 1.3, // low (left-hand register)
        1.2, 1.2, 1.1, 1.1, // mid (chord body)
        1.1, 1.0, 1.0, 0.9, // upper-mid
        0.9, 0.8, 0.8, 0.7, // high (attack transient)
    ]
}

/// Other: uniform 1.0 across all 16 bands. No instrument-specific bias
/// because we don't know what's there.
fn spectral_weights_moderate_broadband() -> [f32; 16] {
    [1.0; 16]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instrument_roundtrip_via_id() {
        for inst in [
            Instrument::Drums,
            Instrument::ElectricGuitar,
            Instrument::AcousticGuitar,
            Instrument::Bass,
            Instrument::Piano,
            Instrument::Other,
        ] {
            assert_eq!(Instrument::from_id(inst.id()), inst);
        }
    }

    #[test]
    fn unknown_id_falls_back_to_other() {
        assert_eq!(Instrument::from_id(""), Instrument::Other);
        assert_eq!(Instrument::from_id("kazoo"), Instrument::Other);
        assert_eq!(Instrument::from_id("DRUMS"), Instrument::Other); // case-sensitive
    }

    #[test]
    fn every_profile_has_sane_values() {
        for inst in [
            Instrument::Drums,
            Instrument::ElectricGuitar,
            Instrument::AcousticGuitar,
            Instrument::Bass,
            Instrument::Piano,
            Instrument::Other,
        ] {
            let p = inst.profile();
            assert!(
                p.refractory_floor_ms >= 10 && p.refractory_floor_ms <= 100,
                "{inst:?}: refractory_floor_ms = {} out of plausible range",
                p.refractory_floor_ms
            );
            assert!(
                p.cluster_window_ms <= 50,
                "{inst:?}: cluster_window_ms = {} too wide",
                p.cluster_window_ms
            );
            assert!(
                p.max_onsets_per_beat >= 1 && p.max_onsets_per_beat <= 12,
                "{inst:?}: max_onsets_per_beat = {} out of range",
                p.max_onsets_per_beat
            );
            assert!(
                p.activity_silence_beats >= 2 && p.activity_silence_beats <= 16,
                "{inst:?}: activity_silence_beats = {} out of range",
                p.activity_silence_beats
            );
            assert!(
                *p.expected_onsets_per_beat.start() > 0.0
                    && *p.expected_onsets_per_beat.end()
                        >= *p.expected_onsets_per_beat.start(),
                "{inst:?}: expected_onsets_per_beat invalid"
            );
            let sum: f32 = p.spectral_weights.iter().sum();
            assert!(
                sum > 8.0 && sum < 32.0,
                "{inst:?}: spectral_weights sum {} too far from uniform 16.0",
                sum
            );
        }
    }

    #[test]
    fn drum_floor_is_tightest() {
        // Drums need to support fast rolls; their refractory floor must be
        // the lowest of all instruments. If this changes, the buzz-roll
        // test scenarios in D3 will need re-tuning.
        let drums = Instrument::Drums.profile().refractory_floor_ms;
        for inst in [
            Instrument::ElectricGuitar,
            Instrument::AcousticGuitar,
            Instrument::Bass,
            Instrument::Piano,
            Instrument::Other,
        ] {
            assert!(
                drums <= inst.profile().refractory_floor_ms,
                "{:?}'s refractory ({}) is tighter than drums ({})",
                inst,
                inst.profile().refractory_floor_ms,
                drums
            );
        }
    }

    #[test]
    fn drums_have_zero_cluster_window() {
        // Each drum hit (kick + snare even when simultaneous) must remain
        // a distinct musical event. Cluster window collapses them — for
        // drums we don't want that. Plan PREMISE: "drums = 0 (each hit
        // is a distinct event including simultaneous hi-hat + snare)."
        assert_eq!(Instrument::Drums.profile().cluster_window_ms, 0);
    }

    #[test]
    fn vocabulary_is_distinct_per_family() {
        // The coach uses vocabulary as a template lookup key. Different
        // instruments may share vocabulary (electric + acoustic guitar both
        // talk about "downstrokes") but unrelated families must not collide.
        assert_eq!(
            Instrument::ElectricGuitar.profile().vocabulary,
            InstrumentVocabulary::Guitar,
        );
        assert_eq!(
            Instrument::AcousticGuitar.profile().vocabulary,
            InstrumentVocabulary::Guitar,
        );
        assert_ne!(
            Instrument::Drums.profile().vocabulary,
            Instrument::Bass.profile().vocabulary,
        );
    }
}
