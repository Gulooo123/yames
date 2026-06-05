#!/usr/bin/env bash
# take-screenshots.sh — automate all docs/img/ screenshot capture for yames.app
#
# Usage:
#   ./scripts/take-screenshots.sh                   # run all 100 shots
#   ./scripts/take-screenshots.sh --dry-run         # print plan, no app launch
#   ./scripts/take-screenshots.sh --test            # 4 smoke shots (1 per section) → /tmp/yames-test/
#   ./scripts/take-screenshots.sh --smoke [theme]   # 10 shots for one theme (all variants) → /tmp/yames-smoke/
#
# Requirements: macOS, osascript, screencapture, python3, swift
# App must be installed at /Applications/Yames.app (preferred) or built locally.

set -euo pipefail

THEMES=(obsidian mono velvet neon aurora ivory arctic sand lavender prism)
ZEN_STYLES=(focus pulse gravity sweep cosmos warp rain)
TOTAL=100
WRITTEN=0
FAILED=0

SETTINGS_FILE="$HOME/Library/Application Support/com.yames.metronome/settings.json"
APP_PRIMARY="/Applications/Yames.app"
APP_DEV="$(pwd)/src-tauri/target/release/bundle/macos/Yames.app"

DRY_RUN=false
TEST_MODE=false
SMOKE_MODE=false
SMOKE_THEME="obsidian"
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true
[[ "${1:-}" == "--test"    ]] && TEST_MODE=true
if [[ "${1:-}" == "--smoke" ]]; then
  SMOKE_MODE=true
  [[ -n "${2:-}" ]] && SMOKE_THEME="${2}"
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

# Write theme/tab/zenStyle to settings.json, preserving all other keys.
write_settings() {
  local theme="$1" tab="$2" zen_style="$3"
  python3 - "$SETTINGS_FILE" "$theme" "$tab" "$zen_style" <<'PYEOF'
import json, sys, os
path, theme, tab, zen_style = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    with open(path) as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {}
data["theme"] = theme
data["activeTab"] = tab
data["zenStyle"] = zen_style  # always write (empty string clears it for non-zen shots)
data["isPlaying"] = False     # force stopped state on each launch
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
}

find_app() {
  if   [[ -d "$APP_PRIMARY" ]]; then echo "$APP_PRIMARY"
  elif [[ -d "$APP_DEV"     ]]; then echo "$APP_DEV"
  else echo ""
  fi
}

launch_and_wait() {
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true
  pkill -9 -x yames 2>/dev/null || true
  sleep 0.5
  # Kill System Events so it re-discovers the new yames instance's windows cleanly.
  # (Stale System Events cache returns 0 windows for freshly launched apps.)
  killall "System Events" 2>/dev/null || true
  sleep 1.5
  open "$APP"
  # Wait up to 15 seconds for System Events to register the window
  local i=0
  while [[ $i -lt 15 ]]; do
    local w
    w=$(osascript -e 'tell application "System Events" to tell process "yames" to count windows' 2>/dev/null || echo "0")
    [[ "$w" -gt 0 ]] && return 0
    sleep 1
    i=$((i + 1))
  done
  echo "  [warn] window still not ready after 15s" >&2
}

# Resize the main window to 1400 × 1050 at origin (0,0).
# ensure_main_window() already closes the floating widget before this runs,
# so window 1 is always the main window here — no need for size-based lookup.
resize_main_window() {
  osascript <<'AS' 2>/dev/null || true
tell application "System Events"
  tell process "yames"
    set position of window 1 to {0, 0}
    set size of window 1 to {1400, 1050}
  end tell
end tell
AS
  sleep 0.3
}

# Return x,y,w,h of window 1 (comma-separated, no spaces).
get_main_window_bounds() {
  osascript <<'AS'
tell application "System Events"
  tell process "yames"
    set pos to position of window 1
    set sz to size of window 1
    return ((item 1 of pos) as text) & "," & ((item 2 of pos) as text) & "," & ((item 1 of sz) as text) & "," & ((item 2 of sz) as text)
  end tell
end tell
AS
}

