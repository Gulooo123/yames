import type { Preset } from "../../types";

interface PresetSaveBarProps {
  activePreset: Preset | null;
  presetDirty: boolean;
  updateFeedback: boolean;
  onRename: (presetId: string) => void;
  onUpdate: () => void;
  onSave: () => void;
}

/**
 * The small bar that sits above the Metronome / Drill content area when a
 * preset is loaded — shows the active preset name (clickable to rename),
 * plus the right-aligned Update / Save button. Pure UI: parent owns all
 * state and provides the action callbacks.
 */
export function PresetSaveBar({
  activePreset,
  presetDirty,
  updateFeedback,
  onRename,
  onUpdate,
  onSave,
}: PresetSaveBarProps) {
  return (
    <div className="preset-save-area">
      {activePreset && (
        <button
          className="preset-active-name"
          onClick={() => onRename(activePreset.id)}
          title="Rename preset"
        >
          {activePreset.name}
          {presetDirty ? " •" : ""}
        </button>
      )}
      {activePreset ? (
        <button
          className={`preset-save-btn preset-save-btn--update ${
            presetDirty ? "preset-save-btn--dirty" : ""
          } ${updateFeedback ? "preset-save-btn--feedback" : ""}`}
          onClick={onUpdate}
          title={presetDirty ? "Update preset" : "No changes to save"}
        >
          {updateFeedback ? (
            <>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="preset-save-btn-label">Updated!</span>
            </>
          ) : (
            <>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v13M7 8l5-5 5 5" />
                <path d="M5 20h14" />
              </svg>
              <span className="preset-save-btn-label">
                {presetDirty ? "Update" : "No changes"}
              </span>
            </>
          )}
        </button>
      ) : (
        <button
          className="preset-save-btn preset-save-btn--save"
          onClick={onSave}
          title="Save preset"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          <span className="preset-save-btn-label">Save preset</span>
        </button>
      )}
    </div>
  );
}
