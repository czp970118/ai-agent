#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-root@39.108.121.39}"
REMOTE_DB_PATH="${REMOTE_DB_PATH:-/opt/ai-agent/mcp_server/data/xhs_cache.db}"
LOCAL_DB_PATH="${LOCAL_DB_PATH:-$ROOT_DIR/mcp_server/data/xhs_cache.local.db}"

echo "[pull-db] remote=${REMOTE_HOST}:${REMOTE_DB_PATH}"
echo "[pull-db] local=${LOCAL_DB_PATH}"

mkdir -p "$(dirname "$LOCAL_DB_PATH")"
if [ -f "$LOCAL_DB_PATH" ]; then
  cp -f "$LOCAL_DB_PATH" "${LOCAL_DB_PATH}.bak.$(date +%F-%H%M%S)"
  echo "[pull-db] backup created"
fi

echo "[pull-db] remote info:"
ssh "$REMOTE_HOST" "ls -lh \"$REMOTE_DB_PATH\" && sha256sum \"$REMOTE_DB_PATH\""

echo "[pull-db] downloading..."
scp "${REMOTE_HOST}:${REMOTE_DB_PATH}" "$LOCAL_DB_PATH"

echo "[pull-db] local info:"
ls -lh "$LOCAL_DB_PATH"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$LOCAL_DB_PATH"
else
  sha256sum "$LOCAL_DB_PATH"
fi

echo "[pull-db] sqlite quick check:"
python - "$LOCAL_DB_PATH" <<'PY'
import sqlite3
import sys

db = sys.argv[1]
conn = sqlite3.connect(db)
cur = conn.cursor()
tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
print("tables=", [t[0] for t in tables])
if any(t[0] == "xhs_note_cache" for t in tables):
    count = cur.execute("SELECT COUNT(1) FROM xhs_note_cache").fetchone()[0]
    print("xhs_note_cache_count=", count)
conn.close()
PY

echo "[pull-db] done"
