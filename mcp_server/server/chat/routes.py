import asyncio
import json
import logging
import os
from typing import Any
from uuid import uuid4
import httpx
from fastapi import APIRouter
from fastapi import HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field 

from ..constants import (
    CASES_SYSTEM_PROMPT,
    DEEPSEEK_CHAT_URL,
    DEFAULT_SYSTEM_PROMPT,
    load_xiaohongshu_publish_prompt,
    SENTENCE_ANALYSIS_PROMPT,
)
from ..xhs.xhs_search import search_xhs_keyword_and_poll_details as search_impl
from .memory_store import (
    append_messages,
    fetch_messages,
    list_conversations,
    resolve_conversation,
)
from .prompt_library_store import (
    create_category,
    create_style,
    delete_category,
    delete_style,
    fetch_style_body,
    list_prompt_library,
    update_category,
    update_style,
)

chat_router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("mcp_server.chat")

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


def _fallback_plan_xiaohongshu_params(messages: list[dict[str, Any]]) -> dict[str, Any]:
    user_input = _extract_last_user_message(messages)
    if not user_input:
        return {"ok": False, "error": "兜底参数提取失败：缺少用户输入"}
    topic = user_input.splitlines()[0].strip()[:32] or "小红书选题"
    return {
        "ok": True,
        "topic": topic,
        "requirements": [],
        "page_size": 15,
        "fallback": True,
    }


async def _plan_xiaohongshu_params(
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    chat_input = _extract_last_user_message(messages)
    if not chat_input:
        return {"ok": False, "error": "无法解析用户输入"}

    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": SENTENCE_ANALYSIS_PROMPT},
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
    return {
        "ok": True,
        "topic": topic,
        "requirements": requirements,
        "page_size": page_size,
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
            planned = await _plan_xiaohongshu_params(api_key=api_key, model=model, messages=working_messages)
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
                        "requirements": planned.get("requirements"),
                        "page_size": planned.get("page_size"),
                    },
                    ensure_ascii=False,
                ),
            )
            yield _sse("stage", {"name": "planned", "params": planned})

            xhs_request_payload = {
                "topic": str(planned.get("topic") or ""),
                "page_size": int(planned.get("page_size") or 15),
                "sort": "general",
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
            end_payload = {
                "ok": True,
                "content": final_text,
                "references": xhs_meta.get("references") or [],
                "search_meta": xhs_meta.get("search_meta") or {"query_count": 0, "query_terms": []},
            }
            logger.info(
                "xhs_generation_result trace_id=%s payload=%s",
                trace_id,
                json.dumps(
                    {
                        "length": len(final_text),
                        "preview": final_text[:600],
                        "references_count": len(end_payload.get("references", [])),
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
