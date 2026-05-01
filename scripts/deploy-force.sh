#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@39.108.121.39}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ai-agent}"
DO_BUILD="${DO_BUILD:-0}"
APT_MIRROR="${APT_MIRROR:-mirrors.aliyun.com}"
PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST:-}"

echo "[deploy-force] remote=$REMOTE_HOST"
echo "[deploy-force] dir=$REMOTE_DIR"
echo "[deploy-force] build=$DO_BUILD"
echo "[deploy-force] apt_mirror=$APT_MIRROR"
echo "[deploy-force] playwright_download_host=${PLAYWRIGHT_DOWNLOAD_HOST:-<default>}"

SSH_CMD="cd $REMOTE_DIR && git fetch origin && git reset --hard origin/master && test -f next-project/env.compose || cp next-project/env.compose.example next-project/env.compose && rm -rf next-project/.next"

if [ "$DO_BUILD" = "1" ]; then
  SSH_CMD="$SSH_CMD && docker compose build --build-arg APT_MIRROR=$APT_MIRROR --build-arg PLAYWRIGHT_DOWNLOAD_HOST=$PLAYWRIGHT_DOWNLOAD_HOST mcp next && docker compose up -d --force-recreate mcp next"
else
  SSH_CMD="$SSH_CMD && docker compose up -d --force-recreate mcp next"
fi

SSH_CMD="$SSH_CMD && docker compose ps && docker logs --tail=100 ai_mcp && docker logs --tail=120 ai_next"

ssh "$REMOTE_HOST" "$SSH_CMD"
