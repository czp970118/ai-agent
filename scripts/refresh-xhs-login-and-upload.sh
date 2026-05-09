#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@39.108.121.39}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ai-agent}"
# 远端 docker compose 使用的文件列表（Linux/macOS 用冒号）。仅 compose.yml 时设为 compose.yml
REMOTE_COMPOSE_FILE="${REMOTE_COMPOSE_FILE:-compose.yml:compose.cn.yml}"
LOCAL_STATE_PATH="${LOCAL_STATE_PATH:-server/xhs/xhs_storage_state.json}"
RESTART_MCP="${RESTART_MCP:-1}"

echo "[xhs-refresh] remote=$REMOTE_HOST"
echo "[xhs-refresh] remote_dir=$REMOTE_DIR"
echo "[xhs-refresh] remote_compose_file=$REMOTE_COMPOSE_FILE"
echo "[xhs-refresh] local_state_path=$LOCAL_STATE_PATH"
echo "[xhs-refresh] restart_mcp=$RESTART_MCP"

XHS_STORAGE_STATE="$LOCAL_STATE_PATH" uv run --directory mcp_server python -m server.xhs.xhs_playwright --save-login

scp "mcp_server/$LOCAL_STATE_PATH" "$REMOTE_HOST:$REMOTE_DIR/mcp_server/server/xhs/xhs_storage_state.json"

if [ "$RESTART_MCP" = "1" ]; then
  ssh "$REMOTE_HOST" "cd \"$REMOTE_DIR\" && COMPOSE_FILE=\"$REMOTE_COMPOSE_FILE\" docker compose restart mcp && docker logs --tail=80 ai_mcp"
fi

echo "[xhs-refresh] done"
