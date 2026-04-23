import argparse
import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode


DEFAULT_TIMEOUT_SECONDS = 20.0
DEFAULT_PAGE_SIZE = 20
DEFAULT_QCC_STORAGE_STATE = "server/qcc/qcc_storage_state.json"


def _load_env_file() -> None:
    """从项目根目录 .env 加载环境变量（不覆盖已有环境变量）。"""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        k = key.strip()
        if not k or k in os.environ:
            continue
        v = value.strip().strip('"').strip("'")
        os.environ[k] = v


def _normalize_page_size(page_size: int) -> int:
    return max(1, min(int(page_size), 50))


def _build_payload(keyword: str, page_size: int, page_index: int) -> dict[str, Any]:
    size = _normalize_page_size(page_size)
    page = max(int(page_index), 1)
    search_key_obj = {"onlyname": keyword, "address": keyword}
    filter_text = (os.environ.get("QCC_FILTER") or "").strip()
    if not filter_text:
        filter_text = json.dumps({"d": [], "i": []}, ensure_ascii=False, separators=(",", ":"))
    search_index = (os.environ.get("QCC_SEARCH_INDEX") or "multicondition").strip()
    return {
        "searchKey": json.dumps(search_key_obj, ensure_ascii=False, separators=(",", ":")),
        "pageIndex": page,
        "pageSize": size,
        "searchIndex": search_index,
        "filter": filter_text,
    }


def _build_search_page_url(keyword: str) -> str:
    encoded = quote(keyword, safe="")
    return f"https://www.qcc.com/web/search?key={encoded}"


def _build_search_other_url(keyword: str, page_size: int, page_index: int) -> str:
    params = {
        "searchKey": keyword,
        "pageIndex": max(int(page_index), 1),
        "pageSize": _normalize_page_size(page_size),
    }
    return f"https://www.qcc.com/api/search/searchOther?{urlencode(params)}"


