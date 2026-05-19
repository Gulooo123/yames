import { useEffect, useRef, useState } from "react";

/** Human-readable label for a 0-indexed input channel. */
export function channelLabel(index: number, isInterface: boolean): string {
  const human = index + 1; // 0-indexed → 1-indexed for display
  if (index === 0) return `Ch ${human} — Direct input (dry)`;
  if (index === 1) return `Ch ${human}`;
  if (index === 2 && isInterface) return `Ch ${human} — Loopback L`;
  if (index === 3 && isInterface) return `Ch ${human} — Loopback R`;
  return `Ch ${human}`;
}

/**
 * Custom styled channel selector using the same `midi-dropdown` CSS classes
 * as all other device dropdowns in the app. Used in both the Settings panel
 * (DevicesSettingsSection) and the Test Audio Input modal.
 *
 * No dot indicator — not meaningful for a channel index — but otherwise
 * identical mark-up to AudioInputDropdown / MidiDeviceDropdown.
 */
export function ChannelDropdown({
  channelCount,
  value,
  isInterface,
  onChange,
}: {
  channelCount: number;
  value: number;
  isInterface: boolean;
  onChange: (ch: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const options = Array.from({ length: channelCount }, (_, i) => ({
    value: i,
    label: channelLabel(i, isInterface),
  }));

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className={`midi-dropdown ${open ? "open" : ""}`} ref={ref} style={{ flex: 1 }}>
      <button
        className="midi-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="midi-dropdown-value">
          {options[value]?.label ?? options[0]?.label}
        </span>
        <svg
          className="midi-dropdown-chevron"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="midi-dropdown-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`midi-dropdown-item ${opt.value === value ? "selected" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              type="button"
            >
              {opt.value === value && (
                <svg
                  className="midi-dropdown-check"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
