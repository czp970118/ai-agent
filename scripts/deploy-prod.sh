#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@39.108.121.39}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ai-agent}"
DO_BUILD="${DO_BUILD:-0}"

echo "[deploy-prod] remote=$REMOTE_HOST"
echo "[deploy-prod] dir=$REMOTE_DIR"
echo "[deploy-prod] build=$DO_BUILD"

SSH_CMD="cd $REMOTE_DIR && git fetch origin && git reset --hard origin/master"

if [ "$DO_BUILD" = "1" ]; then
  SSH_CMD="$SSH_CMD && docker compose build mcp next && docker compose up -d --force-recreate mcp next"
else
  SSH_CMD="$SSH_CMD && docker compose up -d --no-build mcp next"
fi

SSH_CMD="$SSH_CMD && docker compose ps && docker logs --tail=60 ai_mcp && docker logs --tail=60 ai_next"

ssh "$REMOTE_HOST" "$SSH_CMD"
