#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export XHS_SQLITE_PATH="${XHS_SQLITE_PATH:-$ROOT_DIR/mcp_server/data/xhs_cache.local.db}"
export XHS_PLAYWRIGHT_HEADLESS="${XHS_PLAYWRIGHT_HEADLESS:-0}"
export XHS_SEARCH_TIMEOUT_SECONDS="${XHS_SEARCH_TIMEOUT_SECONDS:-35}"

echo "[dev-local] XHS_SQLITE_PATH=$XHS_SQLITE_PATH"
echo "[dev-local] XHS_PLAYWRIGHT_HEADLESS=$XHS_PLAYWRIGHT_HEADLESS"
echo "[dev-local] XHS_SEARCH_TIMEOUT_SECONDS=$XHS_SEARCH_TIMEOUT_SECONDS"

if [ ! -f "$ROOT_DIR/next-project/.env.local" ]; then
  cat > "$ROOT_DIR/next-project/.env.local" <<EOF
NEXT_PUBLIC_MCP_SERVER_URL=http://127.0.0.1:8000
EOF
  echo "[dev-local] created next-project/.env.local"
fi

cd "$ROOT_DIR"
npx concurrently -n next,mcp -c cyan,magenta \
  "npm run dev --prefix next-project" \
  "uv run --directory mcp_server python -m uvicorn main:http_app --host 127.0.0.1 --port 8000"
