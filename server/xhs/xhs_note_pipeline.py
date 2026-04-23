import asyncio
import json
import random
import re
from pathlib import Path
from typing import Any

try:
    from .xhs_search import fetch_xhs_note_detail_by_html, search_xhs_hot
except ImportError:
    # 兼容直接执行：python xhs/xhs_note_pipeline.py
    from xhs_search import fetch_xhs_note_detail_by_html, search_xhs_hot


def _to_json_or_text(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return {"raw_text": raw}


def _keyword_output_path(keyword: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]+', "_", (keyword or "").strip())
    safe = re.sub(r"\s+", "_", safe)
    safe = safe.strip("._")
    if not safe:
        safe = "keyword"
    out_dir = Path("json")
    out_dir.mkdir(parents=True, exist_ok=True)
    return str(out_dir / f"xhs_search_{safe}.json")


def _extract_note_targets(search_payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = search_payload.get("data") if isinstance(search_payload, dict) else None
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("model_type") != "note":
            continue
        note_id = str(item.get("id") or "")
        xsec_token = str(item.get("xsec_token") or "")
        if not note_id or not xsec_token:
            continue
        note_url = f"https://www.xiaohongshu.com/explore/{note_id}?xsec_token={xsec_token}"
        note_card = item.get("note_card") if isinstance(item.get("note_card"), dict) else {}
        title = str(note_card.get("display_title") or "")
        image_list = note_card.get("image_list") if isinstance(note_card.get("image_list"), list) else []
        user = note_card.get("user") if isinstance(note_card.get("user"), dict) else {}
        out.append(
            {
                "note_id": note_id,
                "xsec_token": xsec_token,
                "note_url": note_url,
                "title": title,
                "image_list": image_list,
                "user": user,
            }
        )
    return out


async def _poll_note_details_concurrently(
    notes: list[dict[str, Any]],
    poll_count: int,
    interval_seconds: float,
    timeout_seconds: float,
    max_concurrency: int = 5,
) -> None:
    """并发抓取帖子详情（受并发上限控制）。"""
    if not notes:
        return

    total = max(int(poll_count), 1)
    limit = max(int(max_concurrency), 1)

    for i in range(total):
        semaphore = asyncio.Semaphore(limit)

        async def _fetch_and_merge(note: dict[str, Any]) -> None:
            async with semaphore:
                # 增加轻微随机抖动，避免请求节奏过于机械。
                await asyncio.sleep(random.uniform(0.08, 0.45))

                max_attempts = 3
                for attempt in range(max_attempts):
                    detail_text = await fetch_xhs_note_detail_by_html(
                        note_id=note["note_id"],
                        xsec_token=note["xsec_token"],
                        timeout_seconds=timeout_seconds,
                    )
                    detail_obj = _to_json_or_text(detail_text)
                    detail_data = detail_obj.get("data") if isinstance(detail_obj, dict) else None

                    failed = False
                    if not isinstance(detail_data, dict):
                        failed = True
                    else:
                        raw_text = str(detail_data.get("raw_text") or "")
                        if raw_text.startswith("抓取失败:") or raw_text.startswith("参数错误:"):
                            failed = True

                    if not failed:
                        note.update(detail_data)
                        return

                    # 简单退避重试：每次失败后等待更久并叠加随机抖动。
                    if attempt < max_attempts - 1:
                        backoff_seconds = (0.5 * (2**attempt)) + random.uniform(0.2, 0.9)
                        await asyncio.sleep(backoff_seconds)
                        continue

                    # 最后一次仍失败，保留失败信息，避免整批中断。
                    note.update(
                        detail_data
                        if isinstance(detail_data, dict)
                        else {"raw_text": detail_text}
                    )
                    return

        await asyncio.gather(*[_fetch_and_merge(note) for note in notes])
        if i < total - 1:
            await asyncio.sleep(max(float(interval_seconds), 0.1))


async def search_and_poll_notes(
    keyword: str,
    page_size: int = 20,
    sort: str = "general",
    requirements: list[str] | None = None,
) -> str:
    """关键词搜索后轮询详情，支持主题词 + 需求词组合搜索并合并结果。"""
    poll_count = 3
    interval_seconds = 2.0
    timeout_seconds = 30.0
    output_path = _keyword_output_path(keyword)
    main_keyword = (keyword or "").strip()
    if not main_keyword:
        return json.dumps({"ok": False, "error": "keyword 不能为空"}, ensure_ascii=False)

    clean_requirements: list[str] = []
    for req in requirements or []:
        req_text = str(req or "").strip()
        if req_text and req_text not in clean_requirements:
            clean_requirements.append(req_text)

    # 主题词按 page_size 搜；若 requirements 长度 > 1，则拼接 topic+requirement 各搜 3 条。
    query_specs: list[dict[str, Any]] = [
        {"query": main_keyword, "source": "topic", "requirement": None, "size": max(int(page_size), 1)}
    ]
    if len(clean_requirements) > 1:
        for req in clean_requirements:
            query_specs.append(
                {
                    "query": f"{main_keyword}{req}",
                    "source": "requirement",
                    "requirement": req,
                    "size": 3,
                }
            )

    async def _run_query(spec: dict[str, Any]) -> dict[str, Any]:
        query = str(spec["query"])
        size = int(spec["size"])
        search_text = await search_xhs_hot(
            keyword=query,
            timeout_seconds=timeout_seconds,
            page_size=size,
            sort=sort,
        )
        search_payload = _to_json_or_text(search_text)
        if not isinstance(search_payload, dict):
            return {
                "query": query,
                "source": spec["source"],
                "requirement": spec["requirement"],
                "page_size": size,
                "error": "搜索返回非 JSON",
                "notes": [],
            }

        note_targets = _extract_note_targets(search_payload)
        notes: list[dict[str, Any]] = [{**n} for n in note_targets]
        await _poll_note_details_concurrently(
            notes=notes,
            poll_count=poll_count,
            interval_seconds=interval_seconds,
            timeout_seconds=timeout_seconds,
        )

        return {
            "query": query,
            "source": spec["source"],
            "requirement": spec["requirement"],
            "page_size": size,
            "notes": notes,
            "note_count": len(notes),
        }

    query_results = await asyncio.gather(*[_run_query(spec) for spec in query_specs])
    merged_notes: list[dict[str, Any]] = []
    for result in query_results:
        for note in result.get("notes", []):
            merged_notes.append(
                {
                    **note,
                    "keyword": result.get("query"),
                    "query": result.get("query"),
                    "source": result.get("source"),
                }
            )

    aggregate = {
        "ok": True,
        "params": {
            "topic": main_keyword,
            "requirements": clean_requirements,
            "page_size": max(int(page_size), 1),
            "sort": sort,
            "sub_query_page_size": 3,
            "query_count": len(query_specs),
        },
        "notes": merged_notes,
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(aggregate, f, ensure_ascii=False, indent=2)

    return json.dumps(
        {
            "ok": True,
            "output_path": output_path,
            "query_count": len(query_specs),
            "note_count": len(merged_notes),
        },
        ensure_ascii=False,
    )


async def poll_details_from_search_result(
    xhs_search_text: str,
    poll_count: int = 3,
    interval_seconds: float = 2.0,
    timeout_seconds: float = 30.0,
    output_path: str = "json/xhs_search_details_poll.json",
) -> str:
    """基于已有 search JSON（如 xhs_search3.json）轮询详情页并回填到同一 JSON。"""
    payload = _to_json_or_text(xhs_search_text)
    if not isinstance(payload, dict):
        return json.dumps({"ok": False, "error": "输入不是有效 JSON"}, ensure_ascii=False)
    req = payload.get("request_params") if isinstance(payload.get("request_params"), dict) else {}
    search_keyword = str(req.get("keyword") or "").strip()

    data = payload.get("data")
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return json.dumps({"ok": False, "error": "输入 JSON 缺少 data.items"}, ensure_ascii=False)

    notes: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("model_type") != "note":
            continue
        note_id = str(item.get("id") or "")
        xsec_token = str(item.get("xsec_token") or "")
        if not note_id or not xsec_token:
            continue
        note_card = item.get("note_card") if isinstance(item.get("note_card"), dict) else {}
        notes.append(
            {
                "note_id": note_id,
                "xsec_token": xsec_token,
                "note_url": f"https://www.xiaohongshu.com/explore/{note_id}?xsec_token={xsec_token}",
                "title": str(note_card.get("display_title") or ""),
                "image_list": (
                    note_card.get("image_list")
                    if isinstance(note_card.get("image_list"), list)
                    else []
                ),
                "user": note_card.get("user") if isinstance(note_card.get("user"), dict) else {},
                "keyword": search_keyword,
            }
        )

    total = max(int(poll_count), 1)
    await _poll_note_details_concurrently(
        notes=notes,
        poll_count=total,
        interval_seconds=interval_seconds,
        timeout_seconds=timeout_seconds,
    )

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    aggregate = {
        "ok": True,
        "params": {
            "poll_count": total,
            "interval_seconds": interval_seconds,
            "timeout_seconds": timeout_seconds,
        },
        "notes": notes,
    }
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(aggregate, f, ensure_ascii=False, indent=2)

    return json.dumps(
        {"ok": True, "output_path": str(output_file), "poll_count": total},
        ensure_ascii=False,
    )

