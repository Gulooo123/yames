//! Per-instrument calibration cache (DSP & Coach plan §"Per-instrument
//! calibration cache" + OQ10).
//!
//! Stores the auto-calibration offset that the timing analyzer learns
//! during a session, keyed on `(instrument_id, audio_device)`. Skipping
//! the ~8-beat re-convergence period for a familiar gear combo is the
//! whole point: a user who plays bass through their Scarlett every day
//! shouldn't relearn the same ~30ms latency offset on every session
//! start.
//!
//! ## Eviction policy
//!
//! OQ10's recommendation is **30-day TTL + explicit recalibrate button**.
//! Hardware can drift, drivers update, OS changes alter the audio path;
//! a month is roughly "longer than the user remembers, shorter than
//! anything plausibly changed." The recalibrate button is the escape
//! hatch when something does change before the TTL expires.
//!
//! Lookups silently skip entries older than 30 days — they're not
//! deleted on read (that'd require a write lock on every session
//! start). A background sweep on app startup handles eviction so the
//! store doesn't accumulate dead entries indefinitely.
//!
//! ## Confidence
//!
//! We only persist entries whose calibration converged to confidence
//! >= 0.95. Below that the offset isn't trustworthy enough to short-
//! circuit a future session's convergence period — better to relearn
//! than to anchor on noise.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// 30-day TTL in seconds. Past this, a cached entry is ignored on
/// lookup and swept on startup.
pub const CALIBRATION_TTL_SECS: u64 = 30 * 24 * 60 * 60;

/// Minimum confidence required to PERSIST an entry. Lower-confidence
/// values aren't worth caching — relearning is cheap, but anchoring
/// onto noise is expensive (the next session inherits a bad offset).
///
/// In practice the timing analyzer only fires the convergence callback
/// when the running-median buffer is fully refilled with real samples
/// (confidence == 1.0), so this is always satisfied; the constant is
/// used by `persist_to_store` to filter out low-confidence entries
/// before writing to disk.
pub const PERSIST_CONFIDENCE_THRESHOLD: f64 = 0.95;

/// One cached `(instrument, device)` calibration entry.
///
/// `last_updated_secs` is unix epoch seconds; we compare against
/// `SystemTime::now()` for TTL eviction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CalibrationEntry {
    /// The converged calibration offset in milliseconds. Same units as
    /// `BeatFeedback.calibration_offset_ms` (raw_offset - learned offset).
    pub offset_ms: f64,
    /// Confidence at the time of persistence (0.0..=1.0). Only persisted
    /// when ≥ `PERSIST_CONFIDENCE_THRESHOLD`.
    pub confidence: f64,
    /// Unix epoch seconds the entry was written.
    pub last_updated_secs: u64,
}

/// In-memory cache keyed on `(instrument_id, device_name)`. The instrument
/// id matches `Instrument::id()` (kebab-case); the device name matches
/// whatever cpal returned for the active input device.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CalibrationCache {
    /// Flat list for serialization friendliness. We index into it via
    /// `lookup` so lookups are O(n) — n is small (one entry per
    /// instrument × device combo the user has tried, realistically
    /// under 20).
    pub entries: Vec<CachedPair>,
}

/// One entry in the on-disk cache. Flattened so the JSON shape is
/// stable when we add fields (additive only — never rename).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CachedPair {
    pub instrument_id: String,
    pub device_name: String,
    pub entry: CalibrationEntry,
}

impl CalibrationCache {
    /// Look up the cached offset for an `(instrument, device)` pair.
    /// Returns `None` when the pair isn't cached OR when the entry has
    /// expired past the 30-day TTL.
    pub fn lookup(&self, instrument_id: &str, device_name: &str) -> Option<&CalibrationEntry> {
        let now = now_secs();
        self.entries
            .iter()
            .find(|p| p.instrument_id == instrument_id && p.device_name == device_name)
            .map(|p| &p.entry)
            .filter(|entry| now.saturating_sub(entry.last_updated_secs) < CALIBRATION_TTL_SECS)
    }

