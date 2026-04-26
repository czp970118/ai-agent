#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

osascript <<EOF
tell application "Terminal"
  activate
  do script "cd \"$ROOT_DIR\" && npm run dev --prefix next-project"
  do script "cd \"$ROOT_DIR\" && uv run --directory mcp_server python -m uvicorn main:http_app --host 0.0.0.0 --port 8000"
end tell
EOF

echo "Started next-project and mcp_server in separate Terminal windows."
