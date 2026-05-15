#!/usr/bin/env bash
# * Copies quiz SFX blobs from repo `sounds/` into `games/sounds/` for local `npm run dev`
# * (Docker pulls them via webserver/Dockerfile instead).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for sub in buzzers good bad others; do
  mkdir -p "${ROOT}/games/sounds/${sub}"
  cp -f "${ROOT}/sounds/${sub}"/*.mp3 "${ROOT}/games/sounds/${sub}/"
done
echo "Synced sounds → games/sounds/{buzzers,good,bad,others}"