    /// Write a calibration result for `(instrument, device)`. Replaces
    /// any prior entry for the same pair. Caller is expected to gate on
    /// `confidence >= PERSIST_CONFIDENCE_THRESHOLD`; we don't re-check
    /// here because the timing-analysis thread has more context (e.g.
    /// "the cached value matches what we just learned, no need to
    /// rewrite").
    pub fn insert(
        &mut self,
        instrument_id: String,
        device_name: String,
        offset_ms: f64,
        confidence: f64,
    ) {
        let now = now_secs();
        let entry = CalibrationEntry {
            offset_ms,
            confidence,
            last_updated_secs: now,
        };
        if let Some(existing) = self
            .entries
            .iter_mut()
            .find(|p| p.instrument_id == instrument_id && p.device_name == device_name)
        {
            existing.entry = entry;
        } else {
            self.entries.push(CachedPair {
                instrument_id,
                device_name,
                entry,
            });
        }
    }

    /// Forget the cached calibration for a specific `(instrument, device)`
    /// pair — wired to the "Recalibrate" button in Settings. The next
    /// session for that pair re-converges from scratch.
    pub fn clear(&mut self, instrument_id: &str, device_name: &str) {
        self.entries
            .retain(|p| !(p.instrument_id == instrument_id && p.device_name == device_name));
    }

    /// Forget everything. Exposed for tests and for the "factory reset"
    /// settings option (not surfaced in UI yet but useful for support).
    #[allow(dead_code)]
    pub fn clear_all(&mut self) {
        self.entries.clear();
    }

    /// Drop entries older than 30 days. Called on app startup so the
    /// on-disk store doesn't accumulate stale entries from instruments
    /// the user no longer plays. Returns the number of evicted entries
    /// for logging.
    pub fn evict_expired(&mut self) -> usize {
        let now = now_secs();
        let before = self.entries.len();
        self.entries
            .retain(|p| now.saturating_sub(p.entry.last_updated_secs) < CALIBRATION_TTL_SECS);
        before - self.entries.len()
    }
}

/// Current unix epoch seconds. Falls back to 0 on the (effectively
/// impossible) clock-before-epoch case so we don't panic.
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub type SharedCalibrationCache = Arc<Mutex<CalibrationCache>>;

pub fn create_shared_calibration_cache() -> SharedCalibrationCache {
    Arc::new(Mutex::new(CalibrationCache::default()))
}

/// Persist the current cache snapshot into the `settings.json` store.
/// Best-effort — a failure here is logged but never bubbled. The in-
/// memory cache stays authoritative until the next launch.
///
/// Only entries whose `confidence >= PERSIST_CONFIDENCE_THRESHOLD` are
/// written to disk — low-confidence offsets aren't trustworthy enough
/// to bootstrap a future session and are silently dropped here.
pub fn persist_to_store(cache: &CalibrationCache, app_handle: &tauri::AppHandle) {
    use tauri_plugin_store::StoreExt;
    // Filter to entries that met the confidence threshold before
    // serializing. The in-memory cache is unchanged — only the
    // on-disk snapshot is restricted.
    let to_persist = CalibrationCache {
        entries: cache
            .entries
            .iter()
            .filter(|p| p.entry.confidence >= PERSIST_CONFIDENCE_THRESHOLD)
            .cloned()
            .collect(),
    };
    if let Ok(store) = app_handle.store("settings.json") {
        match serde_json::to_value(&to_persist) {
            Ok(json) => {
                store.set("calibrationCache", json);
            }
            Err(e) => {
                eprintln!("[calibration_cache] failed to serialize: {e}");
            }
        }
    }
}

