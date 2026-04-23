import asyncio
import json
import logging
import os
from typing import Any
import httpx
from fastapi import APIRouter
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


def _sse(event: str, data: Any) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def _resolve_system_prompt(agent: str | None, preprocess: dict[str, Any]) -> str:
    custom_prompt = preprocess.get("system_prompt")
    if isinstance(custom_prompt, str) and custom_prompt.strip():
        return custom_prompt.strip()
    if isinstance(agent, str) and agent.strip():
        return AGENT_SYSTEM_PROMPTS.get(agent.strip(), DEFAULT_SYSTEM_PROMPT)
    return DEFAULT_SYSTEM_PROMPT


async def _call_optional_webhook(url: str | None, payload: dict[str, Any], timeout_sec: float = 8.0) -> dict[str, Any]:
    if not url:
        return {}
    try:
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            resp = await client.post(url, json=payload)
            if not resp.is_success:
                return {"ok": False, "error": f"webhook status={resp.status_code}", "raw": resp.text}
            data = resp.json()
            if isinstance(data, dict):
                return data
            return {"ok": True, "value": data}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


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
                    "title": row.get("title"),
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
        "请基于这些输入生成最终可发布的小红书内容。"
    )


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

    preprocess_url = os.getenv("N8N_PREPROCESS_WEBHOOK_URL", "").strip() or None
    postprocess_url = os.getenv("N8N_POSTPROCESS_WEBHOOK_URL", "").strip() or None
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    async def event_stream():
        preprocess = await _call_optional_webhook(
            preprocess_url,
            {"agent": body.agent, "messages": [m.model_dump() for m in body.messages], "workflow": body.workflow},
        )
        user_prefix = preprocess.get("user_prompt_prefix", "")
        working_messages = [m.model_dump() for m in body.messages]
        if isinstance(user_prefix, str) and user_prefix.strip():
            for idx in range(len(working_messages) - 1, -1, -1):
                if working_messages[idx].get("role") == "user":
                    working_messages[idx]["content"] = f"{user_prefix.strip()}\n\n{working_messages[idx].get('content', '')}"
                    break
        system_prompt = _resolve_system_prompt(body.agent, preprocess)
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
                "xhs_plan_params=%s",
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
            }
            logger.info(
                "xhs_api_request=%s",
                json.dumps(xhs_request_payload, ensure_ascii=False),
            )
            search_text = await search_impl(
                topic=xhs_request_payload["topic"],
                page_size=xhs_request_payload["page_size"],
                sort=xhs_request_payload["sort"],
                requirements=xhs_request_payload["requirements"],
            )
            logger.info("xhs_api_raw_response=%s", search_text[:3000])
            search_payload = _resolve_xhs_output(search_text)
            logger.info(
                "xhs_api_resolved=%s",
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
            yield _sse(
                "stage",
                {
                    "name": "fetched",
                    "note_count": len(search_payload.get("notes", []))
                    if isinstance(search_payload.get("notes"), list)
                    else 0,
                },
            )

            final_messages = [
                {"role": "system", "content": load_xiaohongshu_publish_prompt()},
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
        yield _sse("connected", {"model": model, "preprocess_ok": preprocess.get("ok", True)})

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
            yield _sse("error", {"error": f"流式生成失败: {exc}"})
            yield _sse("end", {"ok": False})
            return

        final_text = "".join(full_text_parts)
        if (body.agent or "").strip() == "xiaohongshu":
            logger.info(
                "xhs_generation_result=%s",
                json.dumps(
                    {
                        "length": len(final_text),
                        "preview": final_text[:600],
                    },
                    ensure_ascii=False,
                ),
            )
        yield _sse("end", {"ok": True, "content": final_text})

        if postprocess_url:
            asyncio.create_task(
                _call_optional_webhook(
                    postprocess_url,
                    {
                        "agent": body.agent,
                        "workflow": body.workflow,
                        "messages": [m.model_dump() for m in body.messages],
                        "final_content": final_text,
                    },
                )
            )

    return StreamingResponse(event_stream(), media_type="text/event-stream")
