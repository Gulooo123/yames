import { HOTKEYS } from "../../hotkeys";

export type BindingTarget = {
  id: string;
  type: "key" | "global";
};

export type PendingKeyConflict = {
  combo: string;
  conflictAction: string;
  conflictActionLabel: string;
  targetAction: string;
  targetActionLabel: string;
  type: "key" | "global";
};

export type MidiConflict = {
  activity: { type: string; number: number; channel: number };
  existingBinding: { action: string };
  targetAction: string;
};

/** "Reset all keybindings?" confirmation overlay. */
export function ResetKeybindingsConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="keybinding-overlay" onClick={onCancel}>
      <div className="keybinding-capture" onClick={(e) => e.stopPropagation()}>
        <span className="keybinding-capture-title">Reset all keybindings?</span>
        <div className="keybinding-capture-display">
          <span className="keybinding-capture-waiting">
            This will restore all keyboard bindings to their defaults.
          </span>
        </div>
        <div className="keybinding-capture-actions">
          <button className="keybinding-btn-reset" onClick={onConfirm}>
            Reset
          </button>
          <button className="keybinding-btn-remove" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** MIDI conflict overlay shown when a MIDI signal is already bound to another action. */
export function MidiConflictDialog({
  conflict,
  autoAccept,
  onAutoAcceptChange,
  onAccept,
  onReject,
}: {
  conflict: MidiConflict;
  autoAccept: boolean;
  onAutoAcceptChange: (next: boolean) => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="keybinding-overlay" onClick={onReject}>
      <div className="keybinding-capture" onClick={(e) => e.stopPropagation()}>
        <span className="keybinding-capture-title">MIDI Conflict</span>
        <div className="conflict-body">
          <div className="conflict-signal">
            <span className="conflict-signal-badge">
              {conflict.activity.type.toUpperCase()} #{conflict.activity.number}
            </span>
            <span className="conflict-signal-detail">
              Ch{conflict.activity.channel}
            </span>
          </div>
          <p className="conflict-message">
            is already bound to{" "}
            <strong>
              {HOTKEYS.find((h) => h.id === conflict.existingBinding.action)?.action
                ?? conflict.existingBinding.action}
            </strong>.
            <br />
            Overwrite and assign to{" "}
            <strong>
              {HOTKEYS.find((h) => h.id === conflict.targetAction)?.action
                ?? conflict.targetAction}
            </strong>?
          </p>
        </div>
        <div className="keybinding-capture-actions">
          <button className="keybinding-btn-reset" onClick={onReject}>
            Cancel
          </button>
          <button className="conflict-accept-btn" onClick={onAccept}>
            Overwrite
          </button>
        </div>
        <label className="conflict-dont-ask">
          <input
            type="checkbox"
            checked={autoAccept}
            onChange={(e) => onAutoAcceptChange(e.target.checked)}
          />
          Don't ask again
        </label>
      </div>
    </div>
  );
}

/**
 * Keybinding capture overlay — handles both the "press a key" capture state
 * and the hotkey-conflict resolution state. Renders one or the other based on
 * whether a conflict is pending.
 */
export function KeybindingCaptureModal({
  target,
  pendingKeys,
  pendingKeyConflict,
  onDismiss,
  onResetToDefault,
  onRemove,
  onAcceptConflict,
  onRejectConflict,
}: {
  target: BindingTarget;
  pendingKeys: string;
  pendingKeyConflict: PendingKeyConflict | null;
  onDismiss: () => void;
  onResetToDefault: () => void;
  onRemove: () => void;
  onAcceptConflict: () => void;
  onRejectConflict: () => void;
}) {
  return (
    <div className="keybinding-overlay" onClick={onDismiss}>
      <div className="keybinding-capture" onClick={(e) => e.stopPropagation()}>
        {pendingKeyConflict ? (
          <>
            <span className="keybinding-capture-title">Hotkey Conflict</span>
            <div className="conflict-body">
              <div className="conflict-signal">
                <span className="conflict-signal-badge">{pendingKeyConflict.combo}</span>
              </div>
              <p className="conflict-message">
                is already bound to{" "}
                <strong>{pendingKeyConflict.conflictActionLabel}</strong>.
                <br />
                Overwrite and assign to{" "}
                <strong>{pendingKeyConflict.targetActionLabel}</strong>?
              </p>
            </div>
            <div className="keybinding-capture-actions">
              <button className="keybinding-btn-reset" onClick={onRejectConflict}>
                Cancel
              </button>
              <button className="conflict-accept-btn" onClick={onAcceptConflict}>
                Overwrite
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="keybinding-capture-title">
              {HOTKEYS.find((hk) => hk.id === target.id)?.action} —{" "}
              {target.type === "key" ? "Keyboard" : "Global"}
            </span>
            <div className="keybinding-capture-display">
              {pendingKeys ? (
                <span className="keybinding-capture-keys">{pendingKeys}</span>
              ) : (
                <span className="keybinding-capture-waiting">
                  Press desired key combination…
                </span>
              )}
            </div>
            <div className="keybinding-capture-actions">
              <button className="keybinding-btn-reset" onClick={onResetToDefault}>
                Reset to default
              </button>
              <button className="keybinding-btn-remove" onClick={onRemove}>
                Remove
              </button>
            </div>
            <span className="keybinding-capture-hint">
              Press Escape to cancel
            </span>
          </>
        )}
      </div>
    </div>
  );
}
