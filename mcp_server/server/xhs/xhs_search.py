import asyncio
import json
import os
import re
import logging
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

SEARCH_NOTES_URL = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes"
logger = logging.getLogger(__name__)

def _keyword_output_path(keyword: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]+', "_", (keyword or "").strip())
    safe = re.sub(r"\s+", "_", safe).strip("._") or "keyword"
    out_dir = Path("json")
    out_dir.mkdir(parents=True, exist_ok=True)
    return str(out_dir / f"xhs_search_{safe}.json")


def _to_json_or_error(text: str) -> str:
    try:
        json.loads(text)
        return text
    except Exception:
        return json.dumps({"ok": False, "error": text}, ensure_ascii=False)


def parse_note_id_and_xsec_token(note_url: str) -> tuple[str, str]:
    parsed = urlparse(note_url.strip())
    note_id = (parsed.path.split("/")[-1] or "").strip()
    xsec_token = (parse_qs(parsed.query).get("xsec_token") or [""])[0]
    return note_id, xsec_token


async def fetch_xhs_note_detail_by_html(
    note_id: str,
    xsec_token: str | None = None,
    timeout_seconds: float = 30.0,
) -> str:
    nid = (note_id or "").strip()
    if not nid:
        return "参数错误: note_id 不能为空"
    note_url = f"https://www.xiaohongshu.com/explore/{nid}"
    if xsec_token:
        note_url = f"{note_url}?xsec_token={xsec_token}"
    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "referer": "https://www.xiaohongshu.com/",
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        ),
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True, headers=headers) as client:
            response = await client.get(note_url)
            response.raise_for_status()
            html = response.text
    except Exception as e:
        return f"抓取失败: {e}"

    def pick(patterns: list[str]) -> str:
        for pattern in patterns:
            m = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
            if m:
                value = (m.group(1) or "").strip()
                if value:
                    return value
        return ""

    def to_int(text: str) -> int:
        raw = str(text or "").strip()
        if not raw:
            return 0
        raw = raw.replace(",", "")
        m = re.search(r"\d+", raw)
        return int(m.group(0)) if m else 0

    title = pick(
        [
            r'<meta[^>]*property=["\']og:title["\'][^>]*content=["\'](.*?)["\']',
            r'<meta[^>]*name=["\']title["\'][^>]*content=["\'](.*?)["\']',
            r"<title>(.*?)</title>",
        ]
    )
    description = pick(
        [
            r'<meta[^>]*property=["\']og:description["\'][^>]*content=["\'](.*?)["\']',
            r'<meta[^>]*name=["\']description["\'][^>]*content=["\'](.*?)["\']',
        ]
    )
    author = pick(
        [
            r'<meta[^>]*name=["\']author["\'][^>]*content=["\'](.*?)["\']',
            r'"nickname"\s*:\s*"([^"]+)"',
        ]
    )
    cover = pick(
        [
            r'<meta[^>]*property=["\']og:image["\'][^>]*content=["\'](.*?)["\']',
            r'"image"\s*:\s*"([^"]+)"',
        ]
    )
    content_text = pick(
        [
            r'"desc"\s*:\s*"((?:\\.|[^"\\])*)"',
            r'"content"\s*:\s*"((?:\\.|[^"\\])*)"',
            r'"noteDesc"\s*:\s*"((?:\\.|[^"\\])*)"',
        ]
    )
    if content_text:
        try:
            content_text = json.loads(f'"{content_text}"')
        except Exception:
            content_text = content_text.replace("\\n", "\n").replace("\\t", "\t")

    comment_count = to_int(
        pick(
            [
                r'<meta[^>]*property=["\']og:xhs:note_comment["\'][^>]*content=["\'](.*?)["\']',
                r'<meta[^>]*name=["\']og:xhs:note_comment["\'][^>]*content=["\'](.*?)["\']',
            ]
        )
    )
    like_count = to_int(
        pick(
            [
                r'<meta[^>]*property=["\']og:xhs:note_like["\'][^>]*content=["\'](.*?)["\']',
                r'<meta[^>]*name=["\']og:xhs:note_like["\'][^>]*content=["\'](.*?)["\']',
            ]
        )
    )
    collect_count = to_int(
        pick(
            [
                r'<meta[^>]*property=["\']og:xhs:note_collect["\'][^>]*content=["\'](.*?)["\']',
                r'<meta[^>]*name=["\']og:xhs:note_collect["\'][^>]*content=["\'](.*?)["\']',
            ]
        )
    )

    return json.dumps(
        {
            "code": 0,
            "success": True,
            "source": "html",
            "data": {
                "note_id": nid,
                "xsec_token": xsec_token or "",
                "url": note_url,
                "title": title,
                "description": description,
                "content_text": content_text or description,
                "author": author,
                "cover": cover,
                "like_count": like_count,
                "comment_count": comment_count,
                "collect_count": collect_count,
            },
        },
        ensure_ascii=False,
    )


async def fetch_xhs_note_detail(
    note_id: str,
    xsec_token: str | None = None,
    timeout_seconds: float = 30.0,
) -> str:
    return await fetch_xhs_note_detail_by_html(
        note_id=note_id,
        xsec_token=xsec_token,
        timeout_seconds=timeout_seconds,
    )


