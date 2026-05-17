import type { Dispatch, SetStateAction } from "react";
import {
  HOTKEYS,
  HOTKEY_GROUPS,
  platformKey,
} from "../../hotkeys";
import { formatGamepadButton, isGamepadBinding } from "../../hooks/useGamepad";
import type { UseMidiReturn } from "../../hooks/useMidi";
import type { BindingTarget } from "./KeybindingModals";

type Bindings = Record<string, string>;

const KeyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h12" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const MidiIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

/**
 * Hotkeys section — renders all hotkey groups, each with a 3-column binding
 * table (Key / Global / MIDI). Includes the "Test inputs" toggle and the
 * "Reset to defaults" button. Pure UI; capture/binding state lives in the
 * parent.
 */
export function HotkeysSettingsSection({
  keyBindings,
  globalBindings,
  footBindings,
  bindingFor,
  setBindingFor,
  setPendingKeys,
  inputTestMode,
  setInputTestMode,
  midi,
  onResetRequest,
}: {
  keyBindings: Bindings;
  globalBindings: Bindings;
  footBindings: Bindings;
  bindingFor: BindingTarget | null;
  setBindingFor: Dispatch<SetStateAction<BindingTarget | null>>;
  setPendingKeys: Dispatch<SetStateAction<string>>;
  inputTestMode: boolean;
  setInputTestMode: Dispatch<SetStateAction<boolean>>;
  midi: UseMidiReturn;
  onResetRequest: () => void;
}) {
  return (
    <section className="hotkeys-section">
      <div className="hotkeys-section-header">
        <h2>Hotkeys</h2>
        <button
          className={`input-test-btn ${inputTestMode ? "active" : ""}`}
          onClick={() => setInputTestMode((v) => !v)}
          title="Test all input bindings (keyboard, MIDI, gamepad)"
        >
          {inputTestMode ? "Stop test" : "Test inputs"}
        </button>
      </div>
      {HOTKEY_GROUPS.map((group) => {
        const items = HOTKEYS.filter((hk) => hk.group === group.key);
        if (items.length === 0) return null;
        return (
          <div key={group.key} className="hotkey-group">
            <div className="hotkey-group-label">{group.label}</div>
            <div className="hotkey-table">
              <div className="hotkey-table-header">
                <span>Action</span>
                <span data-tooltip="Works only when the app is focused">
                  <KeyIcon />
                  Key
                </span>
                <span data-tooltip="Works even when the app is in the background">
                  <GlobeIcon />
                  Global
                  <span className="hotkey-soon-badge">soon</span>
                </span>
                <span data-tooltip="Bind a MIDI controller or USB foot pedal">
                  <MidiIcon />
                  MIDI
                </span>
              </div>
              {items.map((hk) => {
                const midiBinding = midi.bindings.find((b) => b.action === hk.id);
                const gamepadBound = footBindings[hk.id];
                return (
                  <div key={hk.id} className="hotkey-row">
                    <span
                      className="hotkey-action"
                      data-tooltip={hk.desc}
                    >
                      {hk.action}
                    </span>
                    <button
                      className={`hotkey-bind-btn ${bindingFor?.id === hk.id && bindingFor.type === "key" ? "listening" : ""}`}
                      onClick={() => {
                        setBindingFor({ id: hk.id, type: "key" });
                        setPendingKeys("");
                      }}
                    >
                      {platformKey(keyBindings[hk.id] || "—")}
                    </button>
                    <button className="hotkey-bind-btn" disabled>
                      {hk.globalAllowed
                        ? platformKey(globalBindings[hk.id] || "—")
                        : "—"}
                    </button>
                    <button
                      className={`hotkey-bind-btn ${midi.learnMode === hk.id ? "listening" : ""}`}
                      onClick={() => {
                        if (midi.learnMode === hk.id) {
                          midi.cancelLearn();
                        } else {
                          midi.startLearn(hk.id);
                        }
                      }}
                      title={
                        midi.learnMode === hk.id
                          ? "Listening… press a MIDI button or foot pedal"
                          : midiBinding
                          ? `Bound to ${midiBinding.msgType === "cc" ? "CC" : midiBinding.msgType === "note" ? "Note" : "PC"}#${midiBinding.number}. Click to re-learn.`
                          : "Click to learn MIDI / pedal binding"
                      }
                    >
                      {(() => {
                        if (midi.learnMode === hk.id) return "…";
                        if (midiBinding) {
                          const prefix = midiBinding.msgType === "cc" ? "CC" : midiBinding.msgType === "note" ? "N" : "PC";
                          return `${prefix}#${midiBinding.number}`;
                        }
                        if (gamepadBound) {
                          return isGamepadBinding(gamepadBound)
                            ? formatGamepadButton(gamepadBound)
                            : platformKey(gamepadBound);
                        }
                        return "—";
                      })()}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="hotkey-defaults-row">
        <button
          className="hotkey-defaults-btn"
          onClick={onResetRequest}
        >
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