# Return x,y,w,h of the smallest Yames window (the floating pill widget).
get_widget_bounds() {
  osascript <<'AS'
tell application "System Events"
  tell process "yames"
    set allWins to every window
    set smallest to missing value
    set smallestArea to 2147483647
    repeat with w in allWins
      set sz to size of w
      set area to (item 1 of sz) * (item 2 of sz)
      if area < smallestArea then
        set smallestArea to area
        set smallest to w
      end if
    end repeat
    if smallest is not missing value then
      set pos to position of smallest
      set sz to size of smallest
      return ((item 1 of pos) as text) & "," & ((item 2 of pos) as text) & "," & ((item 1 of sz) as text) & "," & ((item 2 of sz) as text)
    end if
  end tell
end tell
AS
}

# Pre-compiled Swift helper binary (compiled once on first call).
_WIDGET_WID_BIN=/tmp/yames_widget_wid

# Return the CGWindowID of the smallest Yames window via a compiled Swift helper.
# screencapture -l <id> -o captures only that window without background bleed.
# Falls back to empty string if compilation fails.
get_widget_cgwindowid() {
  if [[ ! -x "$_WIDGET_WID_BIN" ]]; then
    local src
    src=$(mktemp /tmp/yames_wid_XXXXXX.swift)
    cat > "$src" <<'SWEOF'
import CoreGraphics
if let list = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
) as? [[String: Any]] {
    let yames = list.filter {
        ($0["kCGWindowOwnerName"] as? String ?? "").lowercased().contains("yames")
    }
    if let w = yames.min(by: {
        let b0 = $0["kCGWindowBounds"] as? [String: Any] ?? [:]
        let b1 = $1["kCGWindowBounds"] as? [String: Any] ?? [:]
        let a0 = (b0["Width"] as? Double ?? 0) * (b0["Height"] as? Double ?? 0)
        let a1 = (b1["Width"] as? Double ?? 0) * (b1["Height"] as? Double ?? 0)
        return a0 < a1
    }) {
        print(w["kCGWindowNumber"] as? Int ?? "")
    }
}
SWEOF
    swiftc -O "$src" -o "$_WIDGET_WID_BIN" 2>/dev/null || true
    rm -f "$src"
  fi
  [[ -x "$_WIDGET_WID_BIN" ]] && "$_WIDGET_WID_BIN" 2>/dev/null || echo ""
}

# Hide every visible app except yames so screencapture -R regions are clean.
# (Other apps, e.g. Slack, can bleed into the capture region from the right edge.)
hide_other_apps() {
  osascript <<'AS' 2>/dev/null || true
tell application "System Events"
  repeat with p in (every process where visible is true)
    if name of p is not "yames" and name of p is not "Yames" then
      set visible of p to false
    end if
  end repeat
end tell
AS
}

# Bring the app to a known normal state after launch:
#   1. Press Escape — exits zen mode if the app restored to that state (no-op otherwise)
#   2. If window is widget-sized (< 400px wide), send W to exit widget mode
#   3. Cmd+1 — land on the metronome tab so every shot starts from a known tab
#   4. Hide all other apps so no foreign windows bleed into the capture region
ensure_main_window() {
  # Escape exits zen if active; harmless if not
  osascript -e 'tell application "System Events" to tell process "yames" to key code 53' 2>/dev/null || true
  sleep 0.5

  local w
  w=$(osascript -e 'tell application "System Events" to tell process "yames" to item 1 of (get size of window 1)' 2>/dev/null || echo "0")
  if [[ "$w" -lt 400 ]]; then
    osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
    sleep 1.0
  fi

  # Always land on the metronome tab so subsequent keystrokes target the right view
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "1" using {command down}' 2>/dev/null || true
  sleep 0.3

  # Close the floating widget if it is open (> 1 window means widget is visible).
  # Drill/metronome/zen captures use the CSS overlay on the website — the real
  # widget window must not bleed into the main-window region capture.
  local wc
  wc=$(osascript -e 'tell application "System Events" to tell process "yames" to count windows' 2>/dev/null || echo "1")
  if [[ "$wc" -gt 1 ]]; then
    osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
    sleep 0.5
  fi

  # Hide all other apps — prevents bleed from e.g. Slack in the capture region
  hide_other_apps
}

