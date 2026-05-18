use crate::audio_input::{AudioDevice, SharedAudioInput};
use crate::coach::SharedCoachEngine;
use crate::engine::MetronomeEngine;
use crate::instrument::Instrument;
use crate::midi::{MidiBinding, MidiDeviceInfo, MidiMsgType, SharedMidi};
use crate::onset::{SharedOnsetDetector, SharedTempoContext};
use crate::session::{SessionReport, SharedSessionAccumulator};
use crate::state::{AppState, SharedState};
use crate::timing::SharedTimingAnalyzer;
use crate::tts::{SharedTts, SharedTtsDim};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct EngineState(pub Mutex<MetronomeEngine>);

/// Snapshot the current AppState and emit it on the `state-changed`
/// event. Lock is dropped before the emit so the (synchronous-but-not-
/// instant) serde serialization can't block any other thread waiting on
/// the same mutex. Mirrors the emit-after-drop pattern used throughout
/// the metronome tick thread in `engine.rs`.
fn emit_state_changed(state: &SharedState, app_handle: &AppHandle) {
    let snapshot = state.lock().unwrap().clone();
    let _ = app_handle.emit("state-changed", &snapshot);
}

/// Persist the current AppState to the store (minus is_playing which is transient).
fn persist_state(state: &SharedState, app_handle: &AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        let s = state.lock().unwrap();
        store.set("bpm", serde_json::json!(s.bpm));
        store.set("subdivision", serde_json::json!(s.subdivision));
        store.set("mode", serde_json::json!(s.mode));
        store.set("corner", serde_json::json!(s.corner));
        store.set("alwaysOnTop", serde_json::json!(s.always_on_top));
        store.set("widgetAlwaysOnTop", serde_json::json!(s.widget_always_on_top));
        store.set("accentColor", serde_json::json!(s.accent_color));
        store.set("theme", serde_json::json!(s.theme));
        store.set("volume", serde_json::json!(s.volume));
        store.set("soundType", serde_json::json!(s.sound_type));
        store.set("timeSignature", serde_json::json!(s.time_signature));
        store.set("speedRamp", serde_json::json!({
            "startBpm": s.speed_ramp.start_bpm,
            "targetBpm": s.speed_ramp.target_bpm,
            "increment": s.speed_ramp.increment,
            "decrement": s.speed_ramp.decrement,
            "barsPerStep": s.speed_ramp.bars_per_step,
            "beatsPerBar": s.speed_ramp.beats_per_bar,
            "mode": s.speed_ramp.mode,
            "cyclic": s.speed_ramp.cyclic,
        }));
        store.set("instrument", serde_json::json!(s.instrument.id()));
    }
}

