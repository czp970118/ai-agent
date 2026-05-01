import json
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..xhs.xhs_search import search_xhs_keyword_and_poll_details as search_impl
from ..xhs.xhs_note_cache import db_delete_cached_note, db_get_cached_note, db_list_cached_notes, db_update_cached_note
from ..xhs.xhs_scheduler_state import (
    list_recent_scheduler_runs,
    load_scheduler_config,
    load_state as load_scheduler_state,
    save_scheduler_config,
)
from ..xhs.xhs_task_store import create_task, list_tasks, mark_task_cancelled, retry_task_failed_slots
from ..xhs.xhs_scheduler import xhs_scheduler_service

search_router = APIRouter(prefix="/search", tags=["search"])


class SearchPollRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    requirements: list[str] = Field(default_factory=list)
    page_size: int = Field(default=20, ge=1, le=100)
    sort: str = "general"


class UpdateCachedNoteRequest(BaseModel):
    title: str = Field(default="", min_length=0)
    content_text: str = Field(default="", min_length=0)
    tags: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    city_name: str = Field(default="", min_length=0)
    image_list: list[str] = Field(default_factory=list)


class SchedulerConfigPatchRequest(BaseModel):
    enabled: bool | None = None
    source: str | None = None
    email_enabled: bool | None = None
    per_query_page_size: int | None = Field(default=None, ge=1, le=100)
    combo_repeat_min: int | None = Field(default=None, ge=1, le=10)
    combo_repeat_max: int | None = Field(default=None, ge=1, le=20)
    topic_batch_size: int | None = Field(default=None, ge=1, le=20)


class SchedulerTaskCreateRequest(BaseModel):
    source: str = Field(default="xhs", min_length=1)
    run_date: str = Field(..., min_length=10, max_length=10)
    domain: str = Field(default="", min_length=0)
    city: str = Field(..., min_length=1)
    fetch_count: int = Field(default=1, ge=1, le=24)
    time_points: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    page_size: int = Field(default=20, ge=1, le=100)
    repeat_count: int = Field(default=2, ge=1, le=10)
    email_enabled: bool = True


@search_router.post("/poll")
async def post_search_poll(body: SearchPollRequest) -> dict:
    text = await search_impl(
        topic=body.topic.strip(),
        page_size=body.page_size,
        sort=body.sort,
        requirements=body.requirements,
    )
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            output_path = payload.get("output_path")
            if isinstance(output_path, str) and output_path.strip():
                p = Path(output_path.strip())
                if not p.is_absolute():
                    p = Path.cwd() / p
                try:
                    with p.open("r", encoding="utf-8") as f:
                        full_payload = json.load(f)
                    if isinstance(full_payload, dict):
                        return full_payload
                    return {"ok": False, "error": "输出文件内容不是 JSON 对象", "output_path": str(p)}
                except FileNotFoundError:
                    return {"ok": False, "error": "输出文件不存在", "output_path": str(p)}
                except json.JSONDecodeError:
                    return {"ok": False, "error": "输出文件不是有效 JSON", "output_path": str(p)}
            return payload
        return {"ok": False, "error": "返回结果不是 JSON 对象", "raw": text}
    except json.JSONDecodeError:
        failed = text.startswith("请求失败:") or text.startswith("抓取失败:") or text.startswith("参数错误:")
        return {"ok": not failed, "result": text}


@search_router.get("/cache/notes")
async def get_cache_notes(
    keyword: str = Query("", min_length=0),
    tag: str = Query("", min_length=0),
    domain: list[str] = Query(default=[]),
    sort_by: str = Query("", min_length=0),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict:
    return db_list_cached_notes(
        keyword=keyword,
        tag=tag,
        domains=domain,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
    )


@search_router.get("/cache/notes/{note_id}")
async def get_cache_note_detail(note_id: str) -> dict:
    item = db_get_cached_note(note_id)
    if item is None:
        raise HTTPException(status_code=404, detail="note not found")
    return {"item": item}


@search_router.patch("/cache/notes/{note_id}")
async def patch_cache_note_detail(note_id: str, body: UpdateCachedNoteRequest) -> dict:
    item = db_update_cached_note(
        note_id,
        title=str(body.title or "").strip(),
        content_text=str(body.content_text or "").strip(),
        tags=body.tags,
        domains=body.domains,
        city_name=str(body.city_name or "").strip(),
        image_list=body.image_list,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="note not found")
    return {"item": item}


@search_router.delete("/cache/notes/{note_id}")
async def delete_cache_note_detail(note_id: str) -> dict:
    deleted = db_delete_cached_note(note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="note not found")
    return {"ok": True}


@search_router.get("/xhs-image-proxy")
async def get_xhs_image_proxy(url: str = Query(..., min_length=1)) -> Response:
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="invalid url scheme")
    host = (parsed.hostname or "").lower()
    if not host.endswith("xhscdn.com"):
        raise HTTPException(status_code=400, detail="host not allowed")
    headers = {
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
        ),
        "referer": "https://www.xiaohongshu.com/",
        "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers) as client:
            resp = await client.get(url)
        if resp.status_code >= 400:
            raise HTTPException(status_code=resp.status_code, detail="upstream rejected")
        media_type = resp.headers.get("content-type", "image/jpeg")
        return Response(
            content=resp.content,
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=86400",
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"proxy failed: {exc}") from exc