# After opening the coach panel, click HISTORY tab then the top session entry
# so the full session detail report is visible in the screenshot.
#
# Coordinates are relative to the web content area of the window.
# With window at pos {win_x, win_y} and macOS native title bar ≈ 28px:
#   HISTORY tab   → web (1258, 115)
#   Top session   → web (1170, 320)   (first card in the list)
navigate_to_coach_history() {
  local pos win_x win_y
  pos=$(osascript -e 'tell application "System Events" to tell process "yames" to get position of window 1' 2>/dev/null || echo "0, 0")
  IFS=',' read -r win_x win_y <<< "$pos"
  win_x=$(echo "$win_x" | tr -d ' ')
  win_y=$(echo "$win_y" | tr -d ' ')

  # Coordinates are window-relative (screenshot coords = top-left of window frame).
  # Do NOT add an extra title-bar offset — win_y already places us at the frame top.
  # HISTORY tab: (1264, 122)
  osascript -e "tell application \"System Events\" to tell process \"yames\" to click at {$((win_x + 1264)), $((win_y + 122))}" > /dev/null
  sleep 0.4

  # Most recent session entry in the history list: (1170, 255) — the Thursday card
  osascript -e "tell application \"System Events\" to tell process \"yames\" to click at {$((win_x + 1170)), $((win_y + 255))}" > /dev/null
  sleep 0.5

  # Blur the HISTORY tab's focus ring by clicking the inert score-circle area
  # in the session detail (non-focusable div → blurs active element, no action).
  osascript -e "tell application \"System Events\" to tell process \"yames\" to click at {$((win_x + 1175)), $((win_y + 205))}" > /dev/null
  sleep 0.2
}

# Capture a region to file given "x,y,w,h" string.
capture_region() {
  local bounds="$1" out="$2"
  local x y w h
  IFS=',' read -r x y w h <<< "$bounds"
  screencapture -R "${x},${y},${w},${h}" "$out"
}


# ── Dry run ───────────────────────────────────────────────────────────────────

if $DRY_RUN; then
  echo "--- DRY RUN: ${TOTAL} shots ---"
  n=0
  for theme in "${THEMES[@]}"; do
    n=$((n+1))
    printf "[%d/%d]  docs/img/metronome/%s-metronome.png  (coach open)\n" "$n" "$TOTAL" "$theme"
  done
  for theme in "${THEMES[@]}"; do
    n=$((n+1))
    printf "[%d/%d]  docs/img/drill/%s-drill.png\n" "$n" "$TOTAL" "$theme"
  done
  for theme in "${THEMES[@]}"; do
    for style in "${ZEN_STYLES[@]}"; do
      n=$((n+1))
      printf "[%d/%d]  docs/img/zen/%s-%s.png\n" "$n" "$TOTAL" "$theme" "$style"
    done
  done
  for theme in "${THEMES[@]}"; do
    n=$((n+1))
    printf "[%d/%d]  docs/img/widget/%s-widget.png\n" "$n" "$TOTAL" "$theme"
  done
  exit 0
fi

# ── Preflight ─────────────────────────────────────────────────────────────────

APP=$(find_app)
if [[ -z "$APP" ]]; then
  echo "Error: Yames.app not found." >&2
  echo "  Checked: $APP_PRIMARY" >&2
  echo "  Checked: $APP_DEV" >&2
  exit 1
fi

# ── Test mode — 4 smoke shots (1 per section) saved to /tmp/yames-test/ ───────