def _extract_search_res_from_html(html_text: str) -> dict[str, Any] | None:
    """
    从 /web/search 页面 HTML 中提取 window.__INITIAL_STATE__.search.searchRes。
    注意：页面脚本可能会在执行后自删，因此优先从“文档响应”的 HTML 提取。
    """
    if not html_text:
        return None
    m = re.search(
        r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;\s*\(function\(\)",
        html_text,
        flags=re.DOTALL,
    )
    if not m:
        return None
    try:
        state = json.loads(m.group(1))
    except Exception:
        return None
    search_res = (state.get("search", {}) or {}).get("searchRes", {})
    if not isinstance(search_res, dict):
        return None
    if not isinstance(search_res.get("Result"), list):
        return None
    return search_res


def _parse_json_maybe(text: Any) -> Any:
    if text is None:
        return None
    if isinstance(text, (dict, list)):
        return text
    if isinstance(text, str):
        s = text.strip()
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return None
    return None


def _build_contact_summary_items(search_res: dict[str, Any]) -> list[dict[str, Any]]:
    """
    将 search.searchRes.Result 抽成便于查看的简要信息数组：
    企业名、KeyNo、法人、状态、电话/邮箱等。
    """
    if not isinstance(search_res, dict):
        return []
    results = search_res.get("Result")
    if not isinstance(results, list):
        return []

    summary: list[dict[str, Any]] = []
    for r in results:
        if not isinstance(r, dict):
            continue

        contact_number = str(r.get("ContactNumber") or "").strip()

        tel_numbers: list[str] = []
        tel_list = _parse_json_maybe(r.get("TelList"))
        if isinstance(tel_list, list):
            for item in tel_list:
                if isinstance(item, dict):
                    t = str(item.get("t") or "").strip()
                    if t:
                        tel_numbers.append(t)
        tel_numbers = list(dict.fromkeys(tel_numbers))

        emails: list[str] = []
        main_email = str(r.get("Email") or "").strip()
        if main_email:
            emails.append(main_email)
        email_list = _parse_json_maybe(r.get("EmailList"))
        if isinstance(email_list, list):
            for item in email_list:
                if isinstance(item, dict):
                    e = str(item.get("e") or "").strip()
                    if e:
                        emails.append(e)
        emails = list(dict.fromkeys([e for e in emails if e]))

        summary.append(
            {
                "name": r.get("Name") or r.get("name") or "",
                "key_no": r.get("KeyNo") or "",
                "credit_code": r.get("CreditCode") or "",
                "legal_person": r.get("OperName") or "",
                "status": r.get("ShortStatus") or r.get("Status") or "",
                "regist_capi": r.get("RegistCapi") or "",
                "address": r.get("Address") or "",
                "contact_number": contact_number,
                "tel_numbers": tel_numbers,
                "emails": emails,
            }
        )
    return summary


async def _trigger_native_search(page: Any, keyword: str) -> None:
    """尽量触发页面原生搜索请求，便于捕获动态签名参数。"""
    selectors = [
        'input[type="search"]',
        'input[placeholder*="企业"]',
        'input[placeholder*="公司"]',
        'input[placeholder*="搜索"]',
        "input.search-input",
        "input",
    ]
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.count() <= 0:
                continue
            await locator.click(timeout=1500)
            await locator.fill(keyword, timeout=1500)
            await locator.press("Enter", timeout=1500)
            return
        except Exception:
            continue

    button_selectors = [
        'button:has-text("搜索")',
        'button[type="submit"]',
        ".search-btn",
        ".btn-search",
    ]
    for selector in button_selectors:
        try:
            btn = page.locator(selector).first
            if await btn.count() <= 0:
                continue
            await btn.click(timeout=1500)
            return
        except Exception:
            continue


async def _search_companies_via_playwright(
    keyword: str,
    page_size: int,
    page_index: int,
    timeout_seconds: float,
    manual_wait: bool = False,
) -> dict[str, Any]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {
            "ok": False,
            "error": "未安装 Playwright，请先执行：uv sync && uv run playwright install chromium",
        }

    search_url = ((os.environ.get("QCC_SEARCH_URL") or "").strip() or "https://www.qcc.com/api/search/searchMulti")
    qcc_x_pid = (os.environ.get("QCC_X_PID") or "").strip()
    qcc_dynamic_header_name = (os.environ.get("QCC_DYNAMIC_HEADER_NAME") or "").strip()
    qcc_dynamic_header_value = (os.environ.get("QCC_DYNAMIC_HEADER_VALUE") or "").strip()

    payload = _build_payload(keyword, page_size, page_index)
    page_url = _build_search_page_url(keyword)
    timeout_ms = int(max(float(timeout_seconds), 10.0) * 1000)

    captured_x_pid = ""
    captured_dynamic_header_name = ""
    captured_dynamic_header_value = ""
    observed_search_api_urls: list[str] = []

    fetch_headers: dict[str, str] = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
    }
    if qcc_x_pid:
        fetch_headers["x-pid"] = qcc_x_pid
    if qcc_dynamic_header_name and qcc_dynamic_header_value:
        fetch_headers[qcc_dynamic_header_name] = qcc_dynamic_header_value

    env_headless = (os.environ.get("QCC_PLAYWRIGHT_HEADLESS") or "1").strip().lower() in ("1", "true", "yes")
    headless = False if manual_wait else env_headless
    storage_state = (os.environ.get("QCC_STORAGE_STATE") or DEFAULT_QCC_STORAGE_STATE).strip()

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless, args=["--disable-blink-features=AutomationControlled"])
        try:
            context_kwargs: dict[str, Any] = {
                "locale": "zh-CN",
                "viewport": {"width": 1366, "height": 900},
                "user_agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
                ),
            }
            if storage_state and Path(storage_state).is_file():
                context_kwargs["storage_state"] = storage_state
            context = await browser.new_context(**context_kwargs)
            page = await context.new_page()

            common_header_names = {
                "accept",
                "accept-encoding",
                "accept-language",
                "cache-control",
                "content-length",
                "content-type",
                "cookie",
                "origin",
                "pragma",
                "priority",
                "referer",
                "user-agent",
                "x-pid",
                "x-requested-with",
            }

            def _looks_like_dynamic_header(name: str) -> bool:
                s = (name or "").strip().lower()
                if len(s) < 12:
                    return False
                if s in common_header_names:
                    return False
                if s.startswith("sec-") or s.startswith(":"):
                    return False
                return all(ch.isdigit() or ("a" <= ch <= "f") for ch in s)

            def _on_request(req) -> None:
                nonlocal captured_x_pid, captured_dynamic_header_name, captured_dynamic_header_value
                if "/api/search/" not in req.url:
                    return
                if req.url not in observed_search_api_urls:
                    observed_search_api_urls.append(req.url)
                    if len(observed_search_api_urls) > 10:
                        del observed_search_api_urls[:-10]
                headers = req.headers
                captured_x_pid = (headers.get("x-pid") or captured_x_pid or "").strip()
                if not captured_dynamic_header_name:
                    for key, value in headers.items():
                        if _looks_like_dynamic_header(key):
                            captured_dynamic_header_name = str(key).strip()
                            captured_dynamic_header_value = str(value or "").strip()
                            break

            page.on("request", _on_request)

            def _is_search_api_response(resp: Any) -> bool:
                req = resp.request
                if "/api/search/" not in resp.url:
                    return False
                return req.method.upper() in ("POST", "GET")

            page_response_text = ""
            page_response_status = 0
            page_response_ct = ""
            page_triggered = False
            initial_document_html = ""

            try:
                async with page.expect_response(_is_search_api_response, timeout=min(timeout_ms, 12_000)) as resp_info:
                    doc_resp = await page.goto(page_url, wait_until="domcontentloaded", timeout=timeout_ms)
                    try:
                        if doc_resp is not None:
                            initial_document_html = await doc_resp.text()
                    except Exception:
                        initial_document_html = ""
                    await page.wait_for_timeout(800)
                    await _trigger_native_search(page, keyword)
                matched_resp = await resp_info.value
                page_triggered = True
                page_response_status = matched_resp.status
                page_response_ct = matched_resp.headers.get("content-type", "")
                page_response_text = await matched_resp.text()
            except Exception:
                doc_resp = await page.goto(page_url, wait_until="domcontentloaded", timeout=timeout_ms)
                try:
                    if doc_resp is not None:
                        initial_document_html = await doc_resp.text()
                except Exception:
                    initial_document_html = ""
                await page.wait_for_timeout(2600)

            if manual_wait and not page_triggered:
                try:
                    print("已进入手动接管模式：请在浏览器中完成验证，并主动点击一次搜索。")
                    async with page.expect_response(_is_search_api_response, timeout=120_000) as resp_info2:
                        await asyncio.to_thread(
                            input, "请在浏览器中手动完成验证并点击一次搜索，完成后回车继续... "
                        )
                    matched_resp = await resp_info2.value
                    print("已检测到页面搜索请求，正在解析接口响应...")
                    page_triggered = True
                    page_response_status = matched_resp.status
                    page_response_ct = matched_resp.headers.get("content-type", "")
                    page_response_text = await matched_resp.text()
                except Exception:
                    print("未在等待时间内捕获到页面搜索请求，转为脚本内 fetch 兜底。")
                    if observed_search_api_urls:
                        print("最近捕获到的搜索类接口：")
                        for url in observed_search_api_urls[-5:]:
                            print(f"  - {url}")

            if captured_x_pid:
                fetch_headers["x-pid"] = captured_x_pid
            elif qcc_x_pid:
                fetch_headers["x-pid"] = qcc_x_pid

            if captured_dynamic_header_name and captured_dynamic_header_value:
                fetch_headers[captured_dynamic_header_name] = captured_dynamic_header_value
            elif qcc_dynamic_header_name and qcc_dynamic_header_value:
                fetch_headers[qcc_dynamic_header_name] = qcc_dynamic_header_value

            status_code = page_response_status
            content_type = page_response_ct
            text = page_response_text

            if not page_triggered or not text:
                result: dict[str, Any] = {}
                search_other_url = _build_search_other_url(keyword, page_size, page_index)
                observed_search_other_url = next(
                    (u for u in reversed(observed_search_api_urls) if "/api/search/searchOther" in u),
                    "",
                )
                request_plans: list[dict[str, Any]] = []
                if observed_search_other_url:
                    request_plans.append({"url": observed_search_other_url, "method": "GET", "payload": None})
                request_plans.append({"url": search_other_url, "method": "GET", "payload": None})
                request_plans.append({"url": search_url, "method": "POST", "payload": payload})

                for plan in request_plans:
                    result = await page.evaluate(
                        """async ({ url, method, payload, headers }) => {
                            const init = { method, headers, credentials: "include" };
                            if (method === "POST") init.body = JSON.stringify(payload || {});
                            const resp = await fetch(url, init);
                            const text = await resp.text();
                            return {
                              status: resp.status,
                              ok: resp.ok,
                              contentType: resp.headers.get("content-type") || "",
                              text,
                              finalUrl: resp.url || url,
                              method,
                            };
                        }""",
                        {
                            "url": str(plan.get("url") or ""),
                            "method": str(plan.get("method") or "GET"),
                            "payload": plan.get("payload"),
                            "headers": fetch_headers,
                        },
                    )
                    text = str(result.get("text") or "")
                    if "aliyun_waf_aa" in text or "renderData" in text:
                        await page.wait_for_timeout(1800)
                        continue
                    break
                status_code = int(result.get("status") or 0)
                content_type = str(result.get("contentType") or "")
                text = str(result.get("text") or "")

            if status_code >= 400:
                return {
                    "ok": False,
                    "error": f"请求失败: HTTP {status_code}",
                    "status_code": status_code,
                    "response_content_type": content_type,
                    "response_preview": text[:500],
                }

            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                extracted = _extract_search_res_from_html(text) or _extract_search_res_from_html(initial_document_html)
                if extracted:
                    return {
                        "ok": True,
                        "source": "web_search_initial_state",
                        "params": {
                            "keyword": keyword,
                            "page_size": _normalize_page_size(page_size),
                            "page_index": max(int(page_index), 1),
                            "search_url": search_url,
                            "captured_x_pid": bool(captured_x_pid),
                            "captured_dynamic_header_name": captured_dynamic_header_name,
                            "used_page_native_request": page_triggered,
                        },
                        "data": extracted,
                        "summary_items": _build_contact_summary_items(extracted),
                    }
                return {
                    "ok": False,
                    "error": "响应不是 JSON，可能仍被风控或登录态失效",
                    "status_code": status_code,
                    "response_content_type": content_type,
                    "response_preview": text[:500],
                }

            if isinstance(data, dict):
                biz_status = data.get("status")
                if biz_status not in (0, 200, "0", "200", None):
                    return {
                        "ok": False,
                        "error": "接口返回业务错误，可能是签名/风控/参数不匹配",
                        "biz_status": biz_status,
                        "biz_message": data.get("message"),
                        "biz_errcode": data.get("errcode"),
                        "params": {
                            "keyword": keyword,
                            "page_size": _normalize_page_size(page_size),
                            "page_index": max(int(page_index), 1),
                            "search_url": search_url,
                            "payload": payload,
                            "has_x_pid": bool(fetch_headers.get("x-pid")),
                            "has_dynamic_header": bool(
                                captured_dynamic_header_name and captured_dynamic_header_value
                            )
                            or bool(qcc_dynamic_header_name and qcc_dynamic_header_value),
                            "captured_x_pid": bool(captured_x_pid),
                            "captured_dynamic_header_name": captured_dynamic_header_name,
                            "used_page_native_request": page_triggered,
                        },
                        "raw_data": data,
                    }

            looks_like_company_result = isinstance(data, dict) and isinstance(data.get("Result"), list)
            if not looks_like_company_result:
                extracted = _extract_search_res_from_html(initial_document_html)
                if extracted:
                    return {
                        "ok": True,
                        "source": "web_search_initial_state",
                        "params": {
                            "keyword": keyword,
                            "page_size": _normalize_page_size(page_size),
                            "page_index": max(int(page_index), 1),
                            "search_url": search_url,
                            "captured_x_pid": bool(captured_x_pid),
                            "captured_dynamic_header_name": captured_dynamic_header_name,
                            "used_page_native_request": page_triggered,
                        },
                        "data": extracted,
                        "summary_items": _build_contact_summary_items(extracted),
                    }

            return {
                "ok": True,
                "params": {
                    "keyword": keyword,
                    "page_size": _normalize_page_size(page_size),
                    "page_index": max(int(page_index), 1),
                    "search_url": search_url,
                    "payload": payload,
                    "captured_x_pid": bool(captured_x_pid),
                    "captured_dynamic_header_name": captured_dynamic_header_name,
                    "used_page_native_request": page_triggered,
                },
                "data": data,
            }
        finally:
            await browser.close()


