"""用真实 Chromium 打开小红书搜索页，拦截 search/filter 响应，从而无需手写 x-s / x-s-common。

首次使用建议在图形界面登录并保存会话，见：uv run python xhs_playwright.py --save-login

避免 playwright install 下载卡住：macOS 若已安装 Google Chrome，默认用系统浏览器（channel=chrome），
无需下载 ~160MB 的 Chromium 包。可设 XHS_USE_SYSTEM_CHROME=0 强制使用自带 Chromium。
"""

from __future__ import annotations

import logging
import os
import platform
from urllib.parse import quote

logger = logging.getLogger(__name__)


def _chromium_channel() -> str | None:
    """返回 Playwright 的 channel（chrome/msedge），无则使用项目内已下载的 Chromium。"""
    explicit = (os.environ.get("XHS_CHROMIUM_CHANNEL") or "").strip()
    if explicit:
        return explicit
    if os.environ.get("XHS_USE_SYSTEM_CHROME", "").strip().lower() in (
        "0",
        "false",
        "no",
    ):
        return None
    if platform.system() != "Darwin":
        return None
    chrome_bin = (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    )
    if os.path.isfile(chrome_bin):
        return "chrome"
    return None


def _extra_launch_args(base_args: list[str]) -> list[str]:
    args = list(base_args)
    if platform.system() == "Linux":
        # 云服务器/容器常见必需参数，避免 sandbox 与 /dev/shm 导致浏览器无法稳定启动。
        args.extend(
            [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ]
        )
    return args


def _launch_browser(p, *, args: list[str]):
    """优先使用系统 Google Chrome（macOS），避免依赖 playwright install 下载的 Chromium。"""
    kw: dict = {"headless": False, "args": args}
    ch = _chromium_channel()
    if ch:
        kw["channel"] = ch
    return p.chromium.launch(**kw)


async def _launch_browser_async(p, *, args: list[str]):
    """异步启动浏览器：先尝试 channel，失败后回退内置 Chromium。"""
    kw: dict = {"headless": False, "args": args}
    ch = _chromium_channel()
    if ch:
        try:
            return await p.chromium.launch(**(kw | {"channel": ch}))
        except Exception:
            # 系统 Chrome 启动失败时，回退到 Playwright 自带 Chromium。
            pass
    return await p.chromium.launch(**kw)


