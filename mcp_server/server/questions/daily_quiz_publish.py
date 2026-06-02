"""每日一题导出发布：标记题库已用 + 写入创作中心作品。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..chat.creative_works_store import (
    create_creative_work,
    get_creative_work,
    patch_creative_work,
)
from .bank_store import mark_questions_used


def _default_title() -> str:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"每日一题 {day}"


def _build_body(slots: list[dict[str, Any]]) -> str:
    lines: list[str] = ["每日一题批量出图，共 {} 题。".format(len(slots)), ""]
    for i, slot in enumerate(slots, start=1):
        stem = str(slot.get("stem") or "").strip()
        qid = str(slot.get("questionId") or slot.get("question_id") or "").strip()
        q_path = str(slot.get("questionPath") or slot.get("question_path") or "").strip()
        a_path = str(slot.get("answerPath") or slot.get("answer_path") or "").strip()
        options = slot.get("options")
        if not isinstance(options, list):
            options = []
        answer = str(slot.get("answer") or "").strip()
        explanation = str(slot.get("explanation") or "").strip()
        lines.append(f"## 第 {i} 题")
        if qid:
            lines.append(f"question_id: {qid}")
        if stem:
            lines.append(stem)
        if options:
            lines.append("options: " + json.dumps([str(x) for x in options], ensure_ascii=False))
        if answer:
            lines.append(f"answer: {answer}")
        if explanation:
            lines.append(f"explanation: {explanation}")
        if q_path:
            lines.append(f"- 题目卡：{q_path}")
        if a_path:
            lines.append(f"- 答案卡：{a_path}")
        lines.append("")
    return "\n".join(lines).strip()


def publish_daily_quiz(
    *,
    work_id: str,
    slots: list[dict[str, Any]],
    title: str | None = None,
    category: str = "",
) -> dict[str, Any]:
    wid = str(work_id or "").strip()
    if not wid:
        raise ValueError("work_id 无效")
    if not slots:
        raise ValueError("至少包含一道题")

    question_ids = [
        str(s.get("questionId") or s.get("question_id") or "").strip() for s in slots
    ]
    mark_result = mark_questions_used(question_ids)

    ref_urls: list[str] = []
    for slot in slots:
        qp = str(slot.get("questionPath") or slot.get("question_path") or "").strip()
        ap = str(slot.get("answerPath") or slot.get("answer_path") or "").strip()
        if qp:
            ref_urls.append(qp)
        if ap:
            ref_urls.append(ap)

    cover_path = ref_urls[0] if ref_urls else ""
    if not cover_path:
        raise ValueError("缺少题目卡路径，无法保存作品")

    work_title = str(title or "").strip() or _default_title()
    domain = str(category or "").strip()
    body = _build_body(slots)
    prompt = "每日一题 · 题库召回批量出图"

    payload = {
        "title": work_title,
        "prompt": prompt,
        "body": body,
        "domain": domain,
        "status": "ready",
        "platform": "xhs",
        "coverPath": cover_path,
        "coverSource": "quiz",
        "coverRefUrls": ref_urls,
    }

    existing = get_creative_work(wid)
    if existing:
        work = patch_creative_work(wid, payload)
    else:
        work = create_creative_work(
            work_id=wid,
            title=work_title,
            prompt=prompt,
            body=body,
            domain=domain,
            status="ready",
            platform="xhs",
            cover_path=cover_path,
            cover_source="quiz",
            cover_ref_urls=ref_urls,
        )

    if not work:
        raise ValueError("保存创作中心作品失败")

    return {
        "ok": True,
        "work": work,
        "marked": mark_result.get("marked", 0),
        "markRequested": mark_result.get("requested", 0),
    }
