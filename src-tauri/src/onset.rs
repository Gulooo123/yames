use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::audio_input::SharedAudioInput;
use crate::instrument::InstrumentProfile;

/// A detected onset event.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Onset {
    /// Monotonic timestamp in nanoseconds (from Instant)
    #[serde(rename = "tsNs")]
    pub ts_ns: u64,
    /// Peak amplitude at onset (0.0–1.0)
    pub amplitude: f32,
    /// Spectral centroid at onset (Hz) — higher = brighter sound
    pub centroid: f32,
    /// D2 — detection confidence in `[0.0, 1.0]`. Higher = clearer
    /// onset against the noise floor + sharper spectral flux peak.
    /// Downstream: D3 grid_alignment weights classifications by this,
    /// onset_efficiency weights matched-count by this, and C5 coach
    /// surfaces a "hard to hear you" caveat when mean session
    /// confidence stays under 0.5 for 30+ seconds.
    pub confidence: f32,
}

/// Live tempo context shared between the metronome engine and the
/// onset detector. Lets D2 compute an adaptive refractory period
/// (`max(profile.refractory_floor_ms, subdivision_interval_ms × k)`)
/// without coupling the detector to the engine module.
///
/// Both fields are atomically writeable so the engine can update them
/// per-beat without re-acquiring the SharedState mutex.
#[derive(Debug)]
pub struct TempoContext {
    /// Current BPM × 100 (centi-BPM) so we get one decimal of resolution
    /// while staying lock-free with `AtomicU32`.
    bpm_x100: AtomicU32,
    /// Current subdivision (1 = quarter, 2 = 8th, 4 = 16th, …).
    subdivision: AtomicU32,
}

impl TempoContext {
    pub fn new(bpm: u16, subdivision: u8) -> Self {
        Self {
            bpm_x100: AtomicU32::new((bpm as u32) * 100),
            subdivision: AtomicU32::new(subdivision.max(1) as u32),
        }
    }
    pub fn set_bpm(&self, bpm: u16) {
        self.bpm_x100.store((bpm as u32) * 100, Ordering::Relaxed);
    }
    pub fn set_subdivision(&self, subdivision: u8) {
        self.subdivision
            .store(subdivision.max(1) as u32, Ordering::Relaxed);
    }
    /// Returns the current subdivision interval in milliseconds. At
    /// 120 BPM quarter-notes this is 500ms; at 200 BPM 16ths it's 75ms.
    pub fn subdivision_interval_ms(&self) -> f32 {
        let bpm = (self.bpm_x100.load(Ordering::Relaxed) as f32) / 100.0;
        let subdiv = self.subdivision.load(Ordering::Relaxed) as f32;
        if bpm <= 0.0 || subdiv <= 0.0 {
            return 500.0;
        }
        (60_000.0 / bpm) / subdiv
    }
}

pub type SharedTempoContext = Arc<TempoContext>;

/// D2 refractory multiplier — `max(floor, subdivision_interval × 0.35)`.
/// Plan-specified value; lower for drums (separate path via the
/// `profile.refractory_floor_ms` already), tighter at faster tempos.
pub const REFRACTORY_SUBDIVISION_FACTOR: f32 = 0.35;