#[tauri::command]
pub fn get_state(state: State<SharedState>) -> AppState {
    state.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_bpm(
    bpm: u16,
    state: State<SharedState>,
    tempo_ctx: State<SharedTempoContext>,
    app_handle: AppHandle,
) {
    let clamped = bpm.clamp(20, 300);
    {
        let mut s = state.lock().unwrap();
        s.bpm = clamped;
    }
    // D2 — keep the onset detector's live tempo view in sync so its
    // adaptive refractory window tracks the current grid immediately
    // (no need to wait for the next start_evaluation).
    tempo_ctx.set_bpm(clamped);
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_subdivision(
    subdivision: u8,
    state: State<SharedState>,
    tempo_ctx: State<SharedTempoContext>,
    app_handle: AppHandle,
) {
    let valid = subdivision.clamp(1, 6);
    {
        let mut s = state.lock().unwrap();
        s.subdivision = valid;
    }
    // D2 — mirror into the shared tempo context (see set_bpm).
    tempo_ctx.set_subdivision(valid);
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn toggle_playback(
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    let is_playing = {
        let s = state.lock().unwrap();
        s.is_playing
    };

    let mut engine = engine_state.0.lock().unwrap();

    if is_playing {
        engine.stop();
        let mut s = state.lock().unwrap();
        s.is_playing = false;
    } else {
        engine.start(state.inner().clone(), app_handle.clone());
        let mut s = state.lock().unwrap();
        s.is_playing = true;
    }

    emit_state_changed(&state, &app_handle);
}

#[tauri::command]
pub fn set_playing(
    playing: bool,
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    let mut engine = engine_state.0.lock().unwrap();

    if playing && !engine.is_running() {
        engine.start(state.inner().clone(), app_handle.clone());
        let mut s = state.lock().unwrap();
        s.is_playing = true;
    } else if !playing && engine.is_running() {
        engine.stop();
        let mut s = state.lock().unwrap();
        s.is_playing = false;
    }

    emit_state_changed(&state, &app_handle);
}

#[tauri::command]
pub fn set_widget_mode(mode: String, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.mode = mode;
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_always_on_top(enabled: bool, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.always_on_top = enabled;
    }
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.set_always_on_top(enabled);
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_widget_always_on_top(enabled: bool, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.widget_always_on_top = enabled;
    }
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.set_always_on_top(enabled);
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn show_main(app_handle: AppHandle, state: State<SharedState>) {
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.hide();
    }
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let aot = state.lock().unwrap().always_on_top;
        let _ = main_win.set_always_on_top(aot);
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("lastWindow", serde_json::json!("main"));
    }
}

#[tauri::command]
pub fn show_floating(app_handle: AppHandle) {
    if let Some(main_win) = app_handle.get_webview_window("main") {
        let _ = main_win.hide();
    }
    if let Some(float_win) = app_handle.get_webview_window("floating") {
        let _ = float_win.show();
    }
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("lastWindow", serde_json::json!("floating"));
    }
}

#[tauri::command]
pub fn set_theme(theme: String, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.theme = theme;
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

/// Update the selected instrument. Accepts the kebab-case ids used by the
/// React dropdown (`"drums"`, `"electric-guitar"`, …); unknown ids fall
/// back to `Instrument::Other` for forward compatibility.
///
/// The new instrument's `InstrumentProfile` becomes effective for the
/// *next* DSP segment — current detection-loop state is not rewound mid-
/// segment (per the plan's "multi-instrument users" rule).
#[tauri::command]
pub fn set_instrument(instrument: String, state: State<SharedState>, app_handle: AppHandle) {
    {
        let mut s = state.lock().unwrap();
        s.instrument = Instrument::from_id(&instrument);
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_volume(
    volume: f32,
    state: State<SharedState>,
    dim_state: State<SharedTtsDim>,
    app_handle: AppHandle,
) {
    let clamped = volume.clamp(0.0, 1.0);
    {
        // Hold `dim` first to match the lock order used in `tts_speak`
        // (dim → state). If a TTS dim is currently active, `dim_user_set`
        // updates the captured "original" so the eventual `dim_exit`
        // restores the user's NEW intent instead of the stale pre-TTS
        // value — otherwise dragging the slider mid-speech got stomped
        // when the speech ended.
        let mut dim = dim_state.lock().unwrap();
        let mut s = state.lock().unwrap();
        crate::tts::dim_user_set(&mut dim, clamped);
        s.volume = clamped;
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn save_window_position(label: String, x: i32, y: i32, app_handle: AppHandle) {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").unwrap();
    let key = format!("window_position_{}", label);
    store.set(key, serde_json::json!({ "x": x, "y": y }));
}

#[tauri::command]
pub fn set_sound_type(sound_type: String, state: State<SharedState>, app_handle: AppHandle) {
    let valid = match sound_type.as_str() {
        "click" | "wood" | "beep" | "drum" => sound_type,
        _ => "click".to_string(),
    };
    {
        let mut s = state.lock().unwrap();
        s.sound_type = valid;
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn set_time_signature(time_signature: u8, state: State<SharedState>, app_handle: AppHandle) {
    let valid = match time_signature {
        0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 => time_signature,
        _ => 4,
    };
    {
        let mut s = state.lock().unwrap();
        s.time_signature = valid;
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn configure_speed_ramp(
    start_bpm: u16,
    target_bpm: u16,
    increment: u16,
    decrement: u16,
    bars_per_step: u8,
    beats_per_bar: u8,
    mode: String,
    cyclic: bool,
    warmup_beats: u8,
    aggressiveness: Option<String>,
    state: State<SharedState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.start_bpm = start_bpm.clamp(20, 300);
        s.speed_ramp.target_bpm = target_bpm.clamp(s.speed_ramp.start_bpm, 300);
        s.speed_ramp.increment = increment.clamp(1, 50);
        s.speed_ramp.decrement = decrement.clamp(1, 50);
        s.speed_ramp.bars_per_step = bars_per_step.clamp(1, 32);
        s.speed_ramp.beats_per_bar = beats_per_bar.clamp(1, 12);
        s.speed_ramp.mode = match mode.as_str() {
            "linear" | "zigzag" | "adaptive" => mode,
            _ => "linear".to_string(),
        };
        s.speed_ramp.cyclic = cyclic;
        s.speed_ramp.warmup_beats = warmup_beats.clamp(0, 8);
        s.speed_ramp.aggressiveness = match aggressiveness.as_deref() {
            Some("conservative") => "conservative".to_string(),
            Some("aggressive") => "aggressive".to_string(),
            _ => "moderate".to_string(),
        };
    }
    emit_state_changed(&state, &app_handle);
    persist_state(&state, &app_handle);
}

#[tauri::command]
pub fn start_speed_ramp(
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.active = true;
        s.speed_ramp.current_step = 0;
        s.speed_ramp.current_bpm = s.speed_ramp.start_bpm;
        s.speed_ramp.direction = "up".to_string();
        s.speed_ramp.bars_in_step = 0;
        s.speed_ramp.completed = false;
        s.speed_ramp.warmup_count = 0;
        // Don't touch s.bpm — ramp uses its own current_bpm
        s.is_playing = true;
    }
    {
        let mut engine = engine_state.0.lock().unwrap();
        engine.start(state.inner().clone(), app_handle.clone());
    }
    emit_state_changed(&state, &app_handle);
}

#[tauri::command]
pub fn start_speed_ramp_from(
    step: u16,
    bpm: u16,
    bar: u8,
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.active = true;
        s.speed_ramp.current_step = step;
        s.speed_ramp.current_bpm = bpm.clamp(20, 300);
        s.speed_ramp.direction = if bpm >= s.speed_ramp.target_bpm { "down".to_string() } else { "up".to_string() };
        s.speed_ramp.bars_in_step = bar;
        s.speed_ramp.completed = false;
        s.speed_ramp.warmup_count = 0;
        // Don't touch s.bpm — ramp uses its own current_bpm
        s.is_playing = true;
    }
    {
        let mut engine = engine_state.0.lock().unwrap();
        engine.start(state.inner().clone(), app_handle.clone());
    }
    emit_state_changed(&state, &app_handle);
}

#[tauri::command]
pub fn stop_speed_ramp(
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    {
        let mut s = state.lock().unwrap();
        s.speed_ramp.active = false;
        s.is_playing = false;
    }
    {
        let mut engine = engine_state.0.lock().unwrap();
        engine.stop();
    }
    emit_state_changed(&state, &app_handle);
}

#[tauri::command]
pub fn set_adaptive_decision(
    decision: String,
    engine_state: State<EngineState>,
) {
    use crate::engine::{DECISION_UP, DECISION_HOLD, DECISION_DOWN};
    let val = match decision.as_str() {
        "up" => DECISION_UP,
        "hold" => DECISION_HOLD,
        "down" => DECISION_DOWN,
        _ => return,
    };
    let engine = engine_state.0.lock().unwrap();
    engine.adaptive_model_decision().store(val, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub fn set_active_tab(tab: String, app_handle: AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("activeTab", serde_json::json!(tab));
    }
}

#[tauri::command]
pub fn get_active_tab(app_handle: AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        if let Some(v) = store.get("activeTab").and_then(|v| v.as_str().map(String::from)) {
            return v;
        }
    }
    "beat".to_string()
}

#[tauri::command]
pub fn set_calibration_offset(offset: f64, app_handle: AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("calibrationOffset", serde_json::json!(offset));
    }
}

#[tauri::command]
pub fn get_calibration_offset(app_handle: AppHandle) -> Option<f64> {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        if let Some(v) = store.get("calibrationOffset").and_then(|v| v.as_f64()) {
            return Some(v);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Per-instrument calibration cache commands (DSP plan §"Per-instrument
// calibration cache"). The cache itself is owned by `SharedCalibrationCache`
// state; these commands surface read / clear / list operations to the UI so
// users can inspect what's been calibrated and force a recalibration when
// hardware changes mid-TTL.
// ---------------------------------------------------------------------------

/// Returns the cached calibration entry for the current `(instrument,
/// device)` pair (or `None`). Used by the Settings UI to render a
/// "Calibrated for this gear" hint.
#[tauri::command]
pub fn get_calibration_cache_entry(
    instrument_id: String,
    device_name: Option<String>,
    cal_cache: State<'_, crate::calibration_cache::SharedCalibrationCache>,
) -> Option<crate::calibration_cache::CalibrationEntry> {
    let key = device_name.unwrap_or_else(|| "default".to_string());
    cal_cache.lock().unwrap().lookup(&instrument_id, &key).cloned()
}

/// Forget the cached calibration for one `(instrument, device)` pair
/// — wired to the "Recalibrate" button. The next evaluation session
/// for the pair re-converges from cold.
#[tauri::command]
pub fn clear_calibration_cache_entry(
    instrument_id: String,
    device_name: Option<String>,
    cal_cache: State<'_, crate::calibration_cache::SharedCalibrationCache>,
    app_handle: AppHandle,
) {
    let key = device_name.unwrap_or_else(|| "default".to_string());
    let mut cache = cal_cache.lock().unwrap();
    cache.clear(&instrument_id, &key);
    crate::calibration_cache::persist_to_store(&cache, &app_handle);
}

/// Snapshot every cached entry. Used by support tooling and Settings'
/// "show me what's cached" dev panel (not surfaced yet but cheap to
/// expose now so we don't need a future schema migration).
#[tauri::command]
pub fn list_calibration_cache(
    cal_cache: State<'_, crate::calibration_cache::SharedCalibrationCache>,
) -> Vec<crate::calibration_cache::CachedPair> {
    cal_cache.lock().unwrap().entries.clone()
}

#[tauri::command]
pub fn open_url(url: String) {
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(&url).spawn(); }
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(&url).spawn(); }
}

// ---------------------------------------------------------------------------
// MIDI Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_midi_devices(midi: State<SharedMidi>) -> Vec<MidiDeviceInfo> {
    let listener = midi.lock().unwrap();
    listener.list_devices()
}

#[tauri::command]
pub fn connect_midi_device(
    device_name: String,
    midi: State<SharedMidi>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let listener = midi.lock().unwrap();
    listener.connect(&device_name, app_handle.clone())?;
    // Persist connected device
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.set("midiDevice", serde_json::json!(device_name));
    }
    Ok(())
}

#[tauri::command]
pub fn disconnect_midi_device(midi: State<SharedMidi>, app_handle: AppHandle) -> Result<(), String> {
    let listener = midi.lock().unwrap();
    listener.disconnect();
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        store.delete("midiDevice");
    }
    Ok(())
}

#[tauri::command]
pub fn set_midi_binding(
    action: String,
    channel: Option<u8>,
    msg_type: String,
    number: u8,
    midi: State<SharedMidi>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mt = match msg_type.as_str() {
        "cc" => MidiMsgType::ControlChange,
        "note" => MidiMsgType::NoteOn,
        "pc" => MidiMsgType::ProgramChange,
        _ => return Err("Invalid msg_type: must be 'cc', 'note', or 'pc'".to_string()),
    };
    let binding = MidiBinding {
        action,
        channel,
        msg_type: mt,
        number,
    };
    let listener = midi.lock().unwrap();
    listener.add_binding(binding);
    // Persist bindings
    persist_midi_bindings(&listener, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn clear_midi_binding(
    action: String,
    midi: State<SharedMidi>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let listener = midi.lock().unwrap();
    listener.remove_binding(&action);
    persist_midi_bindings(&listener, &app_handle);
    Ok(())
}

#[tauri::command]
pub fn get_midi_bindings(midi: State<SharedMidi>) -> Vec<MidiBinding> {
    let listener = midi.lock().unwrap();
    listener.get_bindings()
}

fn persist_midi_bindings(listener: &crate::midi::MidiListener, app_handle: &AppHandle) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        let bindings = listener.get_bindings();
        store.set("midiBindings", serde_json::json!(bindings));
    }
}

// ---------------------------------------------------------------------------
// Preset Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_presets(app_handle: AppHandle) -> Vec<serde_json::Value> {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        if let Some(val) = store.get("presets") {
            if let Some(arr) = val.as_array() {
                return arr.clone();
            }
        }
    }
    Vec::new()
}

#[tauri::command]
pub fn save_preset(preset: serde_json::Value, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let id = preset.get("id").and_then(|v| v.as_str()).ok_or("preset must have an id")?;
    let mut presets: Vec<serde_json::Value> = store
        .get("presets")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    // Update existing or append new
    if let Some(pos) = presets.iter().position(|p| p.get("id").and_then(|v| v.as_str()) == Some(id)) {
        presets[pos] = preset;
    } else {
        presets.push(preset);
    }

    store.set("presets", serde_json::json!(presets));
    Ok(())
}

#[tauri::command]
pub fn delete_preset(id: String, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let mut presets: Vec<serde_json::Value> = store
        .get("presets")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    presets.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(&id));
    store.set("presets", serde_json::json!(presets));
    Ok(())
}

