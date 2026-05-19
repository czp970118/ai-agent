import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any
from uuid import uuid4
import httpx
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field 

from ..constants import (
    CASES_SYSTEM_PROMPT,
    DEEPSEEK_CHAT_URL,
    DEFAULT_SYSTEM_PROMPT,
    load_xiaohongshu_publish_prompt,
    SENTENCE_ANALYSIS_PROMPT,
)
from ..xhs.baoyu_image_cards import generate_baoyu_cover, get_catalog as get_baoyu_image_cards_catalog
from ..xhs.baoyu_image_cards.extend_config import load_extend_config
from ..xhs.cover_template import COVER_TEMPLATE_DOMAIN, parse_cover_template_body, render_cover_prompt
from ..xhs.cover_overlay import overlay_cover_to_file
from ..xhs.quiz_card import parse_options_text, save_quiz_answer_card, save_quiz_question_card
from ..xhs.xhs_cover_image import generate_xhs_cover_image, topic_slug
from ..xhs.xhs_search import search_xhs_keyword_and_poll_details as search_impl
from .memory_store import (
    append_messages,
    fetch_messages,
    list_conversations,
    resolve_conversation,
)
from .creative_works_store import (
    create_creative_work,
    delete_creative_work,
    get_creative_work,
    list_creative_works,
    patch_creative_work,
)
from ..storage.cover_storage import promote_local_file_to_cover_storage, save_work_cover_bytes
from ..storage.oss_client import get_oss_object, is_oss_configured
from .prompt_library_store import (
    create_category,
    create_style,
    delete_category,
    delete_style,
    fetch_style_body,
    get_prompt_template_domain,
    list_prompt_library,
    update_category,
    update_style,
)

chat_router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("mcp_server.chat")
REPO_ROOT = Path(__file__).resolve().parents[3]

AGENT_SYSTEM_PROMPTS: dict[str, str] = {
    "xiaohongshu": load_xiaohongshu_publish_prompt(),
    "cases": CASES_SYSTEM_PROMPT,
}

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatStreamRequest(BaseModel):
    agent: str | None = None
    messages: list[ChatMessage] = Field(default_factory=list)
    workflow: dict[str, Any] = Field(default_factory=dict)


class ResolveConversationRequest(BaseModel):
    user_id: str
    agent: str
    force_new: bool = False


class ConversationMessageInput(BaseModel):
    role: str
    content: str
    meta: dict[str, Any] = Field(default_factory=dict)


class AppendConversationMessagesRequest(BaseModel):
    messages: list[ConversationMessageInput] = Field(default_factory=list)


class PromptCategoryCreate(BaseModel):
    agent: str
    name: str
    sort_order: int | None = None


