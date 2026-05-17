/**
 * Shared helpers for zen-mode effects. Read the current theme accent color
 * straight from the CSS custom property so effects re-tint automatically
 * when the theme changes, and parse hex strings into RGB triplets used by
 * canvas effects that need per-channel manipulation.
 */
export function getAccentColor() {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#e94560"
  );
}

export function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
