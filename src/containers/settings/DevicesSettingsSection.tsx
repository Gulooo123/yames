import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type { AudioOutputDevice } from "../../types";
import {
  clearCalibrationCacheEntry,
  getCalibrationCacheEntry,
  listAudioOutputDevices,
  setAudioOutputDevice,
} from "../../ipc";
import type { CalibrationCacheEntry } from "../../ipc";
import { AudioOutputDropdown } from "../../components/AudioOutputDropdown";
import { AudioInputDropdown } from "../../components/AudioInputDropdown";
import { MidiDeviceDropdown } from "../../components/MidiDeviceDropdown";
import type { useEvaluation } from "../../hooks/useEvaluation";
import type { UseMidiReturn } from "../../hooks/useMidi";

type EvaluationLike = ReturnType<typeof useEvaluation>;
type MidiLike = UseMidiReturn;

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

/**
 * Devices settings — audio output (with BT-latency warning), audio input
 * (with test button + per-instrument calibration cache hint), and MIDI
 * device selector. Pure UI; selection state is owned by the parent / by
 * the underlying hooks.
 *
 * The calibration-cache hint surfaces a tiny "Calibrated for this device"
 * note + a Recalibrate button when the current `(instrument, input
 * device)` pair has a cached offset. This is the user-facing payoff for
 * the DSP plan's per-instrument calibration cache: instead of waiting
 * ~8 beats every session for the auto-calibration to converge, the
 * pre-seeded offset means the very first beat is judged against the
 * learned offset.
 */
export function DevicesSettingsSection({
  audioOutputDevices,
  setAudioOutputDevices,
  selectedOutputDevice,
  setSelectedOutputDevice,
  evaluation,
  midi,
  onOpenInputTest,
  instrument,
}: {
  audioOutputDevices: AudioOutputDevice[];
  setAudioOutputDevices: Dispatch<SetStateAction<AudioOutputDevice[]>>;
  selectedOutputDevice: string;
  setSelectedOutputDevice: Dispatch<SetStateAction<string>>;
  evaluation: EvaluationLike;
  midi: MidiLike;
  onOpenInputTest: () => void;
  instrument: string;
}) {
  // Per-instrument calibration cache lookup. We re-fetch whenever the
  // active `(instrument, audio input)` pair changes so the displayed
  // value tracks what start_evaluation would actually use next session.
  const [calEntry, setCalEntry] = useState<CalibrationCacheEntry | null>(null);
  const inputDevice = evaluation.selectedDevice ?? null;
  useEffect(() => {
    let cancelled = false;
    getCalibrationCacheEntry(instrument, inputDevice)
      .then((entry) => {
        if (!cancelled) setCalEntry(entry);
      })
      .catch(() => {
        if (!cancelled) setCalEntry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [instrument, inputDevice]);

  const handleRecalibrate = async () => {
    await clearCalibrationCacheEntry(instrument, inputDevice);
    setCalEntry(null);
  };

  return (
    <section className="hotkeys-section">
      <h2>Devices</h2>
      <div className="midi-device-section">
        <label className="midi-label devices-subsection-label">Audio Output</label>
        <div className="midi-device-row">
          <AudioOutputDropdown
            devices={audioOutputDevices}
            value={selectedOutputDevice}
            onChange={(val) => {
              setSelectedOutputDevice(val);
              setAudioOutputDevice(val || null);
            }}
          />
          <button
            className="midi-refresh-btn"
            onClick={async () => {
              const devices = await listAudioOutputDevices();
              setAudioOutputDevices(devices);
            }}
            title="Refresh audio devices"
          >
            <RefreshIcon />
          </button>
        </div>
        {selectedOutputDevice && audioOutputDevices.find((d) => d.name === selectedOutputDevice)?.isBluetooth && (
          <div className="audio-output-bt-warning">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Bluetooth audio adds significant latency. Visual cues and sound may not sync perfectly.</span>
          </div>
        )}
      </div>

      <div className="midi-device-section" style={{ marginTop: 28 }}>
        <label className="midi-label devices-subsection-label">Audio Input</label>
        <div className="midi-device-row">
          <AudioInputDropdown
            devices={evaluation.devices}
            value={evaluation.selectedDevice ?? ""}
            onChange={(val) => evaluation.selectDevice(val)}
          />
          <button
            className="input-test-btn"
            onClick={onOpenInputTest}
            title="Test audio input"
          >
            Test
          </button>
        </div>
        {/* Per-instrument calibration cache hint. Only renders when the
            current (instrument, input device) pair has a cached offset
            — otherwise we'd surface UI noise on first launch. The
            Recalibrate button clears just this pair; other cached
            combos survive. */}
        {calEntry && (
          <div className="calibration-cache-hint">
            <span className="calibration-cache-text">
              Calibrated for this device ({calEntry.offsetMs >= 0 ? "+" : ""}
              {calEntry.offsetMs.toFixed(1)} ms)
            </span>
            <button
              className="calibration-recalibrate-btn"
              onClick={handleRecalibrate}
              title="Forget the cached offset; the next session re-learns it from scratch"
            >
              Recalibrate
            </button>
          </div>
        )}
      </div>

      <div className="midi-device-section" style={{ marginTop: 28 }}>
        <label className="midi-label devices-subsection-label">MIDI</label>
        <div className="midi-device-row">
          <MidiDeviceDropdown
            devices={midi.devices}
            value={midi.connectedDevice || ""}
            onChange={(val) => {
              if (val) {
                midi.connect(val);
              } else {
                midi.disconnect();
              }
            }}
          />
          <button
            className="midi-refresh-btn"
            onClick={() => midi.refreshDevices()}
            title="Refresh MIDI devices"
          >
            <RefreshIcon />
          </button>
        </div>
        {!midi.connectedDevice && midi.devices.length === 0 && (
          <div className="midi-status">
            <span className="midi-status-dot" />
            No MIDI devices detected
          </div>
        )}
      </div>
    </section>
  );
}