class PromptCategoryPatch(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class PromptStyleCreate(BaseModel):
    category_id: str
    name: str
    body: str = ""
    is_default: bool = False
    sort_order: int | None = None


class PromptStylePatch(BaseModel):
    name: str | None = None
    body: str | None = None
    is_default: bool | None = None
    sort_order: int | None = None


class CreativeWorkCreate(BaseModel):
    id: str | None = None
    title: str | None = None
    prompt: str | None = None
    body: str | None = None
    domain: str | None = None
    status: str | None = None
    platform: str | None = None
    coverPath: str | None = None
    coverSource: str | None = None
    coverTemplateId: str | None = None
    coverRefUrls: list[str] | None = None
    coverTitleMain: str | None = None
    coverTitleSub: str | None = None


class CreativeWorkPatch(BaseModel):
    title: str | None = None
    prompt: str | None = None
    body: str | None = None
    domain: str | None = None
    status: str | None = None
    platform: str | None = None
    coverPath: str | None = None
    coverSource: str | None = None
    coverTemplateId: str | None = None
    coverRefUrls: list[str] | None = None
    coverTitleMain: str | None = None
    coverTitleSub: str | None = None


class CoverGenerateRequest(BaseModel):
    work_id: str | None = None
    template_style_id: str | None = None
    topic: str = ""
    content: str = ""
    title_main: str = ""
    title_sub: str = ""
    reference_image_urls: list[str] = Field(default_factory=list)
    preset: str | None = None
    style: str | None = None
    layout: str | None = None
    palette: str | None = None


class CoverOverlayRequest(BaseModel):
    work_id: str
    title_main: str = ""
    title_sub: str = ""
    base_image_path: str | None = None
    base_image_url: str | None = None


class QuizQuestionRequest(BaseModel):
    work_id: str
    header: str = "公基常识"
    question: str = ""
    options: list[str] = Field(default_factory=list)
    options_text: str = ""


class QuizAnswerRequest(BaseModel):
    work_id: str
    header: str = "正确答案"
    answer: str = ""
    explanation: str = ""
    extra_title: str = "古代知识拓展："
    extra_lines: list[str] = Field(default_factory=list)
    extra_text: str = ""


def _sse(event: str, data: Any) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def _resolve_system_prompt(agent: str | None) -> str:
    if isinstance(agent, str) and agent.strip():
        return AGENT_SYSTEM_PROMPTS.get(agent.strip(), DEFAULT_SYSTEM_PROMPT)
    return DEFAULT_SYSTEM_PROMPT


def _workflow_custom_system_prompt(workflow: dict[str, Any], agent: str | None) -> str | None:
    user_id = str(workflow.get("user_id") or "").strip()
    style_id = str(workflow.get("prompt_style_id") or "").strip()
    aid = str(agent or "").strip()
    if not user_id or not style_id or not aid:
        return None
    try:
        return fetch_style_body(user_id=user_id, agent=aid, style_id=style_id)
    except ValueError:
        return None


def _extract_last_user_message(messages: list[dict[str, Any]]) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content")
            if isinstance(content, str):
                return content.strip()
    return ""


def _normalize_requirements(value: Any, topic: str) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text or text == topic or text in out:
            continue
        out.append(text)
        if len(out) >= 5:
            break
    return out


def _normalize_page_size(value: Any) -> int:
    try:
        number = int(value)
    except Exception:
        return 15
    return max(1, min(number, 50))


def _normalize_city_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text[:32]


def _normalize_cover_config(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    style = str(value.get("style") or "").strip()
    title_main = str(value.get("title_main") or "").strip()
    title_sub = str(value.get("title_sub") or "").strip()
    layout = str(value.get("layout") or "").strip()
    palette = str(value.get("palette") or "").strip()
    out: dict[str, Any] = {}
    if style:
        out["style"] = style[:32]
    if title_main:
        out["title_main"] = title_main[:40]
    if title_sub:
        out["title_sub"] = title_sub[:48]
    if layout:
        out["layout"] = layout[:24]
    if palette:
        out["palette"] = palette[:24]
    return out


def _fallback_plan_xiaohongshu_params(messages: list[dict[str, Any]]) -> dict[str, Any]:
    user_input = _extract_last_user_message(messages)
    if not user_input:
        return {"ok": False, "error": "兜底参数提取失败：缺少用户输入"}
    topic = user_input.splitlines()[0].strip()[:32] or "小红书选题"
    return {
        "ok": True,
        "topic": topic,
        "city_name": "",
        "requirements": [],
        "page_size": 15,
        "fallback": True,
    }


async def _plan_xiaohongshu_params(
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    enable_cover_planning: bool = False,
) -> dict[str, Any]:
    chat_input = _extract_last_user_message(messages)
    if not chat_input:
        return {"ok": False, "error": "无法解析用户输入"}

    system_prompt = SENTENCE_ANALYSIS_PROMPT
    if enable_cover_planning:
        system_prompt = (
            f"{SENTENCE_ANALYSIS_PROMPT}"
            "本次需要生成封面参数，请务必输出 cover 对象，并尽量给出 title_main 与 title_sub。"
        )

    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"chatInput: {chat_input}"},
        ],
        "temperature": 0.2,
    }

    raw_content = ""
    timeout_sec = float(os.getenv("XHS_PLAN_TIMEOUT_SECONDS", "60"))
    last_error = ""
    parsed: dict[str, Any] | None = None

    for attempt in range(1, 3):
        try:
            async with httpx.AsyncClient(timeout=timeout_sec) as client:
                resp = await client.post(
                    DEEPSEEK_CHAT_URL,
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                    json=payload,
                )
            if not resp.is_success:
                logger.warning(
                    "xhs_plan_http_error attempt=%s status=%s body=%s",
                    attempt,
                    resp.status_code,
                    resp.text[:1200],
                )
                return {"ok": False, "error": f"参数规划失败({resp.status_code})"}
            data = resp.json()
            content = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            raw_content = str(content or "")
            logger.info("xhs_plan_raw_content=%s", raw_content[:2000])
            if not isinstance(content, str) or not content.strip():
                return {"ok": False, "error": "参数规划结果为空"}
            parsed = json.loads(content.strip())
            break
        except httpx.ReadTimeout as exc:
            last_error = f"{type(exc).__name__}({timeout_sec}s)"
            logger.warning("xhs_plan_timeout attempt=%s timeout=%ss", attempt, timeout_sec)
            if attempt < 2:
                await asyncio.sleep(0.6)
                continue
            return {"ok": False, "error": f"参数规划超时: {last_error}"}
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            logger.exception(
                "xhs_plan_exception attempt=%s error=%s raw_content=%s",
                attempt,
                last_error,
                raw_content[:2000],
            )
            return {"ok": False, "error": f"参数规划异常({type(exc).__name__}): {exc}"}

    if not isinstance(parsed, dict):
        return {"ok": False, "error": f"参数规划失败: {last_error or 'unknown'}"}

    topic = str(parsed.get("topic") or "").strip()
    if not topic:
        return {"ok": False, "error": "参数规划缺少 topic"}
    requirements = _normalize_requirements(parsed.get("requirements"), topic)
    page_size = _normalize_page_size(parsed.get("page_size"))
    city_name = _normalize_city_name(parsed.get("city_name"))
    cover = _normalize_cover_config(parsed.get("cover"))
    return {
        "ok": True,
        "topic": topic,
        "city_name": city_name,
        "requirements": requirements,
        "page_size": page_size,
        "cover": cover,
    }


