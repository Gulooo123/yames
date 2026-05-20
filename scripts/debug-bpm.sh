#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HOME/Library/Application Support/com.yames.metronome/session_logs"

# 1. Validate BPM arg
if [[ -z "${1:-}" ]]; then
  echo "Usage: $(basename "$0") <BPM>"
  echo "Example: $(basename "$0") 180"
  exit 2
fi

BPM="$1"

# 2. Check fswatch
if ! command -v fswatch &>/dev/null; then
  echo "fswatch is required but not installed. Install it with:"
  echo "  brew install fswatch"
  exit 1
fi

# 3. Set up PATH so cargo commands work
export PATH="$HOME/.cargo/bin:$PATH"

# 4. Print reminder
echo "Boot the app with \`npm run tauri dev\`, set BPM to ${BPM}, and play ~30 seconds of 16ths. Watching for new session logs... (Ctrl+C to cancel)"

# 5. Trap SIGINT — kill fswatch background process on Ctrl+C
FSWATCH_PID=""
cleanup() {
  if [[ -n "$FSWATCH_PID" ]]; then
    kill "$FSWATCH_PID" 2>/dev/null || true
  fi
  echo ""
  echo "Stopped."
  exit 0
}
trap cleanup INT

# 6. Watch for new .json files and process them
fswatch -r "$LOG_DIR" &
FSWATCH_PID=$!

fswatch -r "$LOG_DIR" | while IFS= read -r new_file; do
  # Filter: only process .json files
  [[ "$new_file" == *.json ]] || continue

  echo ""
  echo "==> New session log: $new_file"

  # 7. Run inspect-session
  cargo run --bin inspect-session --manifest-path "$SCRIPT_DIR/../src-tauri/Cargo.toml" -- "$new_file"

  # 8. Prompt for fixture bake
  printf "Bake as fixture? (y/n): "
  read -r answer </dev/tty
  if [[ "$answer" == "y" ]]; then
    cargo run --bin dump-fixture --manifest-path "$SCRIPT_DIR/../src-tauri/Cargo.toml" -- "$new_file"
    echo "Next: UPDATE_FIXTURES=1 cargo test --manifest-path src-tauri/Cargo.toml --test dsp_fixtures"
  fi

  # 9. Continue watching (loop back to reading the next fswatch line)
done
