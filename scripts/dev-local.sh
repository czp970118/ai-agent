#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export XHS_SQLITE_PATH="${XHS_SQLITE_PATH:-$ROOT_DIR/mcp_server/data/xhs_cache.local.db}"
export XHS_PLAYWRIGHT_HEADLESS="${XHS_PLAYWRIGHT_HEADLESS:-0}"
export XHS_SEARCH_TIMEOUT_SECONDS="${XHS_SEARCH_TIMEOUT_SECONDS:-35}"

echo "[dev-local] XHS_SQLITE_PATH=$XHS_SQLITE_PATH"
echo "[dev-local] XHS_PLAYWRIGHT_HEADLESS=$XHS_PLAYWRIGHT_HEADLESS"
echo "[dev-local] XHS_SEARCH_TIMEOUT_SECONDS=$XHS_SEARCH_TIMEOUT_SECONDS"

ENV_COMPOSE="$ROOT_DIR/next-project/env.compose"
if [ ! -f "$ENV_COMPOSE" ]; then
  if [ -f "$ROOT_DIR/next-project/.env.local" ]; then
    mv "$ROOT_DIR/next-project/.env.local" "$ENV_COMPOSE"
    echo "[dev-local] migrated .env.local -> next-project/env.compose"
  else
    cat > "$ENV_COMPOSE" <<'EOF'
NEXT_PUBLIC_MCP_SERVER_URL=http://localhost:8000
INTERNAL_MCP_URL=http://localhost:8000
ACCESS_GATE_ENABLED=0
ACCESS_GATE_JWT_SECRET=
EOF
    echo "[dev-local] created next-project/env.compose"
  fi
fi

cd "$ROOT_DIR"
npx concurrently -n next,mcp -c cyan,magenta \
  "npm run dev --prefix next-project" \
  "uv run --directory mcp_server python -m uvicorn main:http_app --host 127.0.0.1 --port 8000"
