import asyncio
import json
import logging
import os
import random
import re
from pathlib import Path
from typing import Any

try:
    from .xhs_search import fetch_xhs_note_detail_by_html, search_xhs_hot
    from .xhs_note_cache import db_fetch_cached_payload, db_upsert_query_cache
except ImportError:
    # 兼容直接执行：python xhs/xhs_note_pipeline.py
    from xhs_search import fetch_xhs_note_detail_by_html, search_xhs_hot
    from xhs_note_cache import db_fetch_cached_payload, db_upsert_query_cache

logger = logging.getLogger(__name__)


def _to_json_or_text(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return {"raw_text": raw}


def _parse_bool_flag(value: str) -> bool | None:
    text = (value or "").strip().lower()
    if not text:
        return None
    if text in ("1", "true", "yes", "on"):
        return True
    if text in ("0", "false", "no", "off"):
        return False
    return None


def _should_persist_search_json() -> bool:
    """默认：本地落盘，线上不落盘；可通过环境变量覆盖。"""
    override = _parse_bool_flag(os.getenv("XHS_PERSIST_SEARCH_JSON", ""))
    if override is not None:
        return override
    env = (
        os.getenv("APP_ENV", "")
        or os.getenv("ENV", "")
        or os.getenv("NODE_ENV", "")
    ).strip().lower()
    # 默认更保守：仅在本地/开发环境落盘 JSON；其他环境（含未显式声明）不落盘。
    return env in ("dev", "development", "local", "test")


def _keyword_output_path(keyword: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]+', "_", (keyword or "").strip())
    safe = re.sub(r"\s+", "_", safe).strip("._") or "keyword"
    json_dir = Path(__file__).resolve().parents[2] / "json"
    json_dir.mkdir(parents=True, exist_ok=True)
    return str(json_dir / f"xhs_search_{safe}.json")


def _flatten_wb_dft_image_urls(image_list: Any) -> list[str]:
    """仅保留 WB_DFT，并将 image_list 打平成 URL 列表。"""
    if not isinstance(image_list, list):
        return []

    urls: list[str] = []
    for image_item in image_list:
        if not isinstance(image_item, dict):
            continue
        info_list = image_item.get("info_list")
        if not isinstance(info_list, list):
            continue

        chosen_url = ""
        for info in info_list:
            if not isinstance(info, dict):
                continue
            if str(info.get("image_scene") or "") == "WB_DFT":
                chosen_url = str(info.get("url") or "").strip()
                if chosen_url:
                    break
        if chosen_url:
            urls.append(chosen_url)
    return urls


def _extract_raw_image_list(item: Any) -> list[dict[str, Any]]:
    """优先返回原始 image_list（对象数组），避免误变成空列表。"""
    if not isinstance(item, dict):
        return []
    note_card: dict[str, Any] = {}
    raw_note_card = item.get("note_card")
    if isinstance(raw_note_card, dict):
        note_card = raw_note_card
    candidates = [item.get("image_list"), note_card.get("image_list")]
    for candidate in candidates:
        if isinstance(candidate, list) and all(isinstance(x, dict) for x in candidate):
            return candidate
    return []


def _extract_wb_dft_urls(item: Any) -> list[str]:
    return _flatten_wb_dft_image_urls(_extract_raw_image_list(item))


def _extract_note_targets(search_payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = search_payload.get("data") if isinstance(search_payload, dict) else None
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        if isinstance(search_payload, dict):
            logger.warning("xhs_extract_targets_no_items keys=%s", list(search_payload.keys())[:20])
        return []

    out: list[dict[str, Any]] = []
    skipped = {
        "non_dict": 0,
        "model_type_filtered": 0,
        "missing_note_id": 0,
        "missing_xsec_token": 0,
    }
    for item in items:
        if not isinstance(item, dict):
            skipped["non_dict"] += 1
            continue
        model_type = str(item.get("model_type") or "").strip().lower()
        raw_note_card = item.get("note_card")
        note_card: dict[str, Any] = raw_note_card if isinstance(raw_note_card, dict) else {}
        if model_type not in ("", "note", "note_v2", "normal", "hot_note") and not note_card:
            skipped["model_type_filtered"] += 1
            continue
        note_id = str(
            item.get("id")
            or item.get("note_id")
            or note_card.get("id")
            or note_card.get("note_id")
            or ""
        )
        xsec_token = str(
            item.get("xsec_token")
            or note_card.get("xsec_token")
            or note_card.get("token")
            or ""
        )
        if not note_id:
            skipped["missing_note_id"] += 1
            continue
        if not xsec_token:
            skipped["missing_xsec_token"] += 1
        note_url = (
            f"https://www.xiaohongshu.com/explore/{note_id}?xsec_token={xsec_token}"
            if xsec_token
            else f"https://www.xiaohongshu.com/explore/{note_id}"
        )
        title = str(note_card.get("display_title") or "")
        image_list = _extract_wb_dft_urls(item)
        user_raw = note_card.get("user")
        user = user_raw if isinstance(user_raw, dict) else {}
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
    logger.info(
        "xhs_extract_targets_stats total_items=%s extracted=%s skipped=%s",
        len(items),
        len(out),
        json.dumps(skipped, ensure_ascii=False),
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
    stats = {"attempts": 0, "success": 0, "failed_after_retry": 0}

    for i in range(total):
        semaphore = asyncio.Semaphore(limit)

        async def _fetch_and_merge(note: dict[str, Any]) -> None:
            async with semaphore:
                # 增加轻微随机抖动，避免请求节奏过于机械。
                await asyncio.sleep(random.uniform(0.08, 0.45))

                max_attempts = 3
                for attempt in range(max_attempts):
                    stats["attempts"] += 1
                    detail_text = await fetch_xhs_note_detail_by_html(
                        note_id=note["note_id"],
                        xsec_token=note.get("xsec_token") or "",
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

                    if not failed and isinstance(detail_data, dict):
                        previous_images = note.get("image_list") if isinstance(note.get("image_list"), list) else []
                        note.update(detail_data)
                        merged_images = _flatten_wb_dft_image_urls(note.get("image_list"))
                        note["image_list"] = merged_images or previous_images
                        stats["success"] += 1
                        return

                    # 简单退避重试：每次失败后等待更久并叠加随机抖动。
                    if attempt < max_attempts - 1:
                        backoff_seconds = (0.5 * (2**attempt)) + random.uniform(0.2, 0.9)
                        await asyncio.sleep(backoff_seconds)
                        continue

                    # 最后一次仍失败，保留失败信息，避免整批中断。
                    previous_images = note.get("image_list") if isinstance(note.get("image_list"), list) else []
                    fallback_data = detail_data if isinstance(detail_data, dict) else {"raw_text": detail_text}
                    note.update(fallback_data)
                    merged_images = _flatten_wb_dft_image_urls(note.get("image_list"))
                    note["image_list"] = merged_images or previous_images
                    stats["failed_after_retry"] += 1
                    return

        await asyncio.gather(*[_fetch_and_merge(note) for note in notes])
        if i < total - 1:
            await asyncio.sleep(max(float(interval_seconds), 0.1))
    logger.info(
        "xhs_poll_details_stats total_notes=%s stats=%s",
        len(notes),
        json.dumps(stats, ensure_ascii=False),
    )


async def search_and_poll_notes(
    keyword: str,
    page_size: int = 20,
    sort: str = "general",
    requirements: list[str] | None = None,
    domains: list[str] | None = None,
) -> str:
    """关键词搜索后轮询详情，支持主题词 + 需求词组合搜索并合并结果。"""
    poll_count = max(int(os.getenv("XHS_POLL_COUNT", "2")), 1)
    interval_seconds = max(float(os.getenv("XHS_POLL_INTERVAL_SECONDS", "1.0")), 0.1)
    timeout_seconds = max(float(os.getenv("XHS_SEARCH_TIMEOUT_SECONDS", "15.0")), 5.0)
    requirement_enabled = _parse_bool_flag(os.getenv("XHS_ENABLE_REQUIREMENT_QUERIES", "0")) is True
    query_parallel = _parse_bool_flag(os.getenv("XHS_QUERY_PARALLEL", "0")) is True
    main_keyword = (keyword or "").strip()
    if not main_keyword:
        return json.dumps({"ok": False, "error": "keyword 不能为空"}, ensure_ascii=False)

    clean_requirements: list[str] = []
    for req in requirements or []:
        req_text = str(req or "").strip()
        if req_text and req_text not in clean_requirements:
            clean_requirements.append(req_text)
    target_count = max(int(page_size), 1)
    clean_domains: list[str] = []
    for d in domains or []:
        text = str(d or "").strip()
        if text and text not in clean_domains:
            clean_domains.append(text)
    db_payload = db_fetch_cached_payload(
        main_keyword,
        clean_requirements,
        target_count=target_count,
        domains=clean_domains,
    )
    db_notes: list[dict[str, Any]] = []
    if isinstance(db_payload, dict):
        payload_notes = db_payload.get("notes")
        if isinstance(payload_notes, list):
            db_notes = [n for n in payload_notes if isinstance(n, dict)]
    if len(db_notes) >= target_count:
        logger.info("xhs_db_hit keyword=%s matched=%s target_count=%s", main_keyword, len(db_notes), target_count)
        return json.dumps(db_payload, ensure_ascii=False)
    need_count = max(target_count - len(db_notes), 0)

    # 固定请求量：topic 请求 8 条；每个 requirement 请求 2 条。
    topic_query_size = min(max(int((need_count or target_count) * 1.5), 4), 12)
    sub_query_size = min(max(int((need_count or target_count) * 0.6), 1), 4)
    query_specs: list[dict[str, Any]] = [
        {"query": main_keyword, "source": "topic", "requirement": None, "size": topic_query_size}
    ]
    if requirement_enabled:
        for req in clean_requirements:
            query_specs.append(
                {
                    "query": f"{main_keyword}{req}",
                    "source": "requirement",
                    "requirement": req,
                    "size": sub_query_size,
                }
            )
    logger.info(
        "xhs_query_strategy timeout_seconds=%s poll_count=%s interval_seconds=%s requirement_enabled=%s query_parallel=%s requirement_count=%s",
        timeout_seconds,
        poll_count,
        interval_seconds,
        requirement_enabled,
        query_parallel,
        len(clean_requirements),
    )

    async def _run_query(spec: dict[str, Any]) -> dict[str, Any]:
        query = str(spec["query"])
        size = int(spec["size"])
        logger.info(
            "xhs_query_start query=%s source=%s requirement=%s page_size=%s",
            query,
            spec.get("source"),
            spec.get("requirement"),
            size,
        )
        search_text = await search_xhs_hot(
            keyword=query,
            timeout_seconds=timeout_seconds,
            page_size=size,
            sort=sort,
        )
        search_payload = _to_json_or_text(search_text)
        if not isinstance(search_payload, dict):
            logger.warning("xhs_query_non_json query=%s preview=%s", query, str(search_text)[:500])
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
        logger.info(
            "xhs_query_done query=%s extracted_notes=%s",
            query,
            len(notes),
        )

        return {
            "query": query,
            "source": spec["source"],
            "requirement": spec["requirement"],
            "page_size": size,
            "notes": notes,
            "note_count": len(notes),
        }

    if query_parallel:
        query_results = await asyncio.gather(*[_run_query(spec) for spec in query_specs])
    else:
        query_results: list[dict[str, Any]] = []
        for spec in query_specs:
            query_results.append(await _run_query(spec))
            await asyncio.sleep(max(float(os.getenv("XHS_QUERY_GAP_SECONDS", "0.6")), 0.1))
    merged_notes: list[dict[str, Any]] = [*db_notes]
    seen_note_ids: set[str] = set()
    for note in db_notes:
        note_id = str(note.get("note_id") or "").strip()
        if note_id:
            seen_note_ids.add(note_id)
    live_added_count = 0
    for result in query_results:
        for note in result.get("notes", []):
            note_id = str(note.get("note_id") or "").strip()
            if note_id and note_id in seen_note_ids:
                continue
            merged_notes.append(
                {
                    **note,
                    "keyword": result.get("query"),
                    "query": result.get("query"),
                    "source": result.get("source"),
                }
            )
            if note_id:
                seen_note_ids.add(note_id)
            live_added_count += 1

    merged_notes = merged_notes[:target_count]
    final_db_count = min(len(db_notes), len(merged_notes))
    final_live_count = max(len(merged_notes) - final_db_count, 0)
    logger.info(
        "xhs_source_mix_stats keyword=%s db_prefetch=%s live_added=%s final_db=%s final_live=%s final_total=%s target=%s",
        main_keyword,
        len(db_notes),
        live_added_count,
        final_db_count,
        final_live_count,
        len(merged_notes),
        target_count,
    )

    aggregate = {
        "ok": True,
        "params": {
            "topic": main_keyword,
            "requirements": clean_requirements,
            "domains": clean_domains,
            "page_size": topic_query_size,
            "sort": sort,
            "sub_query_page_size": sub_query_size,
            "query_count": len(query_specs),
            "db_prefetch_count": len(db_notes),
            "need_count": need_count,
        },
        "notes": merged_notes,
    }
    db_upsert_query_cache(main_keyword, aggregate, clean_requirements, domains=clean_domains)
    logger.info(
        "xhs_db_upsert keyword=%s note_count=%s",
        main_keyword,
        len(merged_notes),
    )
    if _should_persist_search_json():
        output_file = _keyword_output_path(main_keyword)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(aggregate, f, ensure_ascii=False, indent=2)
    return json.dumps(aggregate, ensure_ascii=False)


async def poll_details_from_search_result(
    xhs_search_text: str,
    poll_count: int = 3,
    interval_seconds: float = 2.0,
    timeout_seconds: float = 30.0,
    output_path: str | None = None,
    persist: bool | None = None,
) -> str:
    """基于已有 search JSON（如 xhs_search3.json）轮询详情页并回填到同一 JSON。"""
    json_dir = Path(__file__).resolve().parents[2] / "json"
    json_dir.mkdir(parents=True, exist_ok=True)

    payload = _to_json_or_text(xhs_search_text)
    if not isinstance(payload, dict):
        return json.dumps({"ok": False, "error": "输入不是有效 JSON"}, ensure_ascii=False)
    req: dict[str, Any] = {}
    req_raw = payload.get("request_params")
    if isinstance(req_raw, dict):
        req = req_raw
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
        note_card: dict[str, Any] = {}
        raw_note_card = item.get("note_card")
        if isinstance(raw_note_card, dict):
            note_card = raw_note_card
        user_raw = note_card.get("user")
        notes.append(
            {
                "note_id": note_id,
                "xsec_token": xsec_token,
                "note_url": f"https://www.xiaohongshu.com/explore/{note_id}?xsec_token={xsec_token}",
                "title": str(note_card.get("display_title") or ""),
                "image_list": _extract_wb_dft_urls(item),
                "user": user_raw if isinstance(user_raw, dict) else {},
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

    aggregate = {
        "ok": True,
        "params": {
            "poll_count": total,
            "interval_seconds": interval_seconds,
            "timeout_seconds": timeout_seconds,
        },
        "notes": notes,
    }
    should_persist = _should_persist_search_json() if persist is None else persist
    if should_persist:
        output_file = (
            Path(output_path)
            if output_path
            else (json_dir / "xhs_search_details_poll.json")
        )
        output_file.parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(aggregate, f, ensure_ascii=False, indent=2)
        return json.dumps(
            {"ok": True, "output_path": str(output_file), "poll_count": total},
            ensure_ascii=False,
        )

    return json.dumps(aggregate, ensure_ascii=False)

