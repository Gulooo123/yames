import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTapTempo } from "./useTapTempo";

describe("useTapTempo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not detect BPM on a single tap", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useTapTempo(cb));
    act(() => {
      result.current.tap();
    });
    expect(cb).not.toHaveBeenCalled();
    expect(result.current.tapCount).toBe(1);
    expect(result.current.isActive).toBe(true);
  });

  it("detects BPM after two evenly-spaced taps", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useTapTempo(cb));
    // Two taps 500ms apart = 120 BPM
    let nowMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    act(() => {
      result.current.tap();
    });
    nowMs = 1500;
    act(() => {
      result.current.tap();
    });
    expect(cb).toHaveBeenCalledWith(120);
  });

  it("clamps BPM into [20, 300]", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useTapTempo(cb));
    // Two taps 100ms apart -> 600 BPM, should clamp to 300
    let nowMs = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    act(() => {
      result.current.tap();
    });
    nowMs = 1100;
    act(() => {
      result.current.tap();
    });
    expect(cb).toHaveBeenCalledWith(300);
  });

  it("auto-resets after 2 seconds of no taps", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useTapTempo(cb));
    act(() => {
      result.current.tap();
    });
    expect(result.current.tapCount).toBe(1);
    act(() => {
      vi.advanceTimersByTime(2001);
    });
    expect(result.current.tapCount).toBe(0);
    expect(result.current.isActive).toBe(false);
  });

  it("reset() clears tap state immediately", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useTapTempo(cb));
    act(() => {
      result.current.tap();
      result.current.tap();
    });
    expect(result.current.tapCount).toBeGreaterThan(0);
    act(() => {
      result.current.reset();
    });
    expect(result.current.tapCount).toBe(0);
    expect(result.current.isActive).toBe(false);
  });
});