/// Onset detector using spectral flux with adaptive threshold.
///
/// Runs on a dedicated analyzer thread, consuming samples from the audio input
/// ring buffer. Emits `Onset` events through a callback.
pub struct OnsetDetector {
    alive: Arc<AtomicBool>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl OnsetDetector {
    pub fn new() -> Self {
        Self {
            alive: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
        }
    }

    /// Start the onset detection thread.
    ///
    /// `profile` carries instrument-specific tuning (D0 of the DSP plan):
    /// most importantly, `refractory_floor_ms` (the physics floor) and
    /// `cluster_window_ms` (chord/strum merging).
    ///
    /// `tempo_ctx` is the live BPM / subdivision view (D2). The
    /// detector reads it every hop to compute the adaptive refractory
    /// period — `max(floor, subdivision_interval × 0.35)`. Drums get a
    /// tighter floor via the profile so fast rolls aren't merged at
    /// fast tempos.
    ///
    /// `on_onset` is called from the analyzer thread for each detected
    /// onset. After D2's chord-cluster pass, near-simultaneous onsets
    /// have already been collapsed to a single event.
    pub fn start<F>(
        &mut self,
        audio_input: SharedAudioInput,
        profile: InstrumentProfile,
        tempo_ctx: SharedTempoContext,
        on_onset: F,
    ) where
        F: Fn(Onset) + Send + 'static,
    {
        self.stop();
        self.alive.store(true, Ordering::SeqCst);
        let alive = self.alive.clone();

        self.thread_handle = Some(thread::spawn(move || {
            Self::detect_loop(alive, audio_input, profile, tempo_ctx, on_onset);
        }));
    }

    pub fn stop(&mut self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }

    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Main detection loop. Processes audio in hops, computes spectral flux,
    /// applies adaptive threshold, and emits onsets.
    ///
    /// Consumes the `InstrumentProfile`:
    ///   * `refractory_floor_ms` sets the lower bound on inter-onset gap.
    ///   * `cluster_window_ms` collapses near-simultaneous onsets into
    ///     one "musical event" (D2 chord/strum merge).
    ///   * `spectral_weights` biases the per-band flux contribution
    ///     toward the instrument's characteristic energy region.
    ///
    /// Consumes `tempo_ctx` to make the refractory period adaptive
    /// (`max(floor, subdivision_interval × 0.35)`).
    fn detect_loop<F>(
        alive: Arc<AtomicBool>,
        audio_input: SharedAudioInput,
        profile: InstrumentProfile,
        tempo_ctx: SharedTempoContext,
        on_onset: F,
    ) where
        F: Fn(Onset) + Send + 'static,
    {
        let fft_size = 1024_usize;
        // NOTE: hop_size is implicit (512 = fft_size / 2; 50% overlap)
        // and only referenced in comments around `flux_history_len`
        // and the FFT loop's hop math. The explicit binding sat dead
        // for a while — removed during the Step-4 cleanup so the
        // overlap factor is documented HERE in one place.
        let half = fft_size / 2;

        // Hann window
        let window: Vec<f32> = (0..fft_size)
            .map(|i| {
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (fft_size - 1) as f32).cos())
            })
            .collect();

        // Previous magnitude spectrum for flux computation
        let mut prev_mags = vec![0.0_f32; half];

        // Adaptive threshold: ring buffer of recent flux values
        let flux_history_len = 100; // ~1 second at hop_size=512, 48kHz (~10ms per hop)
        let mut flux_history = vec![0.0_f32; flux_history_len];
        let mut flux_write_pos = 0;
        let threshold_multiplier = 1.5_f32;

        // D2 adaptive noise floor — rolling 10th-percentile of RMS over
        // ~5 seconds of recent audio. Replaces the old hardcoded 0.01.
        // The 10th-percentile fix sidesteps the "user struck a note
        // during the bootstrap window" failure mode that plagued the
        // earlier "re-measure on signal drop" idea (which was circular
        // anyway — the threshold IS what we were trying to set).
        const RMS_HISTORY_LEN: usize = 500; // ~5s at 10ms/hop
        const NOISE_FLOOR_MULTIPLIER: f32 = 3.0;
        const MIN_NOISE_FLOOR: f32 = 0.002; // absolute lower bound
        let mut rms_history = vec![0.0_f32; RMS_HISTORY_LEN];
        let mut rms_write_pos = 0_usize;
        let mut rms_samples_seen = 0_usize;

        // D2 chord/strum merging — pending onset that's still inside
        // the cluster window. Once the window expires (or a louder
        // onset arrives), we forward the merged event.
        let cluster_window_ns = (profile.cluster_window_ms as u64) * 1_000_000;
        let mut pending: Option<PendingCluster> = None;

        // Refractory period is now computed PER-HOP from the live tempo
        // context (D2). Floor stays profile-driven so fast articulations
        // (drum rolls, guitar tremolo) aren't blocked just because the
        // grid is quarter notes — see plan's "DO NOT key refractory off
        // the grid subdivision alone."
        let mut last_onset_ns: u64 = 0;

        // Reference time uses shared clock for cross-thread comparability
        let sample_rate = {
            let ai = audio_input.lock().unwrap();
            ai.sample_rate()
        };

        // Diagnostic logging — env-flag gated so logs don't ship in
        // production builds. Flip on by launching the dev shell with:
        //   YAMES_ONSET_DEBUG=1 npm run tauri dev
        // The flag is read once here (not every hop — `std::env::var`
        // is a syscall) so toggling it requires a restart. Two log
        // channels:
        //   * Periodic state dump every ~1s of hops — useful when no
        //     onsets fire so you can see WHY (rms below floor, flux
        //     below threshold, refractory blocking, …).
        //   * Per-onset emission log — fires every time the detector
        //     emits a raw onset (before chord clustering).
        let debug_enabled = std::env::var("YAMES_ONSET_DEBUG").is_ok();
        if debug_enabled {
            eprintln!("[onset] debug logging enabled (sample_rate={sample_rate})");
        }
        let mut hops_since_log: u32 = 0;
        const LOG_EVERY_HOPS: u32 = 100; // ~1s at hop_size=512 @ 48kHz

