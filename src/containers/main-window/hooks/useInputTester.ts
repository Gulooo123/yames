import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import type { InputTestEntry } from "../../settings/InputTesterModal";

/**
 * Owns the unified Input Tester overlay state — the modal that captures
 * keyboard / MIDI / gamepad presses so users can see exactly what each
 * source maps to.
 *
 *   - `inputTestMode`     — visibility flag for the modal.
 *   - `inputTestLog`      — bounded ring (max 100 entries) of captured
 *                           events. Older entries are dropped from the
 *                           head.
 *   - `inputTestLogRef`   — ref to the modal's scrollable log container;
 *                           passed straight through to `InputTesterModal`
 *                           and used by `appendLog` to auto-scroll to the
 *                           newest entry.
 *   - `inputTestModeRef`  — current value of `inputTestMode` mirrored into
 *                           a ref, so callback closures captured by other
 *                           hooks (notably `useMidi`'s dispatcher) can
 *                           gate themselves without re-subscribing every
 *                           time test mode toggles.
 *   - `appendLog(entry)`  — push a single entry, trim to last 100, and
 *                           auto-scroll. Used by the keyboard, gamepad,
 *                           and MIDI capture sites.
 *   - `clearLog()`        — reset the log to empty (bound to the modal's
 *                           "Clear" button).
 *
 * One effect mirrors `inputTestMode` into `inputTestModeRef`. A second
 * clears the log when the modal closes, so reopening it always starts
 * fresh.
 */

export interface InputTester {
  inputTestMode: boolean;
  setInputTestMode: Dispatch<SetStateAction<boolean>>;
  inputTestLog: InputTestEntry[];
  inputTestLogRef: RefObject<HTMLDivElement>;
  inputTestModeRef: MutableRefObject<boolean>;
  appendLog: (entry: InputTestEntry) => void;
  clearLog: () => void;
}

export function useInputTester(): InputTester {
  const [inputTestMode, setInputTestMode] = useState(false);
  const [inputTestLog, setInputTestLog] = useState<InputTestEntry[]>([]);
  const inputTestLogRef = useRef<HTMLDivElement>(null);
  const inputTestModeRef = useRef(false);

  // Mirror the mode into a ref so callback closures (e.g. the MIDI
  // dispatcher inside useMidi) can read the current value without forcing
  // those hooks to re-subscribe on every toggle.
  useEffect(() => {
    inputTestModeRef.current = inputTestMode;
  }, [inputTestMode]);

  // Reset the log whenever the modal closes — reopening should be a clean
  // slate, not a stale event history from the previous session.
  useEffect(() => {
    if (!inputTestMode) setInputTestLog([]);
  }, [inputTestMode]);

  const appendLog = useCallback((entry: InputTestEntry) => {
    setInputTestLog((prev) => [...prev.slice(-99), entry]);
    requestAnimationFrame(() => {
      const el = inputTestLogRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const clearLog = useCallback(() => setInputTestLog([]), []);

  return {
    inputTestMode,
    setInputTestMode,
    inputTestLog,
    inputTestLogRef,
    inputTestModeRef,
    appendLog,
    clearLog,
  };
}