if $TEST_MODE; then
  TEST_DIR="/tmp/yames-test"
  mkdir -p "$TEST_DIR"
  echo "App:  $APP"
  echo "Test: 4 smoke shots → $TEST_DIR/"
  echo ""

  # 1. metronome (coach open)
  printf "[1/4] obsidian-metronome.png (coach history) ..."
  write_settings "obsidian" "beat" ""
  launch_and_wait; ensure_main_window; resize_main_window
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "c"'
  sleep 0.8
  navigate_to_coach_history
  if capture_region "$(get_main_window_bounds)" "$TEST_DIR/obsidian-metronome.png"; then
    echo " ✓"; else echo " ✗ FAILED"; fi
  # Close coach before killing so drill launches with panel closed
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "c"'
  sleep 0.3
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  # 2. drill
  printf "[2/4] obsidian-drill.png ..."
  write_settings "obsidian" "drill" ""
  launch_and_wait; ensure_main_window; resize_main_window
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "2" using {command down}'
  sleep 0.6
  if capture_region "$(get_main_window_bounds)" "$TEST_DIR/obsidian-drill.png"; then
    echo " ✓"; else echo " ✗ FAILED"; fi
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  # 3. zen (playing, rain style)
  printf "[3/4] obsidian-rain.png (zen/rain, playing) ..."
  write_settings "obsidian" "beat" "rain"
  launch_and_wait; ensure_main_window; resize_main_window
  # ensure_main_window already navigated to the metronome tab (cmd+1).
  # Bring window to front without clicking (clicking hits the TAP button).
  osascript -e 'tell application "System Events" to tell process "yames" to set frontmost to true'
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke " "'
  sleep 0.8
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "z"'
  sleep 2.5
  if capture_region "$(get_main_window_bounds)" "$TEST_DIR/obsidian-rain.png"; then
    echo " ✓"; else echo " ✗ FAILED"; fi
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  # 4. widget
  printf "[4/4] obsidian-widget.png ..."
  write_settings "obsidian" "beat" ""
  launch_and_wait
  # Do NOT resize before widget — resizing to 1400×900 fights Tauri's widget state
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
  sleep 1.0
  wid=$(get_widget_cgwindowid)
  if [[ -n "$wid" ]]; then
    screencapture -l "$wid" -o "$TEST_DIR/obsidian-widget.png" && echo " ✓" || echo " ✗ FAILED"
  elif capture_region "$(get_widget_bounds)" "$TEST_DIR/obsidian-widget.png"; then
    echo " ✓"; else echo " ✗ FAILED"; fi
  # Exit widget → exit zen if restored → metronome tab → stop playback → kill
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
  sleep 0.8
  osascript -e 'tell application "System Events" to tell process "yames" to key code 53' 2>/dev/null || true
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "1" using {command down}' 2>/dev/null || true
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke " "' 2>/dev/null || true
  sleep 0.3
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  echo ""
  echo "Done. Open to inspect:"
  echo "  open $TEST_DIR"
  exit 0
fi

# ── Smoke mode — all 10 shots for one theme (1 metro + 1 drill + 7 zen + 1 widget) ──