        while alive.load(Ordering::SeqCst) {
            // Sleep a bit between processing (don't spin-wait)
            thread::sleep(Duration::from_millis(5));
            if !alive.load(Ordering::SeqCst) {
                break;
            }

            // Read available samples from ring buffer
            let new_samples = {
                let ai = audio_input.lock().unwrap();
                let ring = ai.ring();
                let r = ring.lock().unwrap();
                // Read the last 4096 samples (more than we need) and determine
                // what's new since our last read
                r.read_last(fft_size * 4)
            };

            if new_samples.len() < fft_size {
                continue;
            }

            // Process in hops. We overlap by hop_size.
            let total_available = new_samples.len();
            let offset = if total_available > fft_size {
                total_available - fft_size
            } else {
                0
            };

            // Only process the most recent complete frame to avoid falling behind
            if offset + fft_size > total_available {
                continue;
            }

            let frame = &new_samples[offset..offset + fft_size];

            // Apply window
            let windowed: Vec<f32> = frame.iter().zip(&window).map(|(s, w)| s * w).collect();

            // Compute magnitude spectrum using DFT for each bin
            // For 512 bins this is expensive, so we use a simplified approach:
            // compute magnitude only for bins we need (every 4th bin for flux)
            // Actually, let's compute full magnitudes using the Goertzel algorithm
            // which is O(N) per bin but gives us exact values.
            // For 512 bins × 1024 samples = ~500K ops, runs in <1ms.
            let mut mags = vec![0.0_f32; half];
            for k in 0..half {
                let freq = 2.0 * std::f32::consts::PI * k as f32 / fft_size as f32;
                let coeff = 2.0 * freq.cos();
                let mut s1 = 0.0_f32;
                let mut s2 = 0.0_f32;
                for &x in &windowed {
                    let s0 = x + coeff * s1 - s2;
                    s2 = s1;
                    s1 = s0;
                }
                let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
                mags[k] = power.max(0.0).sqrt();
            }

            // Spectral flux: sum of positive differences (half-wave
            // rectification), weighted by the instrument's 16-band
            // spectral profile. The 512 magnitude bins are bucketed into
            // 16 contiguous bands and each bin's contribution is scaled
            // by its band's weight. Drums emphasize low+high (kick +
            // hat); bass emphasizes low; guitar emphasizes mid. "Other"
            // uses uniform 1.0 across all bands (i.e. unchanged).
            let bins_per_band = half / 16; // 512/16 = 32
            let mut flux = 0.0_f32;
            for k in 0..half {
                let diff = mags[k] - prev_mags[k];
                if diff > 0.0 {
                    let band = (k / bins_per_band).min(15);
                    flux += diff * profile.spectral_weights[band];
                }
            }

            // Compute spectral centroid for this frame
            let mag_sum: f32 = mags.iter().sum();
            let centroid = if mag_sum > 0.0001 {
                let weighted: f32 = mags
                    .iter()
                    .enumerate()
                    .map(|(k, &m)| k as f32 * sample_rate as f32 / fft_size as f32 * m)
                    .sum();
                weighted / mag_sum
            } else {
                0.0
            };

            // Compute RMS amplitude
            let rms = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();

            // Update previous magnitudes
            prev_mags.copy_from_slice(&mags);

            // Update flux history for adaptive threshold
            flux_history[flux_write_pos] = flux;
            flux_write_pos = (flux_write_pos + 1) % flux_history_len;

            // Adaptive threshold: median of recent flux × multiplier
            let threshold = {
                let mut sorted = flux_history.clone();
                sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let median = sorted[sorted.len() / 2];
                median * threshold_multiplier + 0.001 // small floor to avoid triggering on silence
            };

            // D2 adaptive noise floor — update rolling RMS history then
            // take 10th percentile × NOISE_FLOOR_MULTIPLIER. Until the
            // history is half full we use a conservative absolute floor
            // so the bootstrap period doesn't admit junk onsets.
            rms_history[rms_write_pos] = rms;
            rms_write_pos = (rms_write_pos + 1) % RMS_HISTORY_LEN;
            rms_samples_seen = (rms_samples_seen + 1).min(RMS_HISTORY_LEN);
            let noise_floor = if rms_samples_seen >= RMS_HISTORY_LEN / 2 {
                let mut sorted_rms = rms_history[..rms_samples_seen].to_vec();
                sorted_rms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let p10_idx = sorted_rms.len() / 10; // 10th percentile
                (sorted_rms[p10_idx] * NOISE_FLOOR_MULTIPLIER).max(MIN_NOISE_FLOOR)
            } else {
                MIN_NOISE_FLOOR
            };

            // D2 adaptive refractory — recompute per-hop from the live
            // tempo context. Floor (instrument physics) wins at fast
            // subdivisions; the multiplier wins at slow ones. Plan:
            // `max(profile.refractory_floor_ms, sub_interval × 0.35)`.
            let sub_interval_ms = tempo_ctx.subdivision_interval_ms();
            let adaptive_refractory_ms = (sub_interval_ms * REFRACTORY_SUBDIVISION_FACTOR)
                .max(profile.refractory_floor_ms as f32);
            let refractory_ns = (adaptive_refractory_ms as u64) * 1_000_000;

            // Periodic state dump — see DEBUG comment near loop start.
            // Useful diagnostic when the user says "I'm playing but no
            // onsets fire": shows whether `rms > noise_floor` and
            // `flux > threshold` are passing.
            if debug_enabled {
                hops_since_log += 1;
                if hops_since_log >= LOG_EVERY_HOPS {
                    hops_since_log = 0;
                    let rms_pass = rms > noise_floor;
                    let flux_pass = flux > threshold;
                    eprintln!(
                        "[onset] state rms={:.4}{} flux={:.3}{} floor={:.4} thr={:.3} refrac={:.0}ms",
                        rms,
                        if rms_pass { ">floor" } else { "<floor" },
                        flux,
                        if flux_pass { ">thr" } else { "<thr" },
                        noise_floor,
                        threshold,
                        adaptive_refractory_ms,
                    );
                }
            }

            // Check for onset
            if flux > threshold && rms > noise_floor {
                let now_ns = crate::clock::now_ns();
                let since_last_ms = now_ns.saturating_sub(last_onset_ns) / 1_000_000;

                // Refractory period check (skips spurious double-counts).
                if now_ns.saturating_sub(last_onset_ns) >= refractory_ns {
                    last_onset_ns = now_ns;
                    if debug_enabled {
                        eprintln!(
                            "[onset] FIRED rms={:.4} flux={:.3} thr={:.3} floor={:.4} since_last={}ms",
                            rms, flux, threshold, noise_floor, since_last_ms,
                        );
                    }

                    // D2 confidence — blend three signals:
                    //   * amplitude-to-noise ratio (audibility)
                    //   * flux above adaptive threshold (peak sharpness)
                    //   * raw amplitude vs absolute ceiling (sanity)
                    // Final value clamped to [0, 1].
                    let amp_ratio = if noise_floor > 0.0 {
                        (rms / noise_floor).min(8.0)
                    } else {
                        1.0
                    };
                    let flux_ratio = if threshold > 0.0 {
                        (flux / threshold).min(8.0)
                    } else {
                        1.0
                    };
                    let conf_amp = ((amp_ratio - 1.0) / 4.0).clamp(0.0, 1.0);
                    let conf_flux = ((flux_ratio - 1.0) / 4.0).clamp(0.0, 1.0);
                    let confidence = (conf_amp * 0.45 + conf_flux * 0.55).clamp(0.0, 1.0);

                    let onset = Onset {
                        ts_ns: now_ns,
                        amplitude: rms.clamp(0.0, 1.0),
                        centroid,
                        confidence,
                    };

                    // D2 chord/strum merging — if a pending onset is
                    // still inside the cluster window, fold this one in
                    // (keep the loudest's timestamp, sum amplitudes,
                    // take the higher confidence). Drums opt out by
                    // setting `cluster_window_ms = 0` in their profile.
                    if cluster_window_ns == 0 {
                        on_onset(onset);
                    } else {
                        // Probe the in-flight cluster's window without
                        // moving it out of `pending`. If it's still
                        // open, merge in place. Otherwise flush the old
                        // one and start a fresh cluster.
                        let still_open = match pending.as_ref() {
                            Some(p) => {
                                onset.ts_ns.saturating_sub(p.first_ts_ns) <= cluster_window_ns
                            }
                            None => false,
                        };
                        if still_open {
                            // unwrap is safe — still_open ⇒ Some(_).
                            pending.as_mut().unwrap().merge(onset);
                        } else {
                            if let Some(old) = pending.take() {
                                on_onset(old.flush());
                            }
                            pending = Some(PendingCluster::from_onset(onset));
                        }
                    }
                } else if debug_enabled {
                    // Candidate was loud + spectral enough but the
                    // refractory guard blocked it. Common during fast
                    // tremolo / drum rolls; flag in logs so the user
                    // can tell whether a low onset count is "didn't
                    // detect" vs "detected but merged".
                    eprintln!(
                        "[onset] blocked-by-refractory since_last={}ms < refrac={:.0}ms (rms={:.4} flux={:.3})",
                        since_last_ms, adaptive_refractory_ms, rms, flux,
                    );
                }
            }

            // Flush any pending cluster whose window has closed (even if
            // no new onset arrived this hop).
            if let Some(ref p) = pending {
                let now_ns = crate::clock::now_ns();
                if now_ns.saturating_sub(p.first_ts_ns) > cluster_window_ns {
                    let merged = pending.take().unwrap().flush();
                    on_onset(merged);
                }
            }
        }

