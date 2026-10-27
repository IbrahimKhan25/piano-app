#!/bin/bash
# Starts the piano app and opens it in Chrome. Stop it with Ctrl+C.
# Usage (in the VS Code terminal):  ./start.sh
# Set NO_BROWSER=1 to skip opening Chrome.

cd "$(dirname "$0")" || exit 1

# Homebrew's folder isn't always on the PATH of a non-login shell.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node first (brew install node), then try again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "The project's packages are missing. Run 'npm install' once, then start again."
  exit 1
fi

PORT=5173 # dont change ts or the saved fingerings will be lost
URL="http://localhost:$PORT"

# Your saved fingerings, loop and hand choice are stored per address, so always use the same port.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use: the app may already be running at $URL."
  echo "Stop the old copy first (Ctrl+C in its terminal), or find it with:"
  echo "  lsof -nP -iTCP:$PORT -sTCP:LISTEN"
  exit 1
fi

# Open the page a moment after the server starts (Chrome is needed for Web MIDI).
if [ -z "$NO_BROWSER" ]; then
  (
    sleep 2
    open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
  ) &
fi

echo "Starting the piano app at $URL  (Ctrl+C to stop)"
exec npm run dev -- --port "$PORT" --strictPort