if $SMOKE_MODE; then
  SMOKE_DIR="/tmp/yames-smoke"
  mkdir -p "$SMOKE_DIR"
  theme="$SMOKE_THEME"
  total=10
  n=0
  echo "App:   $APP"
  echo "Theme: $theme"
  printf "Smoke: %d shots → %s/\n\n" "$total" "$SMOKE_DIR"

  # metronome
  n=$((n+1))
  printf "[%d/%d] %s-metronome.png (coach history) ..." "$n" "$total" "$theme"
  write_settings "$theme" "beat" ""
  launch_and_wait; ensure_main_window; resize_main_window
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "c"'
  sleep 0.8
  navigate_to_coach_history
  if capture_region "$(get_main_window_bounds)" "$SMOKE_DIR/${theme}-metronome.png"; then
    echo " ✓"; else echo " ✗ FAILED"; fi
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "c"'
  sleep 0.3
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  # drill
  n=$((n+1))
  printf "[%d/%d] %s-drill.png ..." "$n" "$total" "$theme"
  write_settings "$theme" "drill" ""
  launch_and_wait; ensure_main_window; resize_main_window
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "2" using {command down}'
  sleep 0.6
  if capture_region "$(get_main_window_bounds)" "$SMOKE_DIR/${theme}-drill.png"; then
    echo " ✓"; else echo " ✗ FAILED"; fi
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  # zen — one launch per theme; cycle all 7 styles via the in-zen style picker.
  # Picker is in the top-right corner. Coordinates are SCREEN-absolute:
  #   trigger center: (win_x + win_w - 78,  win_y + 34)
  #   option i center: same x, (win_y + opt_y)  where opt_y = 76 + i*36
  write_settings "$theme" "beat" "focus"
  launch_and_wait; ensure_main_window; resize_main_window
  osascript -e 'tell application "System Events" to tell process "yames" to set frontmost to true'
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke " "'
  sleep 0.8
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "z"'
  sleep 2.0
  zen_bounds=$(get_main_window_bounds)
  win_x=$(echo "$zen_bounds" | cut -d, -f1 | tr -d ' ')
  win_y=$(echo "$zen_bounds" | cut -d, -f2 | tr -d ' ')
  win_w=$(echo "$zen_bounds" | cut -d, -f3 | tr -d ' ')
  trig_x=$((win_x + win_w - 78))
  trig_y=$((win_y + 34))
  echo "  [debug] bounds=${zen_bounds}  trig=(${trig_x},${trig_y})" >&2
  for style in "${ZEN_STYLES[@]}"; do
    n=$((n+1))
    printf "[%d/%d] %s-%s.png (zen) ..." "$n" "$total" "$theme" "$style"
    case "$style" in
      focus)   opt_y=76  ;;
      pulse)   opt_y=112 ;;
      gravity) opt_y=148 ;;
      sweep)   opt_y=184 ;;
      cosmos)  opt_y=220 ;;
      warp)    opt_y=256 ;;
      rain)    opt_y=292 ;;
    esac
    osascript -e "tell application \"System Events\" to tell process \"yames\" to click at {$trig_x, $trig_y}" > /dev/null
    sleep 0.35
    osascript -e "tell application \"System Events\" to tell process \"yames\" to click at {$trig_x, $((win_y + opt_y))}" > /dev/null
    sleep 1.5
    if capture_region "$zen_bounds" "$SMOKE_DIR/${theme}-${style}.png"; then
      echo " ✓"; else echo " ✗ FAILED"; fi
  done
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  # widget
  n=$((n+1))
  printf "[%d/%d] %s-widget.png ..." "$n" "$total" "$theme"
  write_settings "$theme" "beat" ""
  launch_and_wait
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
  sleep 1.0
  wid=$(get_widget_cgwindowid)
  if [[ -n "$wid" ]]; then
    screencapture -l "$wid" -o "$SMOKE_DIR/${theme}-widget.png" && echo " ✓" || echo " ✗ FAILED"
  elif capture_region "$(get_widget_bounds)" "$SMOKE_DIR/${theme}-widget.png"; then
    echo " ✓"; else echo " ✗ FAILED"; fi
  # Exit widget → exit zen if restored → metronome tab → stop playback → kill
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
  sleep 0.8
  osascript -e 'tell application "System Events" to tell process "yames" to key code 53' 2>/dev/null || true
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "1" using {command down}' 2>/dev/null || true
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke " "' 2>/dev/null || true
  sleep 0.3
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true

  echo ""
  echo "Done. Open to inspect:"
  echo "  open $SMOKE_DIR"
  exit 0
fi

echo "App:  $APP"
echo "Dest: docs/img/{metronome,drill,zen,widget}/"
echo ""

mkdir -p docs/img/metronome docs/img/drill docs/img/zen docs/img/widget

# ── Metronome shots — coach panel open ───────────────────────────────────────

n=0
for theme in "${THEMES[@]}"; do
  n=$((n+1))
  out="docs/img/metronome/${theme}-metronome.png"
  printf "[%d/%d] %s-metronome.png ..." "$n" "$TOTAL" "$theme"
  write_settings "$theme" "beat" ""
  launch_and_wait
  ensure_main_window
  resize_main_window
  # Open coach panel, navigate to HISTORY tab, click most recent session
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "c"'
  sleep 0.8
  navigate_to_coach_history
  if capture_region "$(get_main_window_bounds)" "$out"; then
    WRITTEN=$((WRITTEN+1)); echo " ✓"
  else
    FAILED=$((FAILED+1)); echo " ✗ FAILED"
  fi
  # Close coach before killing so the next shot (drill) launches with panel closed
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "c"'
  sleep 0.3
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true
done

# ── Drill shots ───────────────────────────────────────────────────────────────

for theme in "${THEMES[@]}"; do
  n=$((n+1))
  out="docs/img/drill/${theme}-drill.png"
  printf "[%d/%d] %s-drill.png ..." "$n" "$TOTAL" "$theme"
  write_settings "$theme" "drill" ""
  launch_and_wait
  ensure_main_window
  resize_main_window
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "2" using {command down}'
  sleep 0.6
  if capture_region "$(get_main_window_bounds)" "$out"; then
    WRITTEN=$((WRITTEN+1)); echo " ✓"
  else
    FAILED=$((FAILED+1)); echo " ✗ FAILED"
  fi
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true
done