@search_router.get("/scheduler/xhs")
async def get_xhs_scheduler_dashboard(limit: int = Query(20, ge=1, le=100)) -> dict:
    config = load_scheduler_config()
    state = load_scheduler_state()
    today_plan = {}
    plans = state.get("plans")
    if isinstance(plans, dict):
        from datetime import datetime, timedelta, timezone

        cst = timezone(timedelta(hours=8))
        today = datetime.now(cst).strftime("%Y-%m-%d")
        raw = plans.get(today)
        if isinstance(raw, dict):
            today_plan = raw
    executed = state.get("executed") if isinstance(state.get("executed"), dict) else {}
    return {
        "config": config,
        "state": {
            "city_cursor": int(state.get("city_cursor") or 0),
            "topic_cursor": int(state.get("topic_cursor") or 0),
            "today_plan": today_plan,
            "executed": executed,
        },
        "runs": list_recent_scheduler_runs(limit=limit),
    }


@search_router.patch("/scheduler/xhs/config")
async def patch_xhs_scheduler_config(body: SchedulerConfigPatchRequest) -> dict:
    payload: dict = {}
    if body.enabled is not None:
        payload["enabled"] = body.enabled
    if body.source is not None:
        payload["source"] = body.source
    if body.email_enabled is not None:
        payload["email_enabled"] = body.email_enabled
    if body.per_query_page_size is not None:
        payload["per_query_page_size"] = body.per_query_page_size
    if body.combo_repeat_min is not None:
        payload["combo_repeat_min"] = body.combo_repeat_min
    if body.combo_repeat_max is not None:
        payload["combo_repeat_max"] = body.combo_repeat_max
    if body.topic_batch_size is not None:
        payload["topic_batch_size"] = body.topic_batch_size
    updated = save_scheduler_config(payload)
    return {"config": updated}


@search_router.get("/scheduler/xhs/tasks")
async def get_xhs_scheduler_tasks(limit: int = Query(100, ge=1, le=500)) -> dict:
    return {"items": list_tasks(limit=limit)}


@search_router.post("/scheduler/xhs/tasks")
async def post_xhs_scheduler_task(body: SchedulerTaskCreateRequest) -> dict:
    try:
        item = create_task(
            {
                "source": body.source,
                "run_date": body.run_date,
                "domain": body.domain,
                "city": body.city,
                "fetch_count": body.fetch_count,
                "time_points": body.time_points,
                "topics": body.topics,
                "page_size": body.page_size,
                "repeat_count": body.repeat_count,
                "email_enabled": body.email_enabled,
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": item}


@search_router.post("/scheduler/xhs/tasks/{task_id}/cancel")
async def post_xhs_scheduler_task_cancel(task_id: str) -> dict:
    item = mark_task_cancelled(task_id)
    if item is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {"item": item}


@search_router.post("/scheduler/xhs/tasks/{task_id}/retry")
async def post_xhs_scheduler_task_retry(task_id: str) -> dict:
    item = retry_task_failed_slots(task_id)
    if item is None:
        raise HTTPException(status_code=404, detail="task not found")
    return {"item": item}


@search_router.post("/scheduler/xhs/tasks/{task_id}/run-now")
async def post_xhs_scheduler_task_run_now(task_id: str) -> dict:
    try:
        item = await xhs_scheduler_service.run_task_now(task_id)
        return {"item": item}
    except ValueError as exc:
        text = str(exc)
        if text == "task not found":
            raise HTTPException(status_code=404, detail=text) from exc
        raise HTTPException(status_code=400, detail=text) from exc
