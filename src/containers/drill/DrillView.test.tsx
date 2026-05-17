/**
 * DrillView feature preservation tests.
 *
 * Locks in:
 * - Renders the BPM grid based on speedRamp config (start, target, increment)
 * - Linear/Zigzag/Adaptive mode toggle buttons exist
 * - Clicking a grid cell calls start_speed_ramp_from with stepIdx + bpm + barIdx
 * - Cyclic toggle switches the speed_ramp.cyclic flag
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DrillView } from "./DrillView";
import { mockInvoke, DEFAULT_TEST_STATE } from "../../test/mocks";
import type { AppState } from "../../types";

const drillState: AppState = {
  ...DEFAULT_TEST_STATE,
  speedRamp: {
    ...DEFAULT_TEST_STATE.speedRamp,
    startBpm: 80,
    targetBpm: 100,
    increment: 10,
    decrement: 5,
    barsPerStep: 2,
    beatsPerBar: 4,
    mode: "linear",
    cyclic: false,
    aggressiveness: "moderate",
    active: false,
    warmupBeats: 4,
  },
};

describe("DrillView", () => {
  it("renders mode toggle buttons (Linear/Zigzag/Adaptive)", () => {
    render(<DrillView state={drillState} currentBeat={null} animations={false} />);
    expect(screen.getByRole("button", { name: /linear/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zigzag/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /adaptive/i })).toBeInTheDocument();
  });

  it("renders BPM grid cells for each step (80, 90, 100)", () => {
    const { container } = render(
      <DrillView state={drillState} currentBeat={null} animations={false} />,
    );
    // start=80, target=100, increment=10 → steps: 80, 90, 100
    const bpmLabels = container.querySelectorAll(".drill-grid-bpm");
    const bpms = Array.from(bpmLabels).map((el) => el.textContent);
    expect(bpms).toEqual(["80", "90", "100"]);
  });

  it("clicking a grid cell calls start_speed_ramp_from", async () => {
    const { container } = render(
      <DrillView state={drillState} currentBeat={null} animations={false} />,
    );
    const cells = container.querySelectorAll(".drill-grid-cell");
    expect(cells.length).toBeGreaterThan(0);
    fireEvent.click(cells[0] as Element);
    await waitFor(() => {
      // first cell of first row → step=0, bpm=80, bar=0
      expect(mockInvoke).toHaveBeenCalledWith(
        "start_speed_ramp_from",
        expect.objectContaining({ step: 0, bpm: 80, bar: 0 }),
      );
    });
  });

  it("clicking Cyclic toggle calls configure_speed_ramp with cyclic=true", async () => {
    render(<DrillView state={drillState} currentBeat={null} animations={false} />);
    // The "Cyclic" toggle is rendered next to a label with that text.
    const cyclicLabel = screen.getByText("Cyclic");
    const toggleBtn = cyclicLabel.parentElement?.querySelector(".toggle-btn") as HTMLElement;
    expect(toggleBtn).not.toBeNull();
    fireEvent.click(toggleBtn);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "configure_speed_ramp",
        expect.objectContaining({ cyclic: true }),
      );
    });
  });
});
