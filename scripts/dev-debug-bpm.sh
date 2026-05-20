#!/usr/bin/env bash
# dev-debug-bpm.sh — single-command dev + session inspector
#
# Usage: bun run dev:debug-bpm <BPM>
#
# Starts the Tauri dev app AND watches session_logs/ in one shot.
# When a session ends, auto-prints inspect-session output and offers
# to bake the log as a dsp_fixture.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$HOME/Library/Application Support/com.yames.metronome/session_logs"

# ── Args ──────────────────────────────────────────────────────────────────────
BPM="${1:-}"
if [[ -z "$BPM" ]]; then
  echo "Usage: bun run dev:debug-bpm <BPM>"
  echo "Example: bun run dev:debug-bpm 140"
  exit 2
fi

# ── PATH setup ────────────────────────────────────────────────────────────────
# Source nvm so 'node' and 'npm' are available without manual exports.
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"
# Fallback: add the known stable node path in case nvm.sh isn't present.
export PATH="$HOME/.nvm/versions/node/v20.15.1/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

# ── Dependency check ──────────────────────────────────────────────────────────
if ! command -v fswatch &>/dev/null; then
  echo "fswatch not found. Install it first:"
  echo "  brew install fswatch"
  exit 1
fi

# ── Banner ────────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════╗"
echo "║  yames dev:debug-bpm ${BPM} BPM                      "
echo "╠══════════════════════════════════════════════════╣"
echo "║  Set the app: BPM=${BPM} | Subdiv=16ths | e-guitar   "
echo "║  Play ~30s, stop session → auto-inspect fires.   "
echo "║  Ctrl+C quits everything.                        "
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Session log watcher (background) ─────────────────────────────────────────
mkdir -p "$LOG_DIR"
WATCHER_PID=""

cleanup() {
  [[ -n "$WATCHER_PID" ]] && kill "$WATCHER_PID" 2>/dev/null || true
  echo ""
  echo "dev:debug-bpm stopped."
}
trap cleanup EXIT INT TERM

(
  fswatch -r "$LOG_DIR" | while IFS= read -r new_file; do
    [[ "$new_file" == *.json ]] || continue
    echo ""
    echo "━━━  Session log detected: $(basename "$new_file")  ━━━"
    cargo run --quiet --bin inspect-session \
      --manifest-path "$REPO_ROOT/src-tauri/Cargo.toml" \
      -- "$new_file"
    echo ""
    printf "Bake as dsp_fixture? (y/n): "
    read -r answer </dev/tty || true
    if [[ "${answer:-n}" == "y" ]]; then
      cargo run --quiet --bin dump-fixture \
        --manifest-path "$REPO_ROOT/src-tauri/Cargo.toml" \
        -- "$new_file"
      echo ""
      echo "Fixture written. Now run:"
      echo "  UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml --test dsp_fixtures"
    fi
  done
) &
WATCHER_PID=$!

# ── Tauri dev (foreground — blocks until you quit the app) ────────────────────
cd "$REPO_ROOT"
npm run tauri dev