# ── Zen shots (10 themes × 7 styles = 70 shots) ───────────────────────────────
# One app launch per theme; cycle all 7 styles via the in-zen style picker.
# Picker is in the top-right corner: trigger at (screen_w-78, 34),
# options stacked vertically at the same x from y=76 to y=292 (step 36px).

for theme in "${THEMES[@]}"; do
  write_settings "$theme" "beat" "focus"
  launch_and_wait
  ensure_main_window
  resize_main_window
  osascript -e 'tell application "System Events" to tell process "yames" to set frontmost to true'
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke " "'
  sleep 0.8
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "z"'
  sleep 2.0
  zen_bounds=$(get_main_window_bounds)
  win_x=$(echo "$zen_bounds" | cut -d, -f1 | tr -d ' ')
  win_y=$(echo "$zen_bounds" | cut -d, -f2 | tr -d ' ')
  win_w=$(echo "$zen_bounds" | cut -d, -f3 | tr -d ' ')
  trig_x=$((win_x + win_w - 78))
  trig_y=$((win_y + 34))
  for style in "${ZEN_STYLES[@]}"; do
    n=$((n+1))
    out="docs/img/zen/${theme}-${style}.png"
    printf "[%d/%d] %s-%s.png ..." "$n" "$TOTAL" "$theme" "$style"
    case "$style" in
      focus)   opt_y=76  ;;
      pulse)   opt_y=112 ;;
      gravity) opt_y=148 ;;
      sweep)   opt_y=184 ;;
      cosmos)  opt_y=220 ;;
      warp)    opt_y=256 ;;
      rain)    opt_y=292 ;;
    esac
    osascript -e "tell application \"System Events\" to tell process \"yames\" to click at {$trig_x, $trig_y}" > /dev/null
    sleep 0.35
    osascript -e "tell application \"System Events\" to tell process \"yames\" to click at {$trig_x, $((win_y + opt_y))}" > /dev/null
    sleep 1.5
    if capture_region "$zen_bounds" "$out"; then
      WRITTEN=$((WRITTEN+1)); echo " ✓"
    else
      FAILED=$((FAILED+1)); echo " ✗ FAILED"
    fi
  done
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true
done

# ── Widget shots — capture the floating pill window ───────────────────────────

for theme in "${THEMES[@]}"; do
  n=$((n+1))
  out="docs/img/widget/${theme}-widget.png"
  printf "[%d/%d] %s-widget.png ..." "$n" "$TOTAL" "$theme"
  write_settings "$theme" "beat" ""
  launch_and_wait
  # Do NOT resize before widget — resizing to 1400×900 fights Tauri's widget state
  # Open the floating widget (lowercase "w" — same key as toggle-widget hotkey W)
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
  sleep 1.0
  wid=$(get_widget_cgwindowid)
  if [[ -n "$wid" ]]; then
    if screencapture -l "$wid" -o "$out"; then
      WRITTEN=$((WRITTEN+1)); echo " ✓"
    else
      FAILED=$((FAILED+1)); echo " ✗ FAILED"
    fi
  elif capture_region "$(get_widget_bounds)" "$out"; then
    WRITTEN=$((WRITTEN+1)); echo " ✓"
  else
    FAILED=$((FAILED+1)); echo " ✗ FAILED"
  fi
  # Exit widget → exit zen if restored → metronome tab → stop playback → kill
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "w"'
  sleep 0.8
  osascript -e 'tell application "System Events" to tell process "yames" to key code 53' 2>/dev/null || true
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke "1" using {command down}' 2>/dev/null || true
  sleep 0.3
  osascript -e 'tell application "System Events" to tell process "yames" to keystroke " "' 2>/dev/null || true
  sleep 0.3
  pkill -9 -x yames 2>/dev/null || true; pkill -9 -x Yames 2>/dev/null || true
done

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
printf "┌──────────────────────────┐\n"
printf "│  Shots written : %-3d      │\n" "$WRITTEN"
printf "│  Failed        : %-3d      │\n" "$FAILED"
printf "│  Total         : %-3d      │\n" "$TOTAL"
printf "└──────────────────────────┘\n"

[[ $FAILED -eq 0 ]]
