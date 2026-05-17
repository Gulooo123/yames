/**
 * TrackView feature preservation tests.
 *
 * Locks in:
 * - Renders the "Pocket Check" heading in the default idle state
 * - Idle state shows Start, Calibrate, and History buttons
 * - History button is disabled when history is empty
 * - Renders all 5 rating legend items (metronomic/tight/solid/loose/miss)
 * - Description copy adapts to evaluationEnabled flag
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TrackView } from "./TrackView";
import { DEFAULT_TEST_STATE } from "../../test/mocks";

const baseProps = {
  state: DEFAULT_TEST_STATE,
  currentBeat: null,
};

describe("TrackView", () => {
  it("renders the 'Pocket Check' heading in idle state", async () => {
    render(<TrackView {...baseProps} ref={vi.fn()} />);
    expect(await screen.findByText(/Pocket Check/i)).toBeInTheDocument();
  });

  it("renders Start, Calibrate, and History buttons in idle state", async () => {
    render(<TrackView {...baseProps} ref={vi.fn()} />);
    await screen.findByText(/Pocket Check/i);
    expect(screen.getByRole("button", { name: /^start$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^calibrate$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^history$/i })).toBeInTheDocument();
  });

  it("disables the History button when history is empty", async () => {
    render(<TrackView {...baseProps} ref={vi.fn()} />);
    const historyBtn = (await screen.findByRole("button", {
      name: /^history$/i,
    })) as HTMLButtonElement;
    expect(historyBtn.disabled).toBe(true);
  });

  it("renders 5 rating legend items", async () => {
    const { container } = render(<TrackView {...baseProps} ref={vi.fn()} />);
    await screen.findByText(/Pocket Check/i);
    await waitFor(() => {
      const legend = container.querySelectorAll(".track-legend-item");
      expect(legend.length).toBe(5);
    });
  });

  it("description mentions tapping when evaluationEnabled is false", async () => {
    render(<TrackView {...baseProps} ref={vi.fn()} evaluationEnabled={false} />);
    await screen.findByText(/Pocket Check/i);
    expect(screen.getByText(/Tap along with the metronome/i)).toBeInTheDocument();
  });

  it("description mentions playing when evaluationEnabled is true", async () => {
    render(<TrackView {...baseProps} ref={vi.fn()} evaluationEnabled={true} />);
    await screen.findByText(/Pocket Check/i);
    expect(screen.getByText(/Play along with the metronome/i)).toBeInTheDocument();
  });
});
