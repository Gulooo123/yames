import type { Dispatch, SetStateAction } from "react";
import type {
  BrainTier,
  InstrumentId,
  ModelTier,
  Verbosity,
  VoiceMode,
} from "../../types";
import type { ModelStatus } from "../../ipc";
import {
  deleteModels,
  getModelStatus,
  setInstrument as setInstrumentBackend,
  storeSave,
  ttsSetVoice,
} from "../../ipc";
import { InstrumentDropdown } from "../../components/InstrumentDropdown";
import { formatBytes } from "./formatBytes";

/**
 * Practice Coach settings section — owns the toggle groups for AI tier,
 * instrument, voice delivery, and voice personality, plus the post-install
 * management buttons (download voices / remove models). Pure UI: state lives
 * in the parent and is mutated through the provided setters.
 */
export function CoachSettingsSection({
  coachBrainTier,
  setCoachBrainTier,
  coachVoiceMode,
  setCoachVoiceMode,
  coachVoiceName,
  setCoachVoiceName,
  coachVerbosity,
  setCoachVerbosity,
  modelStatus,
  setModelStatus,
  modelDownloading,
  availableVoices,
  instrument,
  setInstrument,
  onStartDownload,
  onRequestDownload,
}: {
  coachBrainTier: BrainTier;
  setCoachBrainTier: Dispatch<SetStateAction<BrainTier>>;
  coachVoiceMode: VoiceMode;
  setCoachVoiceMode: Dispatch<SetStateAction<VoiceMode>>;
  coachVoiceName: string;
  setCoachVoiceName: Dispatch<SetStateAction<string>>;
  coachVerbosity: Verbosity;
  setCoachVerbosity: Dispatch<SetStateAction<Verbosity>>;
  modelStatus: ModelStatus | null;
  setModelStatus: Dispatch<SetStateAction<ModelStatus | null>>;
  modelDownloading: boolean;
  availableVoices: [string, string][];
  instrument: string;
  setInstrument: Dispatch<SetStateAction<string>>;
  onStartDownload: (tier: ModelTier) => void;
  onRequestDownload: (tier: ModelTier) => void;
}) {
  return (
    <section className="settings-section">
      <h2>Practice Coach</h2>
      <div className="setting-row">
        <div className="setting-label">
          <label>Brain</label>
          <span className="setting-hint">Local AI model for coaching</span>
        </div>
        <div className="toggle-group">
          <button
            className={`toggle-btn ${coachBrainTier === "off" ? "active" : ""}`}
            data-tooltip="No AI coaching — timing feedback only"
            onClick={() => {
              setCoachBrainTier("off");
              storeSave("coachBrainTier", "off");
            }}
          >
            Off
          </button>
          <button
            className={`toggle-btn ${coachBrainTier === "standard" ? "active" : ""}`}
            data-tooltip="Fast & lightweight model. ~1.1 GB download, ~2 GB RAM while running. Good for real-time tips."
            disabled={modelDownloading}
            onClick={() => {
              if (modelStatus?.brainReady && modelStatus.brainTier === "standard") {
                setCoachBrainTier("standard");
                storeSave("coachBrainTier", "standard");
                if (!modelStatus.voiceReady) onStartDownload("standard");
              } else {
                onRequestDownload("standard");
              }
            }}
          >
            Standard
          </button>
          <button
            className={`toggle-btn ${coachBrainTier === "full" ? "active" : ""}`}
            data-tooltip="Larger model with deeper analysis. ~2.1 GB download, ~4 GB RAM. Richer feedback and practice plans."
            disabled={modelDownloading}
            onClick={() => {
              if (modelStatus?.brainReady && modelStatus.brainTier === "full") {
                setCoachBrainTier("full");
                storeSave("coachBrainTier", "full");
                if (!modelStatus.voiceReady) onStartDownload("full");
              } else {
                onRequestDownload("full");
              }
            }}
          >
            Full
          </button>
        </div>
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Instrument</label>
          <span className="setting-hint">Tunes detection and coaching</span>
        </div>
        <InstrumentDropdown
          value={instrument}
          onChange={(val) => {
            // Update local state + persistent store (for next-launch
            // restore) AND push to the backend so the DSP picks up the
            // new InstrumentProfile immediately (D0).
            setInstrument(val);
            storeSave("instrument", val);
            setInstrumentBackend(val as InstrumentId).catch(() => {
              // Backend may not be ready during early boot; the lib.rs
              // restore path will hydrate from the store anyway.
            });
          }}
          // When the Brain is "off" there's no coach to tune detection
          // for, so the instrument selector is locked alongside the
          // other coach-dependent controls (Voice) to keep the section
          // visually consistent.
          disabled={coachBrainTier === "off"}
        />
      </div>
      <div className="setting-row">
        <div className="setting-label">
          <label>Voice</label>
          <span className="setting-hint">Audio feedback delivery</span>
        </div>
        <div className="toggle-group">
          {(["silent", "voice"] as const).map((mode) => (
            <button
              key={mode}
              className={`toggle-btn ${coachVoiceMode === mode ? "active" : ""}`}
              data-tooltip={
                mode === "silent"
                  ? "No audio — feedback appears as text only"
                  : "Spoken feedback using local text-to-speech after each session segment"
              }
              disabled={coachBrainTier === "off" || (mode === "voice" && availableVoices.length === 0)}
              onClick={() => {
                setCoachVoiceMode(mode);
                storeSave("coachVoiceMode", mode);
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {/* C5 verbosity — controls how often spoken events fire. "Default"
          honours the gatekeeper's tier decision verbatim. "More" promotes
          written-tier events to spoken so the coach is more talkative
          mid-session. The setting is silent when Voice is off (TTS is
          gated by `voiceMode` regardless). */}
      <div className="setting-row">
        <div className="setting-label">
          <label>Verbosity</label>
          <span className="setting-hint">How often the coach speaks</span>
        </div>
        <div className="toggle-group">
          {(["less", "default", "more"] as const).map((mode) => (
            <button
              key={mode}
              className={`toggle-btn ${coachVerbosity === mode ? "active" : ""}`}
              data-tooltip={
                mode === "less"
                  ? "Coach only speaks urgent events; calm nudges stay written-only"
                  : mode === "default"
                    ? "Coach speaks only when the gatekeeper picks the spoken tier"
                    : "Coach also speaks written-tier nudges (more talkative)"
              }
              disabled={coachBrainTier === "off" || coachVoiceMode !== "voice"}
              onClick={() => {
                setCoachVerbosity(mode);
                storeSave("coachVerbosity", mode);
              }}
            >
              {mode === "less" ? "Less" : mode === "default" ? "Default" : "More"}
            </button>
          ))}
        </div>
      </div>
      {/* Voice Name stays mounted regardless of the Voice toggle so the
          settings list doesn't reflow when the user flips between Silent
          and Voice. When Voice is off (or the Brain is off entirely),
          the row dims via the standard `disabled` opacity to match the
          other locked controls. */}
      <div className="setting-row">
        <div className="setting-label">
          <label>Voice Name</label>
          <span className="setting-hint">
            {coachBrainTier === "off"
              ? "Enable the AI Brain to choose a voice"
              : coachVoiceMode !== "voice"
                ? "Switch Voice on to choose a personality"
                : modelStatus?.voiceReady
                  ? "Choose a voice personality"
                  : "Download voices to enable"}
          </span>
        </div>
        <div className="toggle-group">
          {([["lessac", "Lessac"], ["amy", "Amy"], ["ryan", "Ryan"]] as const).map(([id, name]) => {
            const downloaded = availableVoices.some(([vid]) => vid === id);
            const voiceNameDisabled =
              coachBrainTier === "off" ||
              coachVoiceMode !== "voice" ||
              !downloaded;
            return (
              <button
                key={id}
                className={`toggle-btn ${coachVoiceName === id ? "active" : ""}`}
                disabled={voiceNameDisabled}
                title={downloaded ? name : `${name} — not downloaded`}
                onClick={() => {
                  setCoachVoiceName(id);
                  storeSave("coachVoiceName", id);
                  ttsSetVoice(id);
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      {modelStatus?.brainReady && (
        <div className="coach-download-section">
          <p className="setting-hint" style={{ marginBottom: 8 }}>
            {modelStatus.brainTier === "full" ? "Full" : "Standard"} coach installed ({formatBytes(modelStatus.brainSizeBytes + modelStatus.voiceSizeBytes)})
            {!modelStatus.voiceReady && " — voices not installed"}
          </p>
          {!modelStatus.voiceReady && !modelDownloading && (
            <button
              className="coach-download-btn"
              onClick={() => onStartDownload((modelStatus.brainTier as ModelTier) ?? "standard")}
            >
              Download voices
            </button>
          )}
          <button
            className="coach-download-btn"
            onClick={async () => {
              await deleteModels();
              setModelStatus(await getModelStatus());
              setCoachBrainTier("off");
              storeSave("coachBrainTier", "off");
            }}
          >
            Remove models
          </button>
        </div>
      )}
    </section>
  );
}
