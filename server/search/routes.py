import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..xhs.xhs_search import search_xhs_keyword_and_poll_details as search_impl

search_router = APIRouter(prefix="/search", tags=["search"])


class SearchPollRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    requirements: list[str] = Field(default_factory=list)
    page_size: int = Field(default=20, ge=1, le=100)
    sort: str = "general"


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