def _resolve_xhs_output(text: str) -> dict[str, Any]:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return {"ok": False, "error": "热贴返回非 JSON", "raw": text[:500]}
    if not isinstance(payload, dict):
        return {"ok": False, "error": "热贴返回不是 JSON 对象"}

    output_path = payload.get("output_path")
    if not isinstance(output_path, str) or not output_path.strip():
        return payload
    p = output_path.strip()
    path = p if p.startswith("/") else os.path.join(os.getcwd(), p)
    try:
        with open(path, "r", encoding="utf-8") as f:
            expanded = json.load(f)
        if isinstance(expanded, dict):
            return expanded
    except Exception:
        pass
    return payload


def _build_xhs_generation_context(
    user_input: str,
    planned: dict[str, Any],
    search_payload: dict[str, Any],
) -> str:
    notes = search_payload.get("notes")
    note_samples: list[dict[str, Any]] = []
    if isinstance(notes, list):
        for row in notes[:20]:
            if not isinstance(row, dict):
                continue
            note_samples.append(
                {
                    "note_id": row.get("note_id"),
                    "title": row.get("title"),
                    "url": row.get("note_url") or row.get("url"),
                    "content_text": row.get("content_text"),
                    "like_count": row.get("like_count"),
                    "collect_count": row.get("collect_count"),
                    "comment_count": row.get("comment_count"),
                }
            )
    compact = {
        "params": search_payload.get("params", {}),
        "note_count": len(notes) if isinstance(notes, list) else 0,
        "notes": note_samples,
    }
    return (
        f"用户原始需求:\n{user_input}\n\n"
        f"参数规划结果:\n{json.dumps(planned, ensure_ascii=False)}\n\n"
        f"热贴数据(精简JSON):\n{json.dumps(compact, ensure_ascii=False)}\n\n"
        "请基于这些输入生成最终可发布的小红书内容。\n"
        "直接输出正文内容（Markdown/纯文本都可），不要输出 JSON、不要输出代码块、不要解释你的思考过程。"
    )


def _extract_xhs_references_and_meta(
    search_payload: dict[str, Any], planned: dict[str, Any] | None = None
) -> dict[str, Any]:
    notes = search_payload.get("notes")
    references: list[dict[str, str]] = []
    query_terms: list[str] = []
    planned_topic = planned.get("topic") if isinstance(planned, dict) else None
    topic_term = str(planned_topic or "").strip()
    if topic_term:
        query_terms.append(topic_term)
    planned_requirements = planned.get("requirements") if isinstance(planned, dict) else None
    if isinstance(planned_requirements, list):
        for req in planned_requirements:
            term = str(req or "").strip()
            if term and term not in query_terms:
                query_terms.append(term)
    if isinstance(notes, list):
        for row in notes:
            if not isinstance(row, dict):
                continue
            if not query_terms:
                q = str(row.get("query") or "").strip()
                if q and q not in query_terms:
                    query_terms.append(q)
            title = str(row.get("title") or "").strip()
            url = str(row.get("note_url") or row.get("url") or "").strip()
            if not url:
                continue
            references.append({"title": title or url, "url": url})
            if len(references) >= 8:
                break
    return {
        "references": references,
        "search_meta": {
            "query_count": len(query_terms),
            "query_terms": query_terms,
        },
    }


