import json
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..xhs.xhs_search import search_xhs_keyword_and_poll_details as search_impl
from ..xhs.xhs_note_cache import db_delete_cached_note, db_get_cached_note, db_list_cached_notes, db_update_cached_note

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
