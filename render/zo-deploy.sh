#!/usr/bin/env bash
# Provision + run the proof render service on a Zo Computer (Linux, root).
# Usage:  bash zo-deploy.sh setup     # one-time: system deps, npm ci, headless browser
#         bash zo-deploy.sh start     # run the server (use Zo "process mode" to keep it up)
set -euo pipefail
cd "$(dirname "$0")" # -> render/

setup() {
  echo "==> 1/4  System deps (ffmpeg + Remotion's headless-chromium shared libs)"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    command -v ffmpeg >/dev/null 2>&1 || apt-get install -y ffmpeg
    # Shared libs chrome-headless-shell needs on a clean Linux box.
    apt-get install -y \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libasound2 libpango-1.0-0 libcairo2 fonts-liberation || true
  else
    echo "    (no apt-get; ensure ffmpeg + chromium libs are present)"
  fi

  echo "==> 2/4  Node deps (npm ci)"
  npm ci

  echo "==> 3/4  Ensure Remotion headless browser"
  npx remotion browser ensure

  echo "==> 4/4  Env check"
  : "${OPENAI_API_KEY:?  set OPENAI_API_KEY}"
  : "${SUPABASE_SERVICE_ROLE_KEY:?  set SUPABASE_SERVICE_ROLE_KEY}"
  if [ -z "${SUPABASE_URL:-}" ] && [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
    echo "  set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)"; exit 1
  fi
  echo "==> setup complete. Start with:  bash zo-deploy.sh start"
}

start() {
  export PORT="${PORT:-8080}"
  echo "==> render service on :$PORT  (POST /render, GET /render/:id, GET /health)"
  exec npm run server
}

case "${1:-start}" in
  setup) setup ;;
  start) start ;;
  *) echo "usage: bash zo-deploy.sh [setup|start]"; exit 1 ;;
esac
