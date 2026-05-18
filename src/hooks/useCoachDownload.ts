import { useCallback, useEffect, useState } from "react";
import {
  cancelModelDownload,
  getModelStatus,
  onDownloadComplete,
  onDownloadProgress,
  startModelDownload,
  storeLoad,
  storeSave,
  ttsListVoices,
  ttsSetVoice,
  ttsSetVolume,
  ttsVoiceDiagnostics,
} from "../ipc";
import type { DownloadProgress, ModelStatus, VoiceDiagnostic } from "../ipc";
import type { BrainTier, ModelTier, VoiceMode, Verbosity } from "../types";

// Legacy persisted values may still carry "chime" from an earlier
// release; we collapse it to "silent" on load and rewrite the store so
// the user lands on a valid option after migration.
type PersistedVoiceMode = VoiceMode | "chime";

const MODEL_URLS: Record<ModelTier, string> = {
  standard:
    "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
  full: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
};

/**
 * Owns Practice Coach model + voice state for MainWindow:
 *  - which brain tier is active (off / standard / full),
 *  - voice mode + chosen voice,
 *  - the current download status (progress bar + error / success banners),
 *  - the "are you sure you want to download N gigabytes?" pending tier.
 *
 * Side effects:
 *  - Restores tiered settings from the persistent store on mount.
 *  - Subscribes to backend `download-progress` and `download-complete`
 *    events so progress bars stay in sync across hot reloads.
 *  - Persists the selected tier whenever a download finishes.
 */
