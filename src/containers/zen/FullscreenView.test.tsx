/**
 * FullscreenView feature preservation tests.
 *
 * Locks in:
 * - Renders the BPM display
 * - Escape key calls onExit
 * - Double-click on the root calls onExit
 * - Renders 7 zen-style options (focus/pulse/gravity/radar/cosmos/warp/rain)
 *   when the theme picker is opened
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { FullscreenView } from "./FullscreenView";
import { DEFAULT_TEST_STATE } from "../../test/mocks";

const baseProps = {
  state: DEFAULT_TEST_STATE,
  currentBeat: null,
  activeTab: "beat" as const,
};

describe("FullscreenView", () => {
  it("renders the BPM number", () => {
    const { container } = render(
      <FullscreenView {...baseProps} onExit={vi.fn()} />,
    );
    const bpm = container.querySelector(".fs-bpm");
    expect(bpm?.textContent).toContain("120");
  });

  it("pressing Escape calls onExit", () => {
    const onExit = vi.fn();
    render(<FullscreenView {...baseProps} onExit={onExit} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onExit).toHaveBeenCalled();
  });

  it("double-click on the root calls onExit", () => {
    const onExit = vi.fn();
    const { container } = render(
      <FullscreenView {...baseProps} onExit={onExit} />,
    );
    const root = container.querySelector(".fullscreen-view") as HTMLElement;
    fireEvent.doubleClick(root);
    expect(onExit).toHaveBeenCalled();
  });

  it("clicking theme trigger reveals 7 zen-style options", async () => {
    const { container } = render(
      <FullscreenView {...baseProps} onExit={vi.fn()} />,
    );
    const trigger = container.querySelector(".zen-theme-trigger") as HTMLElement;
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => {
      const opts = container.querySelectorAll(".zen-theme-option");
      expect(opts.length).toBe(7);
    });
  });
});