/// Hydrate the cache from `settings.json` at app startup. Returns the
/// number of expired entries evicted (logged by the caller for
/// diagnostics). Silent no-op if the store is unreachable or the key
/// is absent — first launch is the common case.
pub fn load_from_store(app_handle: &tauri::AppHandle) -> CalibrationCache {
    use tauri_plugin_store::StoreExt;
    let mut cache = match app_handle.store("settings.json") {
        Ok(store) => match store.get("calibrationCache") {
            Some(v) => serde_json::from_value::<CalibrationCache>(v).unwrap_or_default(),
            None => CalibrationCache::default(),
        },
        Err(_) => CalibrationCache::default(),
    };
    let evicted = cache.evict_expired();
    if evicted > 0 {
        eprintln!(
            "[calibration_cache] evicted {} expired entries on startup",
            evicted
        );
        // Write back the trimmed cache so the next launch doesn't redo
        // this work. Best-effort.
        persist_to_store(&cache, app_handle);
    }
    cache
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(offset: f64, age_secs: u64) -> CalibrationEntry {
        CalibrationEntry {
            offset_ms: offset,
            confidence: 0.98,
            last_updated_secs: now_secs().saturating_sub(age_secs),
        }
    }

    #[test]
    fn lookup_misses_for_unknown_pair() {
        let cache = CalibrationCache::default();
        assert!(cache.lookup("bass", "Scarlett 2i2").is_none());
    }

    #[test]
    fn insert_then_lookup_roundtrips() {
        let mut cache = CalibrationCache::default();
        cache.insert("bass".into(), "Scarlett".into(), 25.0, 0.97);
        let hit = cache.lookup("bass", "Scarlett").expect("must hit");
        assert!((hit.offset_ms - 25.0).abs() < 1e-9);
        assert!((hit.confidence - 0.97).abs() < 1e-9);
    }

    #[test]
    fn insert_replaces_existing_pair() {
        let mut cache = CalibrationCache::default();
        cache.insert("bass".into(), "Scarlett".into(), 25.0, 0.97);
        cache.insert("bass".into(), "Scarlett".into(), 32.0, 0.99);
        let hit = cache.lookup("bass", "Scarlett").expect("must hit");
        assert!((hit.offset_ms - 32.0).abs() < 1e-9);
        // Only one entry should exist.
        assert_eq!(cache.entries.len(), 1);
    }

    #[test]
    fn lookup_skips_expired_entries() {
        let mut cache = CalibrationCache::default();
        cache.entries.push(CachedPair {
            instrument_id: "bass".into(),
            device_name: "Scarlett".into(),
            entry: entry(25.0, CALIBRATION_TTL_SECS + 60), // 1 min past TTL
        });
        assert!(cache.lookup("bass", "Scarlett").is_none());
    }

    #[test]
    fn evict_drops_expired_only() {
        let mut cache = CalibrationCache::default();
        cache.entries.push(CachedPair {
            instrument_id: "bass".into(),
            device_name: "Scarlett".into(),
            entry: entry(25.0, CALIBRATION_TTL_SECS + 60),
        });
        cache.entries.push(CachedPair {
            instrument_id: "drums".into(),
            device_name: "MacBook Mic".into(),
            entry: entry(8.0, 100),
        });
        let evicted = cache.evict_expired();
        assert_eq!(evicted, 1);
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.entries[0].instrument_id, "drums");
    }

    #[test]
    fn clear_targets_one_pair() {
        let mut cache = CalibrationCache::default();
        cache.insert("bass".into(), "A".into(), 25.0, 0.97);
        cache.insert("bass".into(), "B".into(), 30.0, 0.97);
        cache.insert("drums".into(), "A".into(), 5.0, 0.97);
        cache.clear("bass", "A");
        assert!(cache.lookup("bass", "A").is_none());
        // Same instrument on a different device survives.
        assert!(cache.lookup("bass", "B").is_some());
        // Different instrument on the cleared device survives.
        assert!(cache.lookup("drums", "A").is_some());
    }

    #[test]
    fn different_devices_share_instrument_independently() {
        let mut cache = CalibrationCache::default();
        cache.insert("bass".into(), "MacBook Mic".into(), 10.0, 0.97);
        cache.insert("bass".into(), "Scarlett".into(), 25.0, 0.97);
        let macbook = cache.lookup("bass", "MacBook Mic").unwrap();
        let scarlett = cache.lookup("bass", "Scarlett").unwrap();
        assert_ne!(macbook.offset_ms, scarlett.offset_ms);
    }

    #[test]
    fn serializes_round_trip() {
        let mut cache = CalibrationCache::default();
        cache.insert("bass".into(), "Scarlett".into(), 25.0, 0.97);
        let json = serde_json::to_string(&cache).expect("serialize");
        let parsed: CalibrationCache = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed.entries, cache.entries);
    }
}