async def poll_xhs_note_detail(
    note_url: str,
    poll_count: int = 3,
    interval_seconds: float = 2.0,
    timeout_seconds: float = 30.0,
    output_path: str = "json/xhs_note_poll.json",
) -> str:
    note_id, xsec_token = parse_note_id_and_xsec_token(note_url)
    if not note_id or not xsec_token:
        return "参数错误: note_url 缺少 note_id 或 xsec_token"

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    latest: dict = {}
    for i in range(max(int(poll_count), 1)):
        detail_text = await fetch_xhs_note_detail_by_html(
            note_id=note_id,
            xsec_token=xsec_token,
            timeout_seconds=timeout_seconds,
        )
        try:
            detail_obj = json.loads(detail_text)
            detail_data = detail_obj.get("data") if isinstance(detail_obj, dict) else {}
            if isinstance(detail_data, dict):
                latest = detail_data
            else:
                latest = {}
        except Exception:
            latest = {"raw_text": detail_text}
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump({"ok": True, "note": latest}, f, ensure_ascii=False, indent=2)
        if i < poll_count - 1:
            await asyncio.sleep(max(float(interval_seconds), 0.1))
    return json.dumps({"ok": True, "output_path": str(output_file)}, ensure_ascii=False)


async def search_xhs_hot(
    keyword: str,
    timeout_seconds: float = 45.0,
    page_size: int = 20,
    sort: str = "general",
) -> str:
    try:
        from .xhs_playwright import fetch_search_notes_via_browser
    except ImportError:
        from xhs_playwright import fetch_search_notes_via_browser

    text = await fetch_search_notes_via_browser(
        keyword=keyword,
        timeout_seconds=max(float(timeout_seconds), 10.0),
    )
    logger.info(
        "xhs_search_hot_raw keyword=%s sort=%s page_size=%s text_preview=%s",
        keyword,
        sort,
        page_size,
        text[:500],
    )
    text = _to_json_or_error(text)

    # 统一 page_size，避免后续流程处理过多数据。
    try:
        payload = json.loads(text)
        items = (
            payload.get("data", {}).get("items", [])
            if isinstance(payload, dict)
            else []
        )
        if isinstance(items, list):
            payload["data"]["items"] = items[: max(int(page_size), 1)]
        logger.info(
            "xhs_search_hot_resolved keyword=%s item_count=%s",
            keyword,
            len(payload.get("data", {}).get("items", []))
            if isinstance(payload.get("data", {}).get("items", []), list)
            else 0,
        )
        payload.setdefault("request_params", {})
        payload["request_params"]["keyword"] = keyword
        payload["request_params"]["sort"] = sort
        payload["request_params"]["page_size"] = max(int(page_size), 1)
        return json.dumps(payload, ensure_ascii=False)
    except Exception:
        logger.exception("xhs_search_hot_parse_error keyword=%s", keyword)
        return text


async def search_xhs_keyword_and_poll_details(
    topic: str,
    page_size: int = 20,
    sort: str = "general",
    requirements: list[str] | None = None,
    domains: list[str] | None = None,
) -> str:
    try:
        from .xhs_note_pipeline import search_and_poll_notes
    except ImportError:
        from xhs_note_pipeline import search_and_poll_notes

    return await search_and_poll_notes(
        keyword=topic,
        page_size=page_size,
        sort=sort,
        requirements=requirements,
        domains=domains,
    )


def _cli() -> None:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="默认执行：主题词搜索并回填详情")
    parser.add_argument("topic", nargs="?", default=None, help="搜索主题词")
    parser.add_argument("--page-size", dest="page_size", type=int, default=20)
    parser.add_argument("--sort", default="general")
    parser.add_argument(
        "--requirements",
        default=None,
        help="可选需求词，逗号分隔，如：签证办理,游玩路线,住宿推荐",
    )
    parser.add_argument("--search-only", action="store_true", help="仅搜索，不抓详情")
    args = parser.parse_args()

    topic = (args.topic or "").strip()
    if not topic:
        try:
            topic = input("请输入搜索主题词: ").strip()
        except EOFError:
            print("错误：未提供主题词", file=sys.stderr)
            raise SystemExit(2)
    if not topic:
        print("错误：主题词不能为空。", file=sys.stderr)
        raise SystemExit(2)

    requirements_text = args.requirements
    if requirements_text is None:
        try:
            requirements_text = input("请输入需求词（逗号分隔，可直接回车跳过）: ").strip()
        except EOFError:
            requirements_text = ""
    requirements = [s.strip() for s in str(requirements_text or "").split(",") if s.strip()]

    if args.search_only:
        text = asyncio.run(search_xhs_hot(topic, page_size=args.page_size, sort=args.sort))
        output_file = _keyword_output_path(topic)
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(text)
        print(text)
        return

    result = asyncio.run(
        search_xhs_keyword_and_poll_details(
            topic=topic,
            page_size=args.page_size,
            sort=args.sort,
            requirements=requirements,
        )
    )
    print(result)


if __name__ == "__main__":
    _cli()
