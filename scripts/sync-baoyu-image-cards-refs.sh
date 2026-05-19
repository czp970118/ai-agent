#!/usr/bin/env bash
# 从 jimliu/baoyu-skills 同步 baoyu-image-cards 参考文件到 vendor 目录
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/mcp_server/vendor/baoyu-image-cards/references"
BASE="https://raw.githubusercontent.com/jimliu/baoyu-skills/main/skills/baoyu-image-cards/references"
mkdir -p "$DEST/presets" "$DEST/palettes" "$DEST/elements" "$DEST/workflows"

fetch() {
  local rel="$1"
  local out="$DEST/$rel"
  mkdir -p "$(dirname "$out")"
  curl -fsSL "$BASE/$rel" -o "$out"
  echo "ok $rel"
}

for style in cute fresh warm bold minimal retro pop notion chalkboard study-notes screen-print sketch-notes; do
  fetch "presets/${style}.md" || true
done
for pal in macaron warm neon; do
  fetch "palettes/${pal}.md" || true
done
fetch "elements/canvas.md" || true
fetch "workflows/prompt-assembly.md" || true
fetch "style-presets.md" || true

echo "Done. Files under $DEST"
