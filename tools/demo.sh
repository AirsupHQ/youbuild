#!/usr/bin/env bash
# Clean browser for recording a YouBuild demo. Same as `npm run demo`.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules/playwright ] || npm install --no-audit --no-fund
npx playwright install chromium >/dev/null
exec node tools/demo.mjs "$@"