export function useCoachDownload() {
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelDownloading, setModelDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloadingTier, setDownloadingTier] = useState<ModelTier | null>(
    null,
  );
  const [pendingDownloadTier, setPendingDownloadTier] =
    useState<ModelTier | null>(null);

  const [coachBrainTier, setCoachBrainTier] = useState<BrainTier>("off");
  const [coachVoiceMode, setCoachVoiceMode] = useState<VoiceMode>("silent");
  const [coachVoiceName, setCoachVoiceName] = useState("lessac");
  // C5 verbosity. "default" honours the gatekeeper's tier verbatim.
  // "more" promotes written-tier events to spoken (see useSession).
  const [coachVerbosity, setCoachVerbosity] = useState<Verbosity>("default");
  const [availableVoices, setAvailableVoices] = useState<[string, string][]>(
    [],
  );
  // Per-voice diagnostic flags driven by `tts_voice_diagnostics`. Lets
  // the Settings UI render a per-voice "Repair" button when a voice is
  // missing on disk, has a corrupted .onnx (size < MIN_ONNX_BYTES), or
  // when the Piper engine itself is broken (dylibs / binary missing).
  // Kept alongside `availableVoices` so existing call sites that only
  // need the ready list don't have to adapt.
  const [voiceDiagnostics, setVoiceDiagnostics] = useState<VoiceDiagnostic[]>(
    [],
  );
  // Voice playback gain (0..1). Lives next to the metronome volume in the
  // unified header slider so users can tame the coach independently.
  const [ttsVolume, setTtsVolumeState] = useState<number>(1.0);

  // Load all Practice Coach settings from store on mount.
  useEffect(() => {
    getModelStatus().then(setModelStatus);
    storeLoad<BrainTier>("coachBrainTier").then((v) => {
      if (v) setCoachBrainTier(v);
    });
    storeLoad<PersistedVoiceMode>("coachVoiceMode").then((v) => {
      if (!v) return;
      if (v === "chime") {
        // One-time migration: chime mode no longer exists. Anyone who had
        // it selected falls back to silent and we rewrite the store so the
        // legacy value doesn't reappear on the next launch.
        setCoachVoiceMode("silent");
        storeSave("coachVoiceMode", "silent");
        return;
      }
      setCoachVoiceMode(v);
    });
    storeLoad<string>("coachVoiceName").then((v) => {
      if (v) {
        setCoachVoiceName(v);
        ttsSetVoice(v);
      }
    });
    storeLoad<Verbosity>("coachVerbosity").then((v) => {
      if (v === "default" || v === "more") setCoachVerbosity(v);
    });
    storeLoad<number>("coachTtsVolume").then((v) => {
      if (typeof v === "number" && Number.isFinite(v)) {
        const clamped = Math.max(0, Math.min(1, v));
        setTtsVolumeState(clamped);
        ttsSetVolume(clamped).catch(() => {});
      }
    });
    ttsListVoices().then(setAvailableVoices);
    ttsVoiceDiagnostics().then(setVoiceDiagnostics).catch(() => {});
  }, []);

  // Setter wrapper: persist + push the new gain into the Rust TTS engine so
  // the next afplay invocation honours it. Errors are swallowed because the
  // backend simply ignores out-of-range values via clamp.
  const setTtsVolume = useCallback((volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setTtsVolumeState(clamped);
    storeSave("coachTtsVolume", clamped);
    ttsSetVolume(clamped).catch(() => {});
  }, []);

  const handleStartDownload = useCallback(async (tier: ModelTier) => {
    setModelDownloading(true);
    setDownloadingTier(tier);
    setPendingDownloadTier(null);
    setDownloadError(null);
    setDownloadSuccess(false);
    setDownloadProgress({
      component: "brain",
      downloadedBytes: 0,
      totalBytes: 0,
      fraction: 0,
      done: false,
    });
    try {
      await startModelDownload(MODEL_URLS[tier], "brain", "model.bin", tier);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadError(msg);
      setModelDownloading(false);
      setDownloadProgress(null);
      setDownloadingTier(null);
    }
  }, []);

  // Subscribe to backend progress / completion events.
  useEffect(() => {
    const unsubProgress = onDownloadProgress((progress) => {
      setDownloadProgress(progress);
      if (progress.done) {
        getModelStatus().then(setModelStatus);
      }
    });
    const unsubComplete = onDownloadComplete((result) => {
      if (result.success && result.tier) {
        // Full brain+voices install path — tier present, persist + flip
        // the active brain tier.
        setCoachBrainTier(result.tier as ModelTier);
        storeSave("coachBrainTier", result.tier);
        setDownloadSuccess(true);
        getModelStatus().then(setModelStatus);
        ttsListVoices().then(setAvailableVoices);
        ttsVoiceDiagnostics().then(setVoiceDiagnostics).catch(() => {});
      } else if (result.success) {
        // Per-voice repair path — no `tier` field on the event so we
        // don't clobber the active brain tier. Still refresh model
        // status + diagnostics so the UI reflects the freshly-repaired
        // voice (the previously disabled toggle should now light up).
        setDownloadSuccess(true);
        getModelStatus().then(setModelStatus);
        ttsListVoices().then(setAvailableVoices);
        ttsVoiceDiagnostics().then(setVoiceDiagnostics).catch(() => {});
      } else if (!result.cancelled && result.error) {
        setDownloadError(result.error);
      }
      setModelDownloading(false);
      setDownloadProgress(null);
      setDownloadingTier(null);
    });

    return () => {
      unsubProgress.then((u) => u());
      unsubComplete.then((u) => u());
    };
  }, []);

  const cancelDownload = useCallback(() => {
    cancelModelDownload();
  }, []);

  return {
    // model state
    modelStatus,
    setModelStatus,
    modelDownloading,
    downloadProgress,
    downloadError,
    setDownloadError,
    downloadSuccess,
    setDownloadSuccess,
    downloadingTier,
    pendingDownloadTier,
    setPendingDownloadTier,
    // coach prefs
    coachBrainTier,
    setCoachBrainTier,
    coachVoiceMode,
    setCoachVoiceMode,
    coachVoiceName,
    setCoachVoiceName,
    coachVerbosity,
    setCoachVerbosity,
    availableVoices,
    voiceDiagnostics,
    ttsVolume,
    setTtsVolume,
    // actions
    handleStartDownload,
    cancelDownload,
  };
}

export type UseCoachDownloadReturn = ReturnType<typeof useCoachDownload>;
