#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CODEX_HOME:-}" ]]; then
  export CODEX_HOME="${HOME}/.codex"
fi

WEB_GAME_CLIENT="${CODEX_HOME}/skills/develop-web-game/scripts/web_game_playwright_client.js"

if [[ ! -f "${WEB_GAME_CLIENT}" ]]; then
  echo "Missing Playwright client script: ${WEB_GAME_CLIENT}" >&2
  exit 1
fi

URL="${1:-http://localhost:5173}"

node "${WEB_GAME_CLIENT}" \
  --url "${URL}" \
  --actions-file "tests/smoke_steps.json" \
  --iterations 1 \
  --pause-ms 250 \
  --screenshot-dir "output/web-game"

