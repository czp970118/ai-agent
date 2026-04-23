#!/usr/bin/env bash
# 安装 Playwright 自带 Chromium。
#
# 国内常见问题：
# 1) npmmirror 上浏览器 zip 版本滞后 → 默认走官方 CDN（勿强行设 PLAYWRIGHT_DOWNLOAD_HOST，除非镜像已同步）。
# 2) 下载 160MB+ 时 30s 无流量会断 → 必须加大 PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT（毫秒）。
#
# 用法：在项目根目录执行
#   bash scripts/install_playwright_cn.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# 单次连接/传输空闲超时（默认 30000ms 易在大文件慢速下载时失败）
export PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT="${PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:-600000}"

# 若需镜像，自行导出后再运行，例如（需确认镜像已有对应版本，否则 404）：
#   export PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright

# 未设置时不要用失效的默认镜像
if [[ "${PLAYWRIGHT_DOWNLOAD_HOST:-}" == "https://npmmirror.com/mirrors/playwright" ]] && [[ -z "${PLAYWRIGHT_USE_MIRROR:-}" ]]; then
  unset PLAYWRIGHT_DOWNLOAD_HOST
fi

echo "PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=${PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT} ms"
uv run playwright install chromium
