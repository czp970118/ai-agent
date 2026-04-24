#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

osascript <<EOF
tell application "Terminal"
  activate
  do script "cd \"$ROOT_DIR\" && npm run dev --prefix next-project"
  do script "cd \"$ROOT_DIR\" && uv run --directory mcp_server python -m uvicorn main:http_app --host 0.0.0.0 --port 8000"
  do script "cd \"$ROOT_DIR\" && npm run start --prefix n8n-local"
end tell
EOF

echo "Started next-project, mcp_server, and n8n-local in separate Terminal windows."