async def fetch_search_notes_via_browser(keyword: str, timeout_seconds: float = 60.0) -> str:
    """打开搜索页并等待 edith search/notes 响应，返回响应正文。"""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return (
            "未安装 Playwright。请执行：uv sync && uv run playwright install chromium"
        )

    q = quote(keyword, safe="")
    search_url = f"https://www.xiaohongshu.com/search_result?keyword={q}"
    storage = os.environ.get("XHS_STORAGE_STATE", "server/xhs/xhs_storage_state.json")
    headless = os.environ.get("XHS_PLAYWRIGHT_HEADLESS", "1").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    timeout_ms = int(max(float(timeout_seconds), 45.0) * 1000)

    ua = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    )

    # Playwright 在 headless=True 时会改用独立的 chromium_headless_shell 包，需单独 playwright install。
    # 多数环境只装了完整 Chromium；无头模式改为 headless=False + --headless=new，仍走 chromium-* 目录。
    _args = ["--disable-blink-features=AutomationControlled"]
    if headless:
        _args = ["--headless=new", *_args]
    _args = _extra_launch_args(_args)
    logger.info(
        "xhs_playwright_start keyword=%s timeout_seconds=%s headless=%s channel=%s storage=%s storage_exists=%s args=%s",
        keyword,
        timeout_seconds,
        headless,
        _chromium_channel() or "builtin",
        storage,
        os.path.isfile(storage),
        _args,
    )

    browser = None
    seen_search_urls: list[str] = []
    async with async_playwright() as p:
        try:
            browser = await _launch_browser_async(p, args=_args)
            ctx_kw: dict = {
                "user_agent": ua,
                "locale": "zh-CN",
                "viewport": {"width": 1280, "height": 800},
            }
            if os.path.isfile(storage):
                ctx_kw["storage_state"] = storage
            context = await browser.new_context(**ctx_kw)
            page = await context.new_page()
            await page.set_extra_http_headers({"Accept-Language": "zh-CN,zh;q=0.9"})

            search_api_markers = (
                "/api/sns/web/v1/search/notes",
                "/api/sns/web/v1/search/general",
                "/api/sns/web/v1/search/filter",
            )

            def _track_search_response(resp) -> None:
                try:
                    if any(marker in resp.url for marker in search_api_markers):
                        seen_search_urls.append(resp.url)
                        if len(seen_search_urls) > 8:
                            del seen_search_urls[:-8]
                except Exception:
                    return

            page.on("response", _track_search_response)

            keyword_lower = keyword.strip().lower()

            def _is_target_search_response(resp) -> bool:
                if resp.request.method != "POST":
                    return False
                if not any(marker in resp.url for marker in search_api_markers):
                    return False
                if not keyword_lower:
                    return True
                try:
                    post_data = str(resp.request.post_data or "").lower()
                except Exception:
                    post_data = ""
                return keyword_lower in post_data

            async with page.expect_response(
                _is_target_search_response,
                timeout=timeout_ms,
            ) as resp_info:
                await page.goto(search_url, wait_until="domcontentloaded", timeout=timeout_ms)
                await page.wait_for_timeout(1500)

            response = await resp_info.value
            text = await response.text()
            logger.info(
                "xhs_playwright_response status=%s url=%s body_len=%s",
                response.status,
                response.url,
                len(text),
            )
            if response.status >= 400:
                logger.warning(
                    "xhs_playwright_http_error status=%s reason=%s body_preview=%s",
                    response.status,
                    response.reason,
                    text[:500],
                )
                return (
                    f"请求失败: HTTP {response.status} {response.reason}\n"
                    f"响应体: {text[:4000]}"
                )
            return text
        except Exception as e:
            name = type(e).__name__
            logger.exception(
                "xhs_playwright_exception type=%s keyword=%s timeout_seconds=%s error=%s",
                name,
                keyword,
                timeout_seconds,
                e,
            )
            if "Timeout" in name or "timeout" in str(e).lower():
                recent_urls = ", ".join(seen_search_urls[-5:])
                extra_line = f"- 最近命中的搜索接口: {recent_urls}\n" if recent_urls else ""
                return (
                    f"浏览器抓取超时（{timeout_seconds}s）：未等到 search/notes 请求。\n"
                    "- 若需登录：执行 `uv run python xhs_playwright.py --save-login` 保存会话后重试。\n"
                    "- 调试可设环境变量 XHS_PLAYWRIGHT_HEADLESS=0 观察页面。\n"
                    f"{extra_line}"
                    f"详情: {e}"
                )
            err = str(e)
            if "Executable doesn't exist" in err:
                return (
                    f"Playwright 执行失败: {e}\n\n"
                    "本机未检测到可启动的浏览器。任选其一：\n"
                    "1) 安装 Google Chrome（macOS 放至「应用程序」）后重试，本脚本会自动用系统 Chrome；\n"
                    "2) 或耐心等待执行：PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=600000 "
                    "uv run playwright install chromium\n"
                    "3) 已装 Chrome 仍失败可显式指定：export XHS_CHROMIUM_CHANNEL=chrome"
                )
            return f"Playwright 执行失败: {e}"
        finally:
            if browser is not None:
                await browser.close()


def save_login_state() -> None:
    """打开可见浏览器，手动登录后按回车，将 Cookie 写入 XHS_STORAGE_STATE。"""
    from playwright.sync_api import sync_playwright

    path = os.environ.get("XHS_STORAGE_STATE", "server/xhs/xhs_storage_state.json")
    with sync_playwright() as p:
        browser = _launch_browser(
            p,
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                locale="zh-CN",
            )
            page = context.new_page()
            page.goto("https://www.xiaohongshu.com", wait_until="load", timeout=120_000)
            input("在小红书完成登录后，回到此终端按回车保存会话… ")
            context.storage_state(path=path)
        finally:
            browser.close()
    print(f"已写入登录态: {os.path.abspath(path)}")


def _cli() -> None:
    import argparse

    p = argparse.ArgumentParser(description="小红书 filter：浏览器拦截 / 保存登录态")
    p.add_argument("--save-login", action="store_true", help="打开浏览器登录并保存 storage_state")
    args = p.parse_args()
    if args.save_login:
        save_login_state()
    else:
        p.print_help()


if __name__ == "__main__":
    _cli()
