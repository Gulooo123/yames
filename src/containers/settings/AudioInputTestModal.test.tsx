/**
 * AudioInputTestModal feature preservation tests.
 *
 * Locks in:
 * - Renders when open=true
 * - Does NOT render when open=false (overlay absent)
 * - Close button calls onClose
 * - Clicking the overlay calls onClose
 * - Gain slider range is 0..40
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AudioInputTestModal from "./AudioInputTestModal";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  selectedDevice: undefined,
  onDeviceChange: vi.fn(),
};

describe("AudioInputTestModal", () => {
  it("renders the modal heading when open", () => {
    const { container } = render(<AudioInputTestModal {...baseProps} />);
    const heading = container.querySelector("h3");
    expect(heading?.textContent).toMatch(/Test Audio Input/i);
  });

  it("does not render an overlay when open=false", () => {
    const { container } = render(
      <AudioInputTestModal {...baseProps} open={false} />,
    );
    const overlay = container.querySelector(".input-test-modal-overlay");
    expect(overlay).toBeNull();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AudioInputTestModal {...baseProps} onClose={onClose} />,
    );
    const closeBtn = container.querySelector(".input-test-modal-close") as HTMLElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the overlay calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AudioInputTestModal {...baseProps} onClose={onClose} />,
    );
    const overlay = container.querySelector(".input-test-modal-overlay") as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("gain slider has range 0..40", () => {
    const { container } = render(<AudioInputTestModal {...baseProps} />);
    const slider = container.querySelector(".input-test-gain-slider") as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("40");
  });
});