#[tauri::command]
pub fn reorder_presets(ids: Vec<String>, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let presets: Vec<serde_json::Value> = store
        .get("presets")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    let mut reordered: Vec<serde_json::Value> = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(p) = presets.iter().find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id)) {
            reordered.push(p.clone());
        }
    }
    store.set("presets", serde_json::json!(reordered));
    Ok(())
}

// ---------------------------------------------------------------------------
// Audio Input / Evaluation Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_audio_input_devices() -> Vec<AudioDevice> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::audio_input::AudioInput::list_devices()
    }).await.unwrap_or_default()
}

#[tauri::command]
pub async fn start_evaluation(
    device_name: Option<String>,
    audio_input: State<'_, SharedAudioInput>,
    onset_detector: State<'_, SharedOnsetDetector>,
    timing_analyzer: State<'_, SharedTimingAnalyzer>,
    session_acc: State<'_, SharedSessionAccumulator>,
    engine_state: State<'_, EngineState>,
    midi: State<'_, SharedMidi>,
    state: State<'_, SharedState>,
    tempo_ctx: State<'_, SharedTempoContext>,
    cal_cache: State<'_, crate::calibration_cache::SharedCalibrationCache>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Stop any existing evaluation first (idempotent — prevents deadlock if called twice)
    {
        let listener = midi.lock().unwrap();
        listener.clear_onset_callback();
    }
    onset_detector.lock().unwrap().stop();
    timing_analyzer.lock().unwrap().stop();

    let mut ai = audio_input.lock().unwrap();
    ai.start(device_name.as_deref(), app_handle.clone())?;

    // Clear previous session data + stamp the session start so the D1
    // diagnostic log (saved at stop) has a stable epoch.
    {
        let mut acc = session_acc.lock().unwrap();
        acc.clear();
        let (secs, ms) = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| (d.as_secs(), d.as_millis() as u64))
            .unwrap_or((0, 0));
        acc.mark_session_start(secs, ms);
    }

    // Get adaptive score handle from engine for real-time accuracy updates
    let adaptive_score = {
        let engine = engine_state.0.lock().unwrap();
        engine.adaptive_score()
    };

    // Start timing analyzer — emits beat-feedback events and accumulates session data
    let app_for_timing = app_handle.clone();
    let session_for_timing = session_acc.inner().clone();
    // Rolling window for adaptive score: track last N classifications
    let recent_hits = std::sync::Arc::new(std::sync::Mutex::new(Vec::<bool>::with_capacity(32)));
    let recent_hits_for_timing = recent_hits.clone();
    let adaptive_score_for_timing = adaptive_score;
    // D4 — snapshot profile + instrument id for the timing analyzer so
    // its activity state machine uses the right pause tolerance and the
    // Signal-B segment-end events know which instrument was practiced.
    // Mid-session instrument changes will be picked up on the next
    // start_evaluation (we never re-snapshot a live segment).
    let (ta_profile, ta_instrument) = {
        let s = state.lock().unwrap();
        (s.instrument.profile(), s.instrument.id().to_string())
    };
    // No preset tracking on the backend yet — the JS layer owns preset
    // identity. D4 leaves this None and lets the UI annotate the event.
    let ta_preset_id: Option<String> = None;

    // Per-instrument calibration cache (DSP plan §"Per-instrument
    // calibration cache"). Look up the cached `(instrument, device)`
    // offset before the analyzer starts so a familiar combo skips the
    // ~8-beat warmup convergence period. `device_key` is the resolved
    // input device name; we use "default" as a stable key for the OS
    // default device so users who never explicitly pick a device still
    // get a cache.
    let device_key = device_name
        .as_deref()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "default".to_string());
    let initial_calibration_offset_ms = {
        let cache = cal_cache.lock().unwrap();
        cache
            .lookup(&ta_instrument, &device_key)
            .map(|e| e.offset_ms)
    };
    // Write-back path: when the analyzer's session reaches convergence
    // (buffer full of REAL on-device samples) it fires the callback
    // once. We persist to the in-memory cache and to the store. The
    // store write happens on the timing-analysis thread but it's a
    // best-effort no-op on failure — the user already has the in-memory
    // value, so a transient FS error doesn't break the session.
    let cache_shared_for_callback = cal_cache.inner().clone();
    let app_for_cal = app_handle.clone();
    let instrument_for_cal = ta_instrument.clone();
    let device_for_cal = device_key.clone();

    let app_for_segment = app_handle.clone();
    let session_for_segment = session_acc.inner().clone();
    let mut ta = timing_analyzer.lock().unwrap();
    ta.start(
        ta_profile,
        ta_instrument,
        ta_preset_id,
        initial_calibration_offset_ms,
        move |feedback| {
            let _ = app_for_timing.emit("beat-feedback", &feedback);
            // Accumulate for session report
            if let Ok(mut acc) = session_for_timing.lock() {
                acc.push(feedback.clone());
            }
            // Update adaptive score (rolling window of last 16 beats)
            if feedback.classification != "skipped" {
                if let Ok(mut hits) = recent_hits_for_timing.lock() {
                    hits.push(feedback.classification != "miss");
                    if hits.len() > 16 {
                        hits.remove(0);
                    }
                    let total = hits.len() as u32;
                    let hit_count = hits.iter().filter(|&&h| h).count() as u32;
                    let score = if total > 0 { (hit_count * 100) / total } else { 0 };
                    adaptive_score_for_timing
                        .store(score, std::sync::atomic::Ordering::Relaxed);
                }
            }
        },
        move |segment_end| {
            // D4 Signal B — forward to JS so the coach can decide whether
            // to surface a mini-report. The JS side filters by C4's
            // smart-timing gatekeeper.
            let _ = app_for_segment.emit("practice-segment-ended", &segment_end);
            // Also persist into the accumulator so the D1 diagnostic log
            // (written at stop_evaluation) includes the segments timeline.
            if let Ok(mut acc) = session_for_segment.lock() {
                acc.push_segment(crate::session_log::PracticeSegment {
                    start_ms: segment_end.start_ms,
                    end_ms: segment_end.end_ms,
                    start_bpm: segment_end.bpm,
                    end_bpm: segment_end.bpm,
                    score: segment_end.score,
                    component_scores: segment_end.component_scores.clone(),
                    end_reason: segment_end.end_reason,
                    // Path B — propagate the inferred divisor so the D1
                    // diagnostic log records what grid the matcher was
                    // scoring against (essential for debugging "why did
                    // this score this way?" from session_*.json).
                    inferred_divisor: segment_end.inferred_divisor,
                    inferred_divisor_confidence:
                        segment_end.inferred_divisor_confidence,
                });
            }
        },
        move |converged_offset_ms| {
            // Per-instrument calibration cache write-back. Fires once
            // per session, after the buffer fully refills with real
            // device samples (confidence == 1.0). Persist with the
            // explicit 1.0 confidence — the cache only persists at the
            // PERSIST_CONFIDENCE_THRESHOLD or above, which 1.0 clears.
            if let Ok(mut cache) = cache_shared_for_callback.lock() {
                cache.insert(
                    instrument_for_cal.clone(),
                    device_for_cal.clone(),
                    converged_offset_ms,
                    1.0,
                );
                crate::calibration_cache::persist_to_store(&cache, &app_for_cal);
            }
        },
        {
            // Path B — emit divisor-locked / divisor-changed events so
            // the coach UI can render the subtle "Tracking 16ths"
            // caption. The Rust side debounces; this just forwards.
            let app_for_grid = app_handle.clone();
            move |grid: crate::timing::InferredGridChanged| {
                let _ = app_for_grid.emit("inferred-grid-changed", &grid);
            }
        },
    );

    // Start onset detection, forwarding onsets to both Tauri events AND timing analyzer
    let ai_shared = audio_input.inner().clone();
    let app_for_onset = app_handle.clone();
    let ta_shared = timing_analyzer.inner().clone();
    // Snapshot the current instrument's profile so onset detection uses
    // instrument-aware refractory + spectral weighting (D0). Mid-session
    // instrument switches take effect on the next evaluation start; the
    // current segment completes with the original profile per the plan.
    let profile = state.lock().unwrap().instrument.profile();
    // D2 — refresh the tempo context with the live grid before kicking
    // off the detector so the very first hop uses the right refractory
    // window (avoids the "first onset gets a stale 500ms guard" hole).
    {
        let s = state.lock().unwrap();
        tempo_ctx.set_bpm(s.bpm);
        tempo_ctx.set_subdivision(s.subdivision);
    }
    let tempo_for_onset = tempo_ctx.inner().clone();
    let mut od = onset_detector.lock().unwrap();
    od.start(ai_shared, profile, tempo_for_onset, move |onset| {
        let _ = app_for_onset.emit("onset-detected", &onset);
        // Feed into timing analyzer for beat matching
        if let Ok(ta) = ta_shared.lock() {
            ta.log_onset(onset);
        }
    });

    // Set MIDI onset callback — forward NoteOn events as onsets for timing
    let ta_for_midi = timing_analyzer.inner().clone();
    let app_for_midi = app_handle.clone();
    {
        let listener = midi.lock().unwrap();
        listener.set_onset_callback(move |velocity| {
            let onset = crate::onset::Onset {
                ts_ns: crate::clock::now_ns(),
                amplitude: velocity as f32 / 127.0,
                centroid: 0.0, // no spectral info from MIDI
                // MIDI is deterministic — full confidence. (No noise floor
                // or spectral flux to estimate against.)
                confidence: 1.0,
            };
            let _ = app_for_midi.emit("onset-detected", &onset);
            if let Ok(ta) = ta_for_midi.lock() {
                ta.log_onset(onset);
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_evaluation(
    audio_input: State<'_, SharedAudioInput>,
    onset_detector: State<'_, SharedOnsetDetector>,
    timing_analyzer: State<'_, SharedTimingAnalyzer>,
    midi: State<'_, SharedMidi>,
    session_acc: State<'_, SharedSessionAccumulator>,
    state: State<'_, SharedState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Clear MIDI onset callback first (no lock ordering issue)
    {
        let listener = midi.lock().map_err(|e| format!("Lock failed: {e}"))?;
        listener.clear_onset_callback();
    }
    // Stop in reverse-start order: onset_detector → timing_analyzer → audio_input
    // This matches start_evaluation's lock acquisition order to prevent deadlocks
    onset_detector.lock().map_err(|e| format!("Lock failed: {e}"))?.stop();
    // Drain raw telemetry from the timing analyzer BEFORE stop() —
    // actually, drain AFTER stop() so the analyzer thread has fully
    // joined and there's no concurrent push racing the take.
    // `TimingAnalyzer::drain_telemetry()` requires the analyzer to be
    // stopped for that race-free guarantee; `start()` resets the
    // buffer for the next session.
    let telemetry = {
        let mut ta = timing_analyzer
            .lock()
            .map_err(|e| format!("Lock failed: {e}"))?;
        ta.stop();
        ta.drain_telemetry()
    };
    audio_input.lock().map_err(|e| format!("Lock failed: {e}"))?.stop();

    // D1 — persist a diagnostic session log. Best-effort: failures here
    // must never fail the stop path (the user already finished playing,
    // we just lose retroactive debugging data). The log layer auto-prunes
    // to MAX_SESSION_LOGS so disk growth is bounded.
    if let Err(e) =
        persist_session_log(&session_acc, &state, &app_handle, &audio_input, telemetry)
    {
        eprintln!("[D1] failed to persist session log: {e}");
    }
    Ok(())
}

/// Build + save a D1 diagnostic session log from the accumulator state.
/// Returns Ok(()) when the log was saved OR when there was nothing to save
/// (no feedbacks AND no telemetry → an idle stop). Surface errors only
/// for the "we wanted to save but the save itself failed" path.
fn persist_session_log(
    session_acc: &State<'_, SharedSessionAccumulator>,
    state: &State<'_, SharedState>,
    app_handle: &AppHandle,
    audio_input: &State<'_, SharedAudioInput>,
    telemetry: crate::session_log::SessionTelemetry,
) -> Result<(), String> {
    // Snapshot accumulator state under its own lock window, then drop
    // the guard before any IO so we don't hold it across `fs::write`.
    //
    // Read from the FULL-session buffers (`all_feedbacks`/`all_segments`)
    // — not the mini-report window — so the persisted JSON's `report`
    // and `segments` cover the whole session. The window is wiped each
    // time JS fires `clearSession()` between per-segment mini-reports,
    // which used to leave the persisted log with only the last segment's
    // beats (typical artifact: `totalBeats=1, hits=0, score=20`).
    //
    // We still tolerate an empty accumulator: if the user presses End
    // Session right after a segment auto-ends with no further play, the
    // window is empty but the full-session totals + telemetry still
    // describe the session. The `is_empty` fast-path below filters out
    // truly idle stops.
    let (feedbacks, segments, mut start_secs, mut start_ms) = {
        let acc = session_acc
            .lock()
            .map_err(|e| format!("session_acc lock failed: {e}"))?;
        (
            acc.all_feedbacks().to_vec(),
            acc.all_segments().to_vec(),
            acc.session_start_secs().unwrap_or(0),
            acc.session_start_ms().unwrap_or(0),
        )
    };

    let telemetry_has_content = !telemetry.expected_beats.is_empty()
        || !telemetry.detected_onsets.is_empty()
        || !telemetry.matches.is_empty();
    if feedbacks.is_empty() && !telemetry_has_content {
        return Ok(());
    }

    // Defensive fallback for missing `session_start_*` — after the
    // window/all split, `mark_session_start` is preserved across
    // mid-session clears so this should never fire on the normal path.
    // Kept as a safety net for edge cases (legacy callers, tests, or
    // future code paths that bypass `start_evaluation`): recover the
    // session epoch from the earliest telemetry timestamp so the JSON's
    // `timestamp` / `durationMs` reflect the real session window instead
    // of 1970.
    if start_ms == 0 {
        let earliest = telemetry
            .expected_beats
            .first()
            .map(|b| b.timestamp_ms)
            .or_else(|| telemetry.detected_onsets.first().map(|o| o.timestamp_ms));
        if let Some(ms) = earliest {
            start_ms = ms;
            start_secs = ms / 1000;
        }
    }

    let (bpm, time_signature, subdivision, instrument) = {
        let s = state.lock().map_err(|e| format!("state lock failed: {e}"))?;
        (s.bpm, s.time_signature, s.subdivision, s.instrument.clone())
    };

    let end_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(start_ms);
    let duration_ms = end_ms.saturating_sub(start_ms);

    let log = crate::session_log::build_log_from_session(
        bpm,
        time_signature,
        subdivision,
        start_secs,
        duration_ms,
        instrument,
        &feedbacks,
        segments,
        telemetry,
    );

    let dir = diagnostics_dir(app_handle)?;
    let json_path = crate::session_log::save_log(&dir, &log)?;

    // Dev-only: if session-audio recording was enabled, the AudioInput
    // has a `.wav.partial` waiting. Rename it to match the JSON stem so
    // the two files pair up obviously in `session_logs/`. Best-effort —
    // any failure logs but doesn't break the stop path.
    let partial_wav = audio_input
        .lock()
        .map_err(|e| format!("audio_input lock failed: {e}"))?
        .take_last_session_audio_path();
    if let Some(partial) = partial_wav {
        if let Some(target) = crate::session_audio::paired_wav_path(&json_path) {
            if let Err(e) = std::fs::rename(&partial, &target) {
                eprintln!(
                    "[session-audio] rename {} → {} failed: {e}",
                    partial.display(),
                    target.display()
                );
                // Leave the partial in place rather than deleting — the
                // raw bytes are still useful for manual debugging even if
                // the pairing didn't land.
            } else {
                eprintln!("[session-audio] paired WAV saved: {}", target.display());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_evaluation_state(audio_input: State<SharedAudioInput>) -> bool {
    let ai = audio_input.lock().unwrap();
    ai.is_active()
}

/// D4 — Signal A entry point. The JS layer calls this when the user
/// changes BPM, preset, time signature, or instrument. The timing
/// analyzer closes the open segment internally on its next poll
/// (`SegmentEndReason::SettingsChange`) so the next run of play scores
/// against fresh state. Per the plan, no `practice-segment-ended`
/// event fires — the coach speaks the boundary via the forced
/// `boundary_signal_a` gatekeeper event in the JS layer.
#[tauri::command]
pub fn notify_settings_change(
    timing_analyzer: State<SharedTimingAnalyzer>,
) -> Result<(), String> {
    let ta = timing_analyzer
        .lock()
        .map_err(|e| format!("Lock failed: {e}"))?;
    ta.notify_settings_change();
    Ok(())
}

#[tauri::command]
pub async fn get_session_report(session_acc: State<'_, SharedSessionAccumulator>) -> Result<Option<SessionReport>, String> {
    let acc = session_acc.lock().map_err(|e| format!("Lock failed: {e}"))?;
    if acc.is_empty() {
        Ok(None)
    } else {
        Ok(Some(acc.report()))
    }
}

#[tauri::command]
pub async fn clear_session(session_acc: State<'_, SharedSessionAccumulator>) -> Result<(), String> {
    // Mid-session clear: wipe only the per-segment mini-report window so
    // the next `get_session_report` reflects the next segment in
    // isolation. The full-session totals (`all_feedbacks`/`all_segments`)
    // and `session_start_*` are preserved so `persist_session_log` still
    // sees the whole session at stop time. Wiping them mid-session used
    // to leave the persisted D1 JSON with `totalBeats=1, hits=0,
    // score=20` even on long sessions — see `SessionAccumulator` doc.
    session_acc
        .lock()
        .map_err(|e| format!("Lock failed: {e}"))?
        .clear_segment_window();
    Ok(())
}

#[tauri::command]
pub fn save_session(session: crate::session::SavedSession, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let mut history: Vec<crate::session::SavedSession> = store
        .get("evalSessionHistory")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    // Prepend new session at the front
    history.insert(0, session);
    // Cap at max
    history.truncate(crate::session::MAX_SESSION_HISTORY);
    store.set("evalSessionHistory", serde_json::to_value(&history).unwrap());
    Ok(())
}

#[tauri::command]
pub fn get_session_history(app_handle: AppHandle) -> Vec<crate::session::SavedSession> {
    use tauri_plugin_store::StoreExt;
    app_handle
        .store("settings.json")
        .ok()
        .and_then(|store| {
            store
                .get("evalSessionHistory")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn delete_session(id: String, app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let mut history: Vec<crate::session::SavedSession> = store
        .get("evalSessionHistory")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    history.retain(|s| s.id != id);
    store.set("evalSessionHistory", serde_json::to_value(&history).unwrap());
    Ok(())
}

#[tauri::command]
pub fn clear_all_sessions(app_handle: AppHandle) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    let empty: Vec<crate::session::SavedSession> = Vec::new();
    store.set("evalSessionHistory", serde_json::to_value(&empty).unwrap());
    Ok(())
}

// ---------------------------------------------------------------------------
// Diagnostic Session Logs (D1)
//
// These are heavier per-session JSON dumps (raw onsets, expected beats,
// match decisions, etc.) used by the dev/debug pipeline. Storage path:
// `app_data_dir/session_logs/`. They are independent from
// `evalSessionHistory` above, which is the lightweight history shown
// in the UI.
// ---------------------------------------------------------------------------

fn diagnostics_dir(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))
}

#[tauri::command]
pub fn list_session_logs(app_handle: AppHandle) -> Result<Vec<String>, String> {
    let dir = diagnostics_dir(&app_handle)?;
    let paths = crate::session_log::list_log_paths(&dir)?;
    Ok(paths
        .into_iter()
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect())
}

#[tauri::command]
pub fn get_session_log(path: String) -> Result<crate::session_log::SessionLog, String> {
    crate::session_log::load_log(std::path::Path::new(&path))
}

/// Dump every persisted log into a single combined JSON file under
/// `app_data_dir/exports/yames-session-logs-<unix>.json`. Returns the
/// destination path so the frontend can show / reveal it.
#[tauri::command]
pub fn export_session_logs(app_handle: AppHandle) -> Result<String, String> {
    let app_dir = diagnostics_dir(&app_handle)?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = app_dir
        .join("exports")
        .join(format!("yames-session-logs-{ts}.json"));
    crate::session_log::export_logs(&app_dir, &dest)?;
    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "export path is not valid UTF-8".to_string())
}

#[tauri::command]
pub fn clear_session_logs(app_handle: AppHandle) -> Result<(), String> {
    let dir = diagnostics_dir(&app_handle)?;
    crate::session_log::clear_logs(&dir)
}

// ---------------------------------------------------------------------------
// Audio Input Recording / Playback
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn start_recording(audio_input: State<SharedAudioInput>) -> Result<(), String> {
    let ai = audio_input.lock().unwrap();
    if !ai.is_active() {
        return Err("Audio input is not active".to_string());
    }
    ai.start_recording();
    Ok(())
}

#[tauri::command]
pub fn stop_recording(audio_input: State<SharedAudioInput>) -> f32 {
    let mut ai = audio_input.lock().unwrap();
    ai.stop_recording()
}

#[tauri::command]
pub fn start_playback(
    audio_input: State<SharedAudioInput>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    // Use the same output device as the metronome engine
    let output_device_name = {
        let engine = engine_state.0.lock().unwrap();
        engine.device_name().map(|s| s.to_string())
    };
    let mut ai = audio_input.lock().unwrap();
    ai.start_playback(app_handle, output_device_name.as_deref())
}

#[tauri::command]
pub fn stop_playback(audio_input: State<SharedAudioInput>) {
    let mut ai = audio_input.lock().unwrap();
    ai.stop_playback();
}

#[tauri::command]
pub fn discard_recording(audio_input: State<SharedAudioInput>) {
    let mut ai = audio_input.lock().unwrap();
    ai.discard_recording();
}

#[tauri::command]
pub fn get_waveform(audio_input: State<SharedAudioInput>) -> Vec<f32> {
    let ai = audio_input.lock().unwrap();
    ai.get_waveform(100)
}

#[tauri::command]
pub fn set_input_gain(gain_db: f32, audio_input: State<SharedAudioInput>) {
    let gain_linear = 10.0_f32.powf(gain_db / 20.0);
    let ai = audio_input.lock().unwrap();
    ai.set_input_gain(gain_linear);
}

use crate::engine::AudioOutputDevice;

#[tauri::command]
pub fn list_audio_output_devices() -> Vec<AudioOutputDevice> {
    crate::engine::list_output_devices()
}

#[tauri::command]
pub fn set_audio_output_device(
    device_name: Option<String>,
    state: State<SharedState>,
    engine_state: State<EngineState>,
    app_handle: AppHandle,
) {
    // Persist the choice
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app_handle.store("settings.json") {
        match &device_name {
            Some(name) => store.set("audioOutputDevice", serde_json::json!(name)),
            None => store.set("audioOutputDevice", serde_json::Value::Null),
        }
    }

    let mut engine = engine_state.0.lock().unwrap();
    engine.set_device(device_name, state.inner().clone(), app_handle);
}

// ---------------------------------------------------------------------------
// Model download management
// ---------------------------------------------------------------------------

use crate::models;

pub struct DownloadState(pub std::sync::Mutex<Option<models::DownloadCancelFlag>>);

#[tauri::command]
pub fn get_model_status(app_handle: AppHandle) -> Result<models::ModelStatus, String> {
    models::check_model_status(&app_handle)
}

#[tauri::command]
pub fn write_model_chunk(
    app_handle: AppHandle,
    component: String,
    filename: String,
    data: Vec<u8>,
) -> Result<String, String> {
    models::write_model_file(&app_handle, &component, &filename, &data)
}

#[tauri::command]
pub fn get_models_path(app_handle: AppHandle) -> Result<String, String> {
    models::get_models_path(&app_handle)
}

#[tauri::command]
pub fn delete_models(
    app_handle: AppHandle,
    dl_state: State<DownloadState>,
) -> Result<(), String> {
    // Signal any in-flight download to abort BEFORE wiping the models
    // directory. Otherwise the download thread continues, sees its
    // partial-file destination vanish, and emits a confusing failure
    // event after the UI has already shown "removed". The cancel flag
    // is read at each curl progress tick so the thread bails on the
    // next chunk instead of writing into a deleted tree.
    {
        let mut guard = dl_state.0.lock().unwrap();
        if let Some(cancel) = guard.take() {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
    models::delete_models(&app_handle)
}

#[tauri::command]
pub fn start_model_download(
    app_handle: AppHandle,
    url: String,
    component: String,
    filename: String,
    tier: String,
    dl_state: State<DownloadState>,
) -> Result<(), String> {
    let mut guard = dl_state.0.lock().unwrap();
    // Cancel any existing download first
    if let Some(old) = guard.take() {
        old.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    *guard = Some(cancel.clone());
    models::start_download(app_handle, url, component, filename, tier, cancel);
    Ok(())
}

#[tauri::command]
pub fn cancel_model_download(dl_state: State<DownloadState>) -> Result<(), String> {
    let mut guard = dl_state.0.lock().unwrap();
    if let Some(cancel) = guard.take() {
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Coach LLM inference
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn load_coach_model(
    app_handle: AppHandle,
    engine: State<'_, SharedCoachEngine>,
) -> Result<bool, String> {
    let model_path = {
        let dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {e}"))?;
        dir.join("models").join("brain").join("model.bin")
    };

    let mut lock = engine.lock().map_err(|e| format!("Lock failed: {e}"))?;
    crate::coach::load_model(&mut lock, &model_path)
}

#[tauri::command]
pub async fn coach_generate(
    engine: State<'_, SharedCoachEngine>,
    context: String,
) -> Result<String, String> {
    // LLM inference takes ~200-2000ms and the templated fallback can
    // still spend ~1-10ms parsing the context string. Holding the
    // CoachEngine Mutex on a tokio worker for that whole window blocks
    // every concurrent async command (boundary IPC, evaluation
    // toggles, audio device polling, …) — the same hazard `tts_speak`
    // already guards against via `spawn_blocking`. Move the inference
    // off the async runtime so generations queue behind the mutex
    // without freezing the rest of the command surface.
    let engine_arc: SharedCoachEngine = engine.inner().clone();
    let ctx_owned = context;
    tokio::task::spawn_blocking(move || {
        let lock = engine_arc.lock().map_err(|e| format!("Lock failed: {e}"))?;
        crate::coach::generate(&lock, &ctx_owned)
    })
    .await
    .map_err(|e| format!("coach_generate join failed: {e}"))?
}

#[tauri::command]
pub fn is_coach_loaded(engine: State<'_, SharedCoachEngine>) -> bool {
    engine.lock().map(|lock| lock.is_loaded()).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn tts_speak(
    app_handle: AppHandle,
    tts: State<'_, SharedTts>,
    state: State<'_, SharedState>,
    dim_state: State<'_, SharedTtsDim>,
    text: String,
) -> Result<(), String> {
    // Dim metronome volume during speech (temporary, not persisted).
    //
    // Nested-dim safety: two TTS calls can land concurrently (e.g.
    // greeting paraphrase still talking when the first coach-tip
    // fires). Without coordination, the second call would capture the
    // already-dimmed volume as its "original" and the restored volume
    // would end up stuck at ~15% of the user's real setting. The
    // `dim_enter` helper records the original ONCE on the outermost
    // dim and tells us when to skip the AppState write; the
    // symmetric `dim_exit` below only triggers a restore when the
    // counter drains to zero. Pure helpers live in `tts.rs` so the
    // invariants are unit-tested.
    {
        let mut dim = dim_state.lock().unwrap();
        // Hold the state lock across the read-then-conditional-write so
        // a concurrent `set_volume` (e.g. the user dragging the volume
        // slider mid-greeting) can't land between the "live_volume" read
        // and the dim write — that would let dim_enter capture a stale
        // "original" and `dim_exit` later restore over the user's new
        // value. Acquiring `dim` first keeps the lock order consistent
        // with `dim_exit` below; `set_volume` only takes `state` so no
        // dim/state cross-deadlock is possible.
        let mut s = state.lock().unwrap();
        if let Some(target) = crate::tts::dim_enter(&mut dim, s.volume) {
            s.volume = target;
        }
    }

    // The Piper + afplay subprocesses inside `speak()` block the
    // calling thread for ~1-5 seconds. Running them directly here pins
    // a tokio worker for the full duration, which makes every other
    // async command (boundary IPC, evaluation toggles, settings
    // changes, …) wait — observed by the user as the whole app
    // "freezing till the voice is over". Push the blocking work onto
    // tokio's dedicated blocking pool so async workers stay free.
    let tts_arc: SharedTts = tts.inner().clone();
    let text_owned = text;
    // Emit `tts-speech-started` right before audio playback begins so
    // the UI can swap a spinner for the actual text in lockstep with
    // the first audible sample. See `useSession.ts::speakAndReveal`.
    let app_handle_for_emit = app_handle.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut tts_engine = tts_arc.lock().map_err(|e| format!("Lock failed: {e}"))?;
        tts_engine.speak(&text_owned, || {
            let _ = app_handle_for_emit.emit("tts-speech-started", ());
        })
    })
    .await
    .map_err(|e| format!("TTS task join failed: {e}"))?;

    // Restore original volume only when this is the outermost dim
    // releasing. Inner dims are no-ops on restore so a concurrent
    // greeting+tip doesn't stomp on the user-visible value mid-speech.
    // Same dim-then-state lock order as the entry block above keeps the
    // capture/restore symmetrical and consistent.
    {
        let mut dim = dim_state.lock().unwrap();
        if let Some(orig) = crate::tts::dim_exit(&mut dim) {
            state.lock().unwrap().volume = orig;
        }
    }

    result
}

#[tauri::command]
pub fn tts_set_voice(tts: State<'_, SharedTts>, voice: String) {
    if let Ok(mut engine) = tts.lock() {
        engine.set_voice(&voice);
    }
}

/// Set the coach voice playback volume (0.0..=1.0). Stored on the TtsEngine
/// and applied to the next `afplay` invocation via the `-v` flag.
#[tauri::command]
pub fn tts_set_volume(tts: State<'_, SharedTts>, volume: f32) {
    if let Ok(mut engine) = tts.lock() {
        engine.set_volume(volume);
    }
}

#[tauri::command]
pub fn tts_list_voices(tts: State<'_, SharedTts>) -> Vec<(String, String)> {
    tts.lock().map(|e| e.list_available_voices()).unwrap_or_default()
}