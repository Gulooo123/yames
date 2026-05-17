# Features Baseline (as of 2026-05-15)

Captured from `src/components/MainWindow.tsx` (3628 lines, pre-refactor),
`src/components/TrackView.tsx`, hooks, and the `ipc.ts` command surface.
Each item below must continue to work after the frontend refactor.

This file is the contract. If a test for a feature in this checklist
goes red after the refactor, **fix the refactor, not the test.**

## Top-level shell

- [ ] `App` routes to `MainWindow` for the main window
- [ ] `App` routes to `FloatingWidget` when `?window=floating` is in the URL
- [ ] Context menu is disabled in production (no-op in dev)

## Header bar (MainWindow)

- [ ] Three view tabs render: **Beat**, **Drill**, **Track**
- [ ] Clicking a tab switches `view` state and persists via `setActiveTab` IPC
- [ ] Fullscreen button enters fullscreen mode
- [ ] Sound type dropdown opens; selecting a sound calls `setSoundType` IPC
- [ ] Volume popover renders a slider that calls `setVolume` IPC
- [ ] "Floating widget" button calls `showFloating` IPC
- [ ] Share menu opens with 5 options (WhatsApp, X, Facebook, Reddit, Copy)

## BPM controls

- [ ] `-5` button decrements `bpm` by 5 via `setBpm` IPC
- [ ] `+5` button increments `bpm` by 5 via `setBpm` IPC
- [ ] BPM input is editable on click; commits via `setBpm` on blur / Enter
- [ ] BPM slider updates `bpm` via `setBpm`
- [ ] Tempo marking text reflects current BPM (Largo/Andante/Allegro/Presto)
- [ ] Tap tempo button increments tap count and computes BPM after enough taps

## Beat visualization

- [ ] Main beat dots render `timeSignature` beats
- [ ] Subdivision dots render under each beat per `subdivision` count
- [ ] Current beat dot has visually-distinct active state

## Subdivision & meter

- [ ] Subdivision row shows 6 buttons (quarter, eighth, triplet, 16th, quintuplet, sextuplet)
- [ ] Clicking a subdivision button calls `setSubdivision` IPC
- [ ] Time-signature row shows 8 options (Never, Always, 2/4, 3/4, 4/4, 5/4, 6/8, 7/8)
- [ ] Clicking a time-sig calls `setTimeSignature` IPC

## Presets sidebar

- [ ] Preset sidebar renders list of presets loaded via `listPresets` IPC
- [ ] "Save preset" button captures current state into a new preset
- [ ] "Update" button updates the currently-active preset when dirty
- [ ] Clicking a preset loads its values (bpm/sub/timeSig/sound/volume)
- [ ] Deleting a preset removes it via `deletePreset` IPC

## General settings section

- [ ] "Always on top" toggle calls `setAlwaysOnTop` IPC
- [ ] "Widget always on top" toggle calls `setWidgetAlwaysOnTop` IPC
- [ ] "Widget mode" toggle (compact / comfortable) calls `setWidgetMode` IPC

## Theme settings

- [ ] Theme grid renders all themes from `THEMES`
- [ ] Clicking a theme card calls `setTheme` IPC

## Audio device settings

- [ ] Audio output dropdown lists devices from `listAudioOutputDevices`
- [ ] Selecting an output device calls `setAudioOutputDevice`
- [ ] Audio input dropdown lists devices from `listAudioInputDevices`
- [ ] "Test input" button opens `AudioInputTestModal`

## MIDI settings

- [ ] MIDI device dropdown lists devices from `listMidiDevices`
- [ ] Selecting a MIDI device calls `connectMidiDevice`
- [ ] MIDI bindings list renders current bindings
- [ ] "Capture" mode allows binding a MIDI message to an action
- [ ] "Clear" button removes a binding via `clearMidiBinding`

## Coach settings

- [ ] Brain tier shows three options: Off / Standard / Full
- [ ] Selecting a tier persists to store and may open download dialog
- [ ] Voice mode buttons render and persist to store
- [ ] Notification level buttons render and persist to store
- [ ] Instrument dropdown renders 5 instruments

## Update banner

- [ ] Update banner appears when `checkForUpdate` returns `hasUpdate: true`
- [ ] Clicking "Install & Restart" calls `downloadAndInstallUpdate`

## Model download

- [ ] Download confirmation dialog renders 2 tiers (Standard/Full)
- [ ] "Download" button triggers `startModelDownload`
- [ ] Progress bar renders while downloading
- [ ] "Cancel" button calls `cancelModelDownload`
- [ ] "Delete models" calls `deleteModels`

## Coach card

- [ ] CoachCard renders when open
- [ ] Toggle button opens/closes the card
- [ ] "Start session" / "End session" call the right handlers
- [ ] Chat input sends messages via `onSendChat`
- [ ] Spectrum analyzer renders when listening

## TrackView

- [ ] TrackView renders evaluation panel when `evaluationEnabled` is true
- [ ] TrackView renders timeline/scrubber
- [ ] TrackView responds to beat events from `onBeat`

## DrillView (Speed drills)

- [ ] DrillView configuration form renders (start/target BPM, increments, beats per bar)
- [ ] "Start" button calls `startSpeedRamp` IPC
- [ ] "Stop" button calls `stopSpeedRamp` IPC
- [ ] Drill displays current BPM and current step during a ramp

## FullscreenView

- [ ] FullscreenView renders large BPM display
- [ ] Exit button restores main view via `onExit`
- [ ] Active tab is preserved across enter/exit

## FloatingWidget

- [ ] FloatingWidget renders compact BPM + play/stop
- [ ] Compact / comfortable mode toggle works
- [ ] Window can be dragged via `useDrag`

## AudioInputTestModal

- [ ] Modal renders when `open` is true
- [ ] Input device dropdown populates from `initialDevices`
- [ ] Spectrum analyzer displays live input
- [ ] Recording start/stop calls `startRecording` / `stopRecording`
- [ ] Playback start/stop calls `startPlayback` / `stopPlayback`
- [ ] Input gain slider calls `setInputGain`

## EvaluationPanel

- [ ] EvaluationPanel renders session report when present
- [ ] Per-beat feedback list shows deviation + classification
- [ ] "Clear session" button calls `clearSession`

## Playback control (global)

- [ ] Space bar toggles playback (via `togglePlayback`)
- [ ] `setPlaying(true/false)` IPC starts/stops the metronome

## Gamepad

- [ ] `useGamepad` registers a gamepad button binding
- [ ] Pressing the bound button triggers the registered action

## Tap tempo

- [ ] `useTapTempo` computes BPM after >= 2 taps
- [ ] Tap window expires after a timeout (drops stale taps)

---

# Pure functions / units (Rust)

Peace-of-mind tests, no IPC. From `src-tauri/src/`:

- [ ] `onset` — refractory period rejects onsets within minimum interval
- [ ] `onset` — spectral flux produces non-negative values
- [ ] `timing` — beat-interval calculation from BPM
- [ ] `timing` — calibration median converges over N samples
- [ ] `session` — score grading bands (S/A/B/C/D) map correctly from numeric scores
- [ ] `engine` — speed ramp linear progression hits target BPM
- [ ] `engine` — speed ramp zigzag oscillates correctly
- [ ] `models` — `AppState` serializes/deserializes round-trip
