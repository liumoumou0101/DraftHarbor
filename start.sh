#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "========================================"
echo "  DraftHarbor Desktop Preview"
echo "========================================"
echo ""
echo "This starts the Electron desktop mainline:"
echo "  draftharbor://app/desktop.html"
echo ""
echo "It does not start the legacy web server or bind port 8000."
echo ""

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm was not found. Install Node.js first."
  exit 1
fi

if [ ! -x "node_modules/.bin/electron" ]; then
  echo "[INFO] Dependencies are missing. Running npm install..."
  npm install
fi

echo "[INFO] Starting desktop app..."
echo "[INFO] Close the app window to stop preview."
echo ""

npm run desktop