        // Drain any final pending cluster on shutdown.
        if let Some(p) = pending.take() {
            on_onset(p.flush());
        }
    }
}

/// Internal helper used during chord/strum merging. Holds the in-flight
/// "lead" onset of a cluster plus the accumulated amplitude / max
/// confidence as additional onsets fall inside the window.
#[derive(Debug, Clone)]
struct PendingCluster {
    first_ts_ns: u64,
    /// Timestamp of the loudest onset in the cluster — that's the one
    /// we keep for downstream beat matching.
    loudest_ts_ns: u64,
    loudest_amp: f32,
    summed_amp: f32,
    max_confidence: f32,
    /// Centroid of the loudest onset (most musically representative).
    centroid: f32,
}

impl PendingCluster {
    fn from_onset(o: Onset) -> Self {
        Self {
            first_ts_ns: o.ts_ns,
            loudest_ts_ns: o.ts_ns,
            loudest_amp: o.amplitude,
            summed_amp: o.amplitude,
            max_confidence: o.confidence,
            centroid: o.centroid,
        }
    }
    fn merge(&mut self, o: Onset) {
        self.summed_amp = (self.summed_amp + o.amplitude).min(1.0);
        if o.amplitude > self.loudest_amp {
            self.loudest_amp = o.amplitude;
            self.loudest_ts_ns = o.ts_ns;
            self.centroid = o.centroid;
        }
        if o.confidence > self.max_confidence {
            self.max_confidence = o.confidence;
        }
    }
    fn flush(self) -> Onset {
        Onset {
            ts_ns: self.loudest_ts_ns,
            amplitude: self.summed_amp.clamp(0.0, 1.0),
            centroid: self.centroid,
            confidence: self.max_confidence,
        }
    }
}