def save_login_state(storage_state_path: str | None = None) -> None:
    """打开可见浏览器，手动登录企查查后保存登录态。"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("未安装 Playwright，请先执行：uv sync && uv run playwright install chromium")
        raise SystemExit(2)

    out_path = (storage_state_path or os.environ.get("QCC_STORAGE_STATE") or DEFAULT_QCC_STORAGE_STATE).strip()
    out = Path(out_path)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        try:
            context = browser.new_context(
                viewport={"width": 1366, "height": 900},
                locale="zh-CN",
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
                ),
            )
            page = context.new_page()
            page.goto("https://www.qcc.com", wait_until="domcontentloaded", timeout=120_000)
            input("请在浏览器完成登录后，回到终端按回车保存登录态... ")
            context.storage_state(path=str(out))
            print(f"已保存登录态: {out.resolve()}")
        finally:
            browser.close()


def search_companies(
    keyword: str,
    page_size: int = DEFAULT_PAGE_SIZE,
    page_index: int = 1,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    manual_wait: bool = False,
) -> dict[str, Any]:
    """企业搜索（Playwright 浏览器上下文请求）。"""
    kw = (keyword or "").strip()
    if not kw:
        return {"ok": False, "error": "keyword 不能为空"}
    return asyncio.run(
        _search_companies_via_playwright(
            keyword=kw,
            page_size=page_size,
            page_index=page_index,
            timeout_seconds=timeout_seconds,
            manual_wait=manual_wait,
        )
    )


def _default_output_path(keyword: str) -> Path:
    out_dir = Path("json")
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in keyword.strip())
    safe = safe or "company"
    return out_dir / f"qcc_search_{safe}_{ts}.json"


def _cli() -> None:
    _load_env_file()
    parser = argparse.ArgumentParser(description="QCC 企业搜索")
    parser.add_argument("keyword", nargs="?", default=None, help="企业名称关键词")
    parser.add_argument("--page-size", dest="page_size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--page-index", dest="page_index", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--save", action="store_true", help="将结果保存到 json 文件夹")
    parser.add_argument("--manual", action="store_true", help="手动接管：先在浏览器里过验证并执行搜索")
    parser.add_argument("--save-login", action="store_true", help="打开浏览器手动登录并保存 QCC 登录态")
    parser.add_argument(
        "--storage-state",
        default=(os.environ.get("QCC_STORAGE_STATE") or DEFAULT_QCC_STORAGE_STATE),
        help=f"登录态文件路径（默认: {DEFAULT_QCC_STORAGE_STATE}）",
    )
    args = parser.parse_args()

    if args.save_login:
        save_login_state(storage_state_path=args.storage_state)
        return

    keyword = (args.keyword or "").strip()
    if not keyword:
        try:
            keyword = input("请输入企业关键词: ").strip()
        except EOFError:
            keyword = ""
    if not keyword:
        print(json.dumps({"ok": False, "error": "keyword 不能为空"}, ensure_ascii=False))
        raise SystemExit(2)

    result = search_companies(
        keyword=keyword,
        page_size=args.page_size,
        page_index=args.page_index,
        timeout_seconds=args.timeout,
        manual_wait=args.manual,
    )

    if args.save:
        output_path = _default_output_path(keyword)
        with output_path.open("w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        result = {**result, "output_path": str(output_path)}

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _cli()