@chat_router.get("/generated-image", response_model=None)
async def get_generated_image(path: str = Query(..., min_length=1)):
    raw = str(path or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="path is required")
    target = Path(raw)
    if not target.is_absolute():
        target = REPO_ROOT / target
    try:
        target_resolved = target.resolve(strict=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="image not found") from exc

    allowed_root = (REPO_ROOT / "image-cards").resolve()
    if allowed_root not in target_resolved.parents and target_resolved != allowed_root:
        raise HTTPException(status_code=403, detail="path not allowed")

    return FileResponse(target_resolved)


def _guess_image_content_type(filename: str, fallback: str = "") -> str:
    ext = Path(str(filename or "")).suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    if ext == ".gif":
        return "image/gif"
    if ext == ".bmp":
        return "image/bmp"
    return fallback or "application/octet-stream"


@chat_router.get("/oss/image", response_model=None)
async def get_oss_image(key: str = Query(..., min_length=1)):
    if not is_oss_configured():
        raise HTTPException(status_code=503, detail="OSS 未配置")
    try:
        body, ctype = get_oss_object(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="image not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("OSS 读取失败")
        raise HTTPException(status_code=500, detail=f"OSS 读取失败: {exc}") from exc
    return Response(content=body, media_type=ctype)


@chat_router.post("/stream")
async def post_chat_stream(body: ChatStreamRequest) -> StreamingResponse:
    if not body.messages:
        async def invalid_stream():
            yield _sse("error", {"error": "请提供 messages"})
            yield _sse("end", {"ok": False})
        return StreamingResponse(invalid_stream(), media_type="text/event-stream")

    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        async def missing_key_stream():
            yield _sse("error", {"error": "缺少环境变量 DEEPSEEK_API_KEY"})
            yield _sse("end", {"ok": False})
        return StreamingResponse(missing_key_stream(), media_type="text/event-stream")

    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    async def event_stream():
        trace_id = uuid4().hex[:12]
        xhs_display_meta: dict[str, Any] | None = None
        planned: dict[str, Any] = {}
        logger.info(
            "chat_stream_start trace_id=%s agent=%s message_count=%s",
            trace_id,
            body.agent,
            len(body.messages),
        )
        wf = body.workflow if isinstance(body.workflow, dict) else {}
        custom_prompt = _workflow_custom_system_prompt(wf, body.agent)

        working_messages = [m.model_dump() for m in body.messages]
        system_prompt = (
            custom_prompt if custom_prompt is not None else _resolve_system_prompt(body.agent)
        )
        final_messages = [{"role": "system", "content": system_prompt}, *working_messages]

        if (body.agent or "").strip() == "xiaohongshu":
            planned = await _plan_xiaohongshu_params(
                api_key=api_key,
                model=model,
                messages=working_messages,
                enable_cover_planning=bool(wf.get("generate_cover_image")),
            )
            if not planned.get("ok"):
                fallback = _fallback_plan_xiaohongshu_params(working_messages)
                if not fallback.get("ok"):
                    yield _sse("error", {"error": planned.get("error", "参数规划失败")})
                    yield _sse("end", {"ok": False})
                    return
                logger.warning(
                    "xhs_plan_fallback_used reason=%s fallback=%s",
                    planned.get("error", "unknown"),
                    json.dumps(fallback, ensure_ascii=False),
                )
                planned = fallback
            logger.info(
                "xhs_plan_params trace_id=%s payload=%s",
                trace_id,
                json.dumps(
                    {
                        "topic": planned.get("topic"),
                        "city_name": planned.get("city_name"),
                        "requirements": planned.get("requirements"),
                        "page_size": planned.get("page_size"),
                        "cover": planned.get("cover"),
                    },
                    ensure_ascii=False,
                ),
            )
            if bool(wf.get("generate_cover_image")):
                planned_cover_raw = planned.get("cover")
                planned_cover: dict[str, Any] = (
                    dict(planned_cover_raw) if isinstance(planned_cover_raw, dict) else {}
                )
                existing_cover_raw = wf.get("cover")
                existing_cover: dict[str, Any] = (
                    dict(existing_cover_raw) if isinstance(existing_cover_raw, dict) else {}
                )
                merged_cover: dict[str, Any] = {}
                merged_cover.update(planned_cover)
                merged_cover.update(existing_cover)
                wf["cover"] = merged_cover
            yield _sse("stage", {"name": "planned", "params": planned})

            xhs_request_payload = {
                "topic": str(planned.get("topic") or ""),
                "page_size": int(planned.get("page_size") or 15),
                "sort": "general",
                "city_name": str(planned.get("city_name") or ""),
                "requirements": planned.get("requirements") if isinstance(planned.get("requirements"), list) else [],
                "domains": [],
            }
            workflow_domains: list[str] = []
            raw_prompt_domains = wf.get("prompt_domains")
            if isinstance(raw_prompt_domains, list):
                for d in raw_prompt_domains:
                    text = str(d or "").strip()
                    if text and text not in workflow_domains:
                        workflow_domains.append(text)
            raw_prompt_domain = str(wf.get("prompt_domain") or "").strip()
            if raw_prompt_domain and raw_prompt_domain not in workflow_domains:
                workflow_domains.append(raw_prompt_domain)
            xhs_request_payload["domains"] = workflow_domains
            logger.info(
                "xhs_api_request trace_id=%s payload=%s",
                trace_id,
                json.dumps(xhs_request_payload, ensure_ascii=False),
            )
            search_text = await search_impl(
                topic=xhs_request_payload["topic"],
                page_size=xhs_request_payload["page_size"],
                sort=xhs_request_payload["sort"],
                city_name=xhs_request_payload["city_name"],
                requirements=xhs_request_payload["requirements"],
                domains=xhs_request_payload["domains"],
            )
            logger.info("xhs_api_raw_response trace_id=%s preview=%s", trace_id, search_text[:3000])
            search_payload = _resolve_xhs_output(search_text)
            logger.info(
                "xhs_api_resolved trace_id=%s payload=%s",
                trace_id,
                json.dumps(
                    {
                        "ok": search_payload.get("ok") if isinstance(search_payload, dict) else False,
                        "note_count": len(search_payload.get("notes", []))
                        if isinstance(search_payload, dict) and isinstance(search_payload.get("notes"), list)
                        else 0,
                        "keys": list(search_payload.keys())[:20] if isinstance(search_payload, dict) else [],
                    },
                    ensure_ascii=False,
                ),
            )
            if not isinstance(search_payload, dict) or search_payload.get("ok") is False:
                yield _sse("error", {"error": "热贴数据获取失败", "detail": search_payload})
                yield _sse("end", {"ok": False})
                return
            note_count = (
                len(search_payload.get("notes", []))
                if isinstance(search_payload.get("notes"), list)
                else 0
            )
            if note_count < 3:
                logger.warning(
                    "xhs_note_count_low trace_id=%s note_count=%s topic=%s",
                    trace_id,
                    note_count,
                    str(planned.get("topic") or ""),
                )
                yield _sse("error", {"error": f"热贴数量不足（{note_count}），请换关键词重试"})
                yield _sse("end", {"ok": False})
                return
            xhs_display_meta = _extract_xhs_references_and_meta(search_payload, planned)
            yield _sse(
                "stage",
                {
                    "name": "fetched",
                    "note_count": note_count,
                },
            )

            xhs_system = (
                custom_prompt if custom_prompt is not None else load_xiaohongshu_publish_prompt()
            )
            final_messages = [
                {"role": "system", "content": xhs_system},
                {
                    "role": "user",
                    "content": _build_xhs_generation_context(
                        user_input=_extract_last_user_message(working_messages),
                        planned=planned,
                        search_payload=search_payload,
                    ),
                },
            ]

        payload = {"model": model, "stream": True, "messages": final_messages}

        full_text_parts: list[str] = []
        yield _sse("connected", {"model": model})

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    DEEPSEEK_CHAT_URL,
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                    json=payload,
                ) as resp:
                    if not resp.is_success:
                        err = await resp.aread()
                        yield _sse("error", {"error": f"LLM 请求失败({resp.status_code})", "detail": err.decode('utf-8', 'ignore')[:500]})
                        yield _sse("end", {"ok": False})
                        return

                    async for line in resp.aiter_lines():
                        text = line.strip()
                        if not text.startswith("data:"):
                            continue
                        data = text[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        delta = (
                            event.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content", "")
                        )
                        if isinstance(delta, str) and delta:
                            full_text_parts.append(delta)
                            yield _sse("delta", {"content": delta})
        except Exception as exc:
            logger.exception("chat_stream_exception trace_id=%s error=%s", trace_id, exc)
            yield _sse("error", {"error": f"流式生成失败: {exc}"})
            yield _sse("end", {"ok": False})
            return

        final_text = "".join(full_text_parts)
        end_payload: dict[str, Any] = {"ok": True, "content": final_text}
        if (body.agent or "").strip() == "xiaohongshu":
            xhs_meta = xhs_display_meta or {"references": [], "search_meta": {"query_count": 0, "query_terms": []}}
            cover_result = generate_xhs_cover_image(
                topic=str(planned.get("topic") or "小红书封面"),
                content=final_text,
                workflow=wf,
            )
            end_payload = {
                "ok": True,
                "content": final_text,
                "references": xhs_meta.get("references") or [],
                "search_meta": xhs_meta.get("search_meta") or {"query_count": 0, "query_terms": []},
                "cover_image": cover_result,
            }
            logger.info(
                "xhs_generation_result trace_id=%s payload=%s",
                trace_id,
                json.dumps(
                    {
                        "length": len(final_text),
                        "preview": final_text[:600],
                        "references_count": len(end_payload.get("references", [])),
                        "cover_image_ok": bool((end_payload.get("cover_image") or {}).get("ok")),
                    },
                    ensure_ascii=False,
                ),
            )
        logger.info("chat_stream_end trace_id=%s ok=%s", trace_id, True)
        yield _sse("end", end_payload)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@chat_router.post("/conversations/resolve")
async def post_resolve_conversation(body: ResolveConversationRequest) -> dict[str, Any]:
    try:
        payload = resolve_conversation(
            user_id=body.user_id,
            agent=body.agent,
            force_new=body.force_new,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return payload


@chat_router.get("/conversations")
async def get_conversations(
    user_id: str = Query(..., min_length=1),
    agent: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    try:
        conversations = list_conversations(user_id=user_id, agent=agent, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"conversations": conversations}


@chat_router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str) -> dict[str, Any]:
    try:
        messages = fetch_messages(conversation_id=conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"messages": messages}


@chat_router.post("/conversations/{conversation_id}/messages")
async def post_conversation_messages(
    conversation_id: str,
    body: AppendConversationMessagesRequest,
) -> dict[str, Any]:
    try:
        inserted = append_messages(
            conversation_id=conversation_id,
            messages=[message.model_dump() for message in body.messages],
        )
    except ValueError as exc:
        text = str(exc)
        status_code = 404 if text == "conversation not found" else 400
        raise HTTPException(status_code=status_code, detail=text) from exc
    return {"ok": True, "inserted": inserted}


@chat_router.get("/prompt-library")
async def get_prompt_library(
    agent: str = Query(..., min_length=1),
    domain: str = Query(""),
    include_body: bool = Query(False),
) -> dict[str, Any]:
    try:
        return list_prompt_library(user_id="__global__", agent=agent, include_body=include_body, domain=domain)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@chat_router.post("/prompt-library/categories")
async def post_prompt_library_category(body: PromptCategoryCreate) -> dict[str, Any]:
    try:
        return create_category(
            user_id="__global__",
            agent=body.agent,
            name=body.name,
            sort_order=body.sort_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@chat_router.patch("/prompt-library/categories/{category_id}")
async def patch_prompt_library_category(category_id: str, body: PromptCategoryPatch) -> dict[str, Any]:
    try:
        return update_category(
            user_id="__global__",
            category_id=category_id,
            name=body.name,
            sort_order=body.sort_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@chat_router.delete("/prompt-library/categories/{category_id}")
async def delete_prompt_library_category(
    category_id: str,
) -> dict[str, Any]:
    try:
        delete_category(user_id="__global__", category_id=category_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@chat_router.post("/prompt-library/styles")
async def post_prompt_library_style(body: PromptStyleCreate) -> dict[str, Any]:
    try:
        return create_style(
            user_id="__global__",
            category_id=body.category_id,
            name=body.name,
            body=body.body,
            is_default=body.is_default,
            sort_order=body.sort_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@chat_router.patch("/prompt-library/styles/{style_id}")
async def patch_prompt_library_style(style_id: str, body: PromptStylePatch) -> dict[str, Any]:
    try:
        return update_style(
            user_id="__global__",
            style_id=style_id,
            name=body.name,
            body=body.body,
            is_default=body.is_default,
            sort_order=body.sort_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@chat_router.delete("/prompt-library/styles/{style_id}")
async def delete_prompt_library_style(
    style_id: str,
) -> dict[str, Any]:
    try:
        delete_style(user_id="__global__", style_id=style_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@chat_router.get("/creative-works")
async def get_creative_works_list() -> list[dict[str, Any]]:
    return list_creative_works()


def _fetch_cover_template_style(style_id: str) -> tuple[str, dict[str, str]]:
    sid = str(style_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="template_style_id 必填")
    domain = get_prompt_template_domain(agent="xiaohongshu", style_id=sid)
    if domain != COVER_TEMPLATE_DOMAIN:
        raise HTTPException(status_code=404, detail="封面模版不存在")
    body = fetch_style_body(user_id="__global__", agent="xiaohongshu", style_id=sid)
    if not body:
        raise HTTPException(status_code=404, detail="封面模版不存在")
    return body, parse_cover_template_body(body)


@chat_router.get("/image-cards/catalog")
async def get_image_cards_catalog() -> dict[str, Any]:
    ext = load_extend_config()
    return get_baoyu_image_cards_catalog(
        extend_summary={
            "style": ext.get("style"),
            "layout": ext.get("layout"),
            "palette": ext.get("palette"),
            "extendPath": ext.get("source_path"),
        }
    )


@chat_router.post("/cover/generate")
async def post_cover_generate(body: CoverGenerateRequest) -> dict[str, Any]:
    topic = str(body.topic or "").strip() or "小红书封面"
    title_main = str(body.title_main or "").strip() or topic[:24]
    title_sub = str(body.title_sub or "").strip()
    refs = [str(u).strip() for u in (body.reference_image_urls or []) if str(u).strip()]
    extra_prompt = ""
    template_id = str(body.template_style_id or "").strip()
    if template_id:
        tpl_body, template = _fetch_cover_template_style(template_id)
        extra_prompt = render_cover_prompt(
            template=template,
            topic=topic,
            title_main=title_main,
            title_sub=title_sub,
            reference_image_urls=[],
        )
        if not any([body.preset, body.style, body.layout]):
            body = body.model_copy(
                update={
                    "style": template.get("style") or body.style,
                    "layout": template.get("layout") or body.layout,
                    "palette": template.get("palette") or body.palette,
                }
            )
        _ = tpl_body
    preset = str(body.preset or "").strip() or None
    if not preset and not body.style and not template_id:
        preset = "clean-quote"
    result = generate_baoyu_cover(
        topic=topic,
        content=str(body.content or ""),
        title_main=title_main,
        title_sub=title_sub,
        work_id=str(body.work_id or "").strip() or None,
        preset=preset,
        style=str(body.style or "").strip() or None,
        layout=str(body.layout or "").strip() or None,
        palette=str(body.palette or "").strip() or None,
        reference_image_urls=refs,
        extra_prompt=extra_prompt,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=500,
            detail=str(result.get("error") or result.get("reason") or "封面生成失败"),
        )
    img_raw = str(result.get("image_path") or "").strip()
    if img_raw:
        img_path = Path(img_raw)
        if img_path.is_file():
            baoyu = result.get("baoyu") if isinstance(result.get("baoyu"), dict) else {}
            slug = str(baoyu.get("slug") or img_path.parent.name).strip()
            result = {
                **result,
                "image_path": promote_local_file_to_cover_storage(
                    img_path,
                    oss_relative=f"creative/{slug}/{img_path.name}",
                ),
            }
    return result


@chat_router.post("/quiz-card/question")
async def post_quiz_card_question(body: QuizQuestionRequest) -> dict[str, Any]:
    opts = [str(x).strip() for x in (body.options or []) if str(x).strip()]
    if not opts and str(body.options_text or "").strip():
        opts = parse_options_text(body.options_text)
    result = save_quiz_question_card(
        work_id=str(body.work_id or "").strip(),
        header=str(body.header or "").strip(),
        question=str(body.question or "").strip(),
        options=opts,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=str(result.get("error") or "题目卡生成失败"))
    return result


@chat_router.post("/quiz-card/answer")
async def post_quiz_card_answer(body: QuizAnswerRequest) -> dict[str, Any]:
    extras = [str(x).strip() for x in (body.extra_lines or []) if str(x).strip()]
    if not extras and str(body.extra_text or "").strip():
        extras = [ln.strip() for ln in str(body.extra_text).splitlines() if ln.strip()]
    result = save_quiz_answer_card(
        work_id=str(body.work_id or "").strip(),
        header=str(body.header or "").strip(),
        answer=str(body.answer or "").strip(),
        explanation=str(body.explanation or "").strip(),
        extra_title=str(body.extra_title or "").strip(),
        extra_lines=extras,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=str(result.get("error") or "答案卡生成失败"))
    return result


@chat_router.post("/cover/overlay")
async def post_cover_overlay(body: CoverOverlayRequest) -> dict[str, Any]:
    result = await overlay_cover_to_file(
        work_id=str(body.work_id or "").strip(),
        title_main=str(body.title_main or "").strip(),
        title_sub=str(body.title_sub or "").strip(),
        base_image_path=str(body.base_image_path or "").strip() or None,
        base_image_url=str(body.base_image_url or "").strip() or None,
    )
    if not result.get("ok"):
        raise HTTPException(
            status_code=400,
            detail=str(result.get("error") or "叠字封面失败"),
        )
    return result


@chat_router.post("/creative-works/{work_id}/cover/base/upload")
async def post_creative_work_cover_base_upload(work_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    wid = str(work_id or "").strip()
    if not wid:
        raise HTTPException(status_code=400, detail="work_id 无效")
    raw_name = str(file.filename or "").strip()
    ext = Path(raw_name).suffix.lower() if raw_name else ""
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
        ctype = str(file.content_type or "").lower()
        if "png" in ctype:
            ext = ".png"
        elif "jpeg" in ctype or "jpg" in ctype:
            ext = ".jpg"
        elif "webp" in ctype:
            ext = ".webp"
        elif "gif" in ctype:
            ext = ".gif"
        else:
            ext = ".png"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    ctype = str(file.content_type or "").strip() or _guess_image_content_type(f"base{ext}")
    try:
        stored = save_work_cover_bytes(wid, data, filename=f"base{ext}", content_type=ctype)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "base_image_path": stored}


@chat_router.post("/creative-works/{work_id}/cover/upload")
async def post_creative_work_cover_upload(work_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    wid = str(work_id or "").strip()
    if not wid:
        raise HTTPException(status_code=400, detail="work_id 无效")
    raw_name = str(file.filename or "").strip()
    ext = Path(raw_name).suffix.lower() if raw_name else ""
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
        ctype = str(file.content_type or "").lower()
        if "png" in ctype:
            ext = ".png"
        elif "jpeg" in ctype or "jpg" in ctype:
            ext = ".jpg"
        elif "webp" in ctype:
            ext = ".webp"
        elif "gif" in ctype:
            ext = ".gif"
        else:
            ext = ".png"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    ctype = str(file.content_type or "").strip() or _guess_image_content_type(f"cover{ext}")
    try:
        stored = save_work_cover_bytes(wid, data, filename=f"cover{ext}", content_type=ctype)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "image_path": stored}


@chat_router.post("/creative-works")
async def post_creative_work(body: CreativeWorkCreate) -> dict[str, Any]:
    try:
        return create_creative_work(
            work_id=body.id,
            title=str(body.title) if body.title is not None else "未命名作品",
            prompt=str(body.prompt) if body.prompt is not None else "",
            body=str(body.body) if body.body is not None else "",
            domain=str(body.domain) if body.domain is not None else "",
            status=str(body.status) if body.status is not None else "draft",
            platform=str(body.platform) if body.platform is not None else "xhs",
            cover_path=str(body.coverPath) if body.coverPath is not None else "",
            cover_source=str(body.coverSource) if body.coverSource is not None else "",
            cover_template_id=str(body.coverTemplateId) if body.coverTemplateId is not None else "",
            cover_ref_urls=body.coverRefUrls,
            cover_title_main=str(body.coverTitleMain) if body.coverTitleMain is not None else "",
            cover_title_sub=str(body.coverTitleSub) if body.coverTitleSub is not None else "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@chat_router.get("/creative-works/{work_id}")
async def get_creative_work_item(work_id: str) -> dict[str, Any]:
    row = get_creative_work(work_id)
    if row is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return row


@chat_router.patch("/creative-works/{work_id}")
async def patch_creative_work_item(work_id: str, body: CreativeWorkPatch) -> dict[str, Any]:
    payload = body.model_dump(exclude_unset=True)
    try:
        row = patch_creative_work(work_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return row


@chat_router.delete("/creative-works/{work_id}")
async def delete_creative_work_item(work_id: str) -> dict[str, Any]:
    if not delete_creative_work(work_id):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return {"ok": True}