impl Drop for OnsetDetector {
    fn drop(&mut self) {
        self.stop();
    }
}

pub type SharedOnsetDetector = Arc<Mutex<OnsetDetector>>;

pub fn create_shared_onset_detector() -> SharedOnsetDetector {
    Arc::new(Mutex::new(OnsetDetector::new()))
}

// ---------------------------------------------------------------------------
// D2 unit tests — tempo context arithmetic + chord cluster merging.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f32, b: f32, eps: f32) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn tempo_context_subdivision_interval_120_quarters() {
        let ctx = TempoContext::new(120, 1);
        // 60_000 / 120 = 500ms per quarter.
        assert!(approx_eq(ctx.subdivision_interval_ms(), 500.0, 0.01));
    }

    #[test]
    fn tempo_context_subdivision_interval_200_sixteenths() {
        let ctx = TempoContext::new(200, 4);
        // 60_000 / 200 / 4 = 75ms per 16th.
        assert!(approx_eq(ctx.subdivision_interval_ms(), 75.0, 0.01));
    }

    #[test]
    fn tempo_context_live_updates() {
        let ctx = TempoContext::new(120, 1);
        ctx.set_bpm(60);
        // 60 BPM quarter = 1000ms.
        assert!(approx_eq(ctx.subdivision_interval_ms(), 1000.0, 0.01));
        ctx.set_subdivision(2);
        // 60 BPM 8ths = 500ms.
        assert!(approx_eq(ctx.subdivision_interval_ms(), 500.0, 0.01));
    }

    #[test]
    fn tempo_context_subdivision_floor_is_one() {
        // We never want a divide-by-zero on subdivision; setter clamps to ≥1.
        let ctx = TempoContext::new(120, 1);
        ctx.set_subdivision(0);
        // Behaves as if subdivision = 1.
        assert!(approx_eq(ctx.subdivision_interval_ms(), 500.0, 0.01));
    }

    #[test]
    fn tempo_context_zero_bpm_returns_safe_default() {
        // Defensive: BPM should never legitimately be 0, but if it
        // somehow lands there we hand back a 500ms beat instead of NaN.
        let ctx = TempoContext::new(120, 1);
        ctx.bpm_x100.store(0, Ordering::Relaxed);
        assert!(approx_eq(ctx.subdivision_interval_ms(), 500.0, 0.01));
    }

    #[test]
    fn refractory_factor_constant_matches_plan() {
        // Plan-locked: 0.35 of subdivision interval is the "musical" knee
        // between "too eager" and "blocking legit fast runs."
        assert!(approx_eq(REFRACTORY_SUBDIVISION_FACTOR, 0.35, 1e-6));
    }

    fn mk_onset(ts_ns: u64, amp: f32, centroid: f32, conf: f32) -> Onset {
        Onset {
            ts_ns,
            amplitude: amp,
            centroid,
            confidence: conf,
        }
    }

    #[test]
    fn pending_cluster_first_onset_seeds_all_fields() {
        let c = PendingCluster::from_onset(mk_onset(100, 0.4, 1200.0, 0.6));
        assert_eq!(c.first_ts_ns, 100);
        assert_eq!(c.loudest_ts_ns, 100);
        assert!(approx_eq(c.loudest_amp, 0.4, 1e-6));
        assert!(approx_eq(c.summed_amp, 0.4, 1e-6));
        assert!(approx_eq(c.max_confidence, 0.6, 1e-6));
        assert!(approx_eq(c.centroid, 1200.0, 1e-6));
    }

    #[test]
    fn pending_cluster_louder_followup_steals_timestamp_and_centroid() {
        let mut c = PendingCluster::from_onset(mk_onset(100, 0.3, 800.0, 0.4));
        c.merge(mk_onset(105, 0.5, 1800.0, 0.7)); // louder
        assert_eq!(c.loudest_ts_ns, 105);
        assert!(approx_eq(c.loudest_amp, 0.5, 1e-6));
        assert!(approx_eq(c.centroid, 1800.0, 1e-6));
        // Summed amp accumulates.
        assert!(approx_eq(c.summed_amp, 0.8, 1e-6));
        // Confidence takes the max.
        assert!(approx_eq(c.max_confidence, 0.7, 1e-6));
    }

    #[test]
    fn pending_cluster_quieter_followup_keeps_lead() {
        let mut c = PendingCluster::from_onset(mk_onset(100, 0.6, 2000.0, 0.8));
        c.merge(mk_onset(110, 0.2, 600.0, 0.4));
        // Lead onset still owns timestamp + centroid.
        assert_eq!(c.loudest_ts_ns, 100);
        assert!(approx_eq(c.centroid, 2000.0, 1e-6));
        // But the summed amplitude still grows.
        assert!(approx_eq(c.summed_amp, 0.8, 1e-6));
        // And confidence stays at the higher value.
        assert!(approx_eq(c.max_confidence, 0.8, 1e-6));
    }

    #[test]
    fn pending_cluster_summed_amp_clamped_to_one() {
        let mut c = PendingCluster::from_onset(mk_onset(100, 0.8, 500.0, 0.5));
        c.merge(mk_onset(105, 0.5, 500.0, 0.5));
        // Would be 1.3, must clamp to 1.0.
        assert!(approx_eq(c.summed_amp, 1.0, 1e-6));
        let out = c.flush();
        assert!(out.amplitude <= 1.0);
    }

    #[test]
    fn pending_cluster_flush_returns_lead_timestamp() {
        let mut c = PendingCluster::from_onset(mk_onset(100, 0.3, 1000.0, 0.5));
        c.merge(mk_onset(120, 0.7, 1500.0, 0.9)); // new loudest
        let out = c.flush();
        // Output uses loudest's timestamp + centroid + max confidence.
        assert_eq!(out.ts_ns, 120);
        assert!(approx_eq(out.centroid, 1500.0, 1e-6));
        assert!(approx_eq(out.confidence, 0.9, 1e-6));
    }
}
