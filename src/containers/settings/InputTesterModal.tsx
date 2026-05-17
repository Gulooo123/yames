import type { RefObject } from "react";
import { splitCombo } from "../../hotkeys";

export type InputTestEntry = {
  source: "keyboard" | "midi" | "gamepad";
  label: string;
  detail?: string;
  action?: string;
};

/**
 * Input Tester overlay — captures keyboard/MIDI/gamepad presses and shows what
 * action they map to. The parent owns the log state and a ref to the scrollable
 * log container so it can append entries and auto-scroll to the latest.
 */
export function InputTesterModal({
  log,
  logRef,
  onClose,
  onClear,
}: {
  log: InputTestEntry[];
  logRef: RefObject<HTMLDivElement>;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <div className="keybinding-overlay" onClick={onClose}>
      <div className="input-tester-modal" onClick={(e) => e.stopPropagation()}>
        <span className="keybinding-capture-title">Input Tester</span>
        <div className="input-tester-hint">
          Press keys, MIDI buttons, or gamepad buttons to see what they map to.
        </div>
        <div className="input-tester-log-wrapper">
          <div
            className="input-tester-log"
            ref={logRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const thumb = el.parentElement?.querySelector(".input-tester-scrollbar-thumb") as HTMLElement | null;
              const track = el.parentElement?.querySelector(".input-tester-scrollbar") as HTMLElement | null;
              if (!thumb || !track) return;
              const scrollRatio = el.scrollTop / (el.scrollHeight - el.clientHeight);
              const trackH = track.clientHeight;
              const thumbH = Math.max(24, (el.clientHeight / el.scrollHeight) * trackH);
              thumb.style.height = `${thumbH}px`;
              thumb.style.top = `${scrollRatio * (trackH - thumbH)}px`;
              track.classList.toggle("visible", el.scrollHeight > el.clientHeight);
            }}
          >
          {log.length === 0 ? (
            <div className="midi-tester-empty">Waiting for input…</div>
          ) : (
            log.map((entry, i) => (
              <div className={`input-tester-row ${i === log.length - 1 ? "latest" : ""}`} key={i}>
                <span className={`input-tester-source input-tester-source--${entry.source}`}>
                  {entry.source === "keyboard" ? "KEY" : entry.source === "midi" ? "MIDI" : "PAD"}
                </span>
                <span className="input-tester-keys">
                  {entry.source === "keyboard" ? (
                    splitCombo(entry.label).map((k, j) => (
                      <kbd key={j} className="input-tester-kbd">{k}</kbd>
                    ))
                  ) : entry.source === "midi" ? (
                    <>
                      <span className="input-tester-pill midi">{entry.label}</span>
                      {entry.detail && entry.detail.split(/\s+/).map((d, j) => (
                        <span key={j} className="input-tester-pill midi-subtle">{d}</span>
                      ))}
                    </>
                  ) : (
                    <span className="input-tester-pill gamepad">{entry.label}</span>
                  )}
                </span>
                <span className="input-tester-action">
                  {entry.action ? (
                    <span className="midi-tester-mapped">{entry.action}</span>
                  ) : (
                    <span className="midi-tester-unmapped">—</span>
                  )}
                </span>
              </div>
            ))
          )}
          </div>
          <div className="input-tester-scrollbar">
            <div className="input-tester-scrollbar-thumb" />
          </div>
        </div>
        <div className="keybinding-capture-actions">
          <button className="keybinding-btn-reset" onClick={onClear}>
            Clear
          </button>
          <button className="keybinding-btn-remove" onClick={onClose}>
            Close
          </button>
        </div>
        <span className="keybinding-capture-hint">
          Press Escape to close
        </span>
      </div>
    </div>
  );
}
