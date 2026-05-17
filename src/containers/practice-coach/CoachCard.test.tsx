/**
 * CoachCard feature preservation tests.
 *
 * Locks in:
 * - Collapsed state renders a "Practice Coach" pill button
 * - Clicking the pill calls onToggle
 * - Open + inactive shows a "Start" button
 * - Open + active shows an "End" button
 * - Start button calls onStartSession
 * - End button calls onEndSession
 * - "History" tab swaps content
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CoachCard from "./CoachCard";

const baseProps = {
  open: true,
  active: false,
  messages: [],
  onToggle: vi.fn(),
  onStartSession: vi.fn(),
  onEndSession: vi.fn(),
};

describe("CoachCard", () => {
  it("renders the collapsed pill when open=false", () => {
    render(<CoachCard {...baseProps} open={false} />);
    expect(
      screen.getByRole("button", { name: /practice coach/i }),
    ).toBeInTheDocument();
  });

  it("collapsed pill click calls onToggle", () => {
    const onToggle = vi.fn();
    render(<CoachCard {...baseProps} open={false} onToggle={onToggle} />);
    const pill = screen.getByRole("button", { name: /practice coach/i });
    fireEvent.click(pill);
    expect(onToggle).toHaveBeenCalled();
  });

  it("open + inactive shows a Start button", () => {
    render(<CoachCard {...baseProps} active={false} />);
    expect(screen.getByRole("button", { name: /^start$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^end$/i })).not.toBeInTheDocument();
  });

  it("open + active shows an End button", () => {
    render(<CoachCard {...baseProps} active={true} />);
    expect(screen.getByRole("button", { name: /^end$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^start$/i })).not.toBeInTheDocument();
  });

  it("clicking Start calls onStartSession", () => {
    const onStartSession = vi.fn();
    render(<CoachCard {...baseProps} active={false} onStartSession={onStartSession} />);
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    expect(onStartSession).toHaveBeenCalled();
  });

  it("clicking End calls onEndSession", () => {
    const onEndSession = vi.fn();
    render(<CoachCard {...baseProps} active={true} onEndSession={onEndSession} />);
    fireEvent.click(screen.getByRole("button", { name: /^end$/i }));
    expect(onEndSession).toHaveBeenCalled();
  });

  it("clicking History tab switches to history view", () => {
    render(<CoachCard {...baseProps} />);
    const tabs = screen.getAllByRole("button");
    const historyTab = tabs.find((t) => t.textContent === "History");
    expect(historyTab).toBeDefined();
    fireEvent.click(historyTab as HTMLElement);
    // The active tab should be History now
    expect(historyTab?.className).toMatch(/active/);
  });

  it("? shortcut opens the card when collapsed (OQ8)", () => {
    const onToggle = vi.fn();
    render(<CoachCard {...baseProps} open={false} onToggle={onToggle} />);
    fireEvent.keyDown(window, { key: "?" });
    expect(onToggle).toHaveBeenCalled();
  });

  it("? shortcut pauses the metronome when playing (OQ8)", () => {
    const onPause = vi.fn();
    render(
      <CoachCard {...baseProps} open={true} isPlaying={true} onPause={onPause} />,
    );
    fireEvent.keyDown(window, { key: "?" });
    expect(onPause).toHaveBeenCalled();
  });

  it("? shortcut does NOT pause when metronome is already paused", () => {
    const onPause = vi.fn();
    render(
      <CoachCard {...baseProps} open={true} isPlaying={false} onPause={onPause} />,
    );
    fireEvent.keyDown(window, { key: "?" });
    expect(onPause).not.toHaveBeenCalled();
  });
});
