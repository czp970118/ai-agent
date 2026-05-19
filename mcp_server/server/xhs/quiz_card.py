"""每日一题：黄底答题卡 / 答案卡（Pillow 排版，非 AI 生图）。"""

from __future__ import annotations

import io
import logging
import re
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from ..storage.cover_storage import save_work_cover_bytes
from .cover_overlay import TARGET_H, TARGET_W, _draw_stroked_text, _load_font

logger = logging.getLogger("mcp_server.quiz_card")

COLOR_BG = (255, 206, 0)
COLOR_GREEN = (0, 153, 0)
COLOR_BLACK = (0, 0, 0)

CONTENT_W = 920
OPTION_X = 140


def _wrap_lines(text: str, font: ImageFont.FreeTypeFont | ImageFont.ImageFont, max_width: int) -> list[str]:
    lines: list[str] = []
    for para in str(text or "").split("\n"):
        p = para.strip()
        if not p:
            continue
        line = ""
        for ch in p:
            trial = line + ch
            if line and font.getlength(trial) > max_width:
                lines.append(line)
                line = ch
            else:
                line = trial
        if line:
            lines.append(line)
    return lines or [""]


def _draw_lines(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    *,
    x: int,
    y: int,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int],
    line_height: int,
    anchor: str = "ma",
) -> int:
    cy = y
    for line in lines:
        if not line:
            cy += line_height // 2
            continue
        draw.text((x, cy), line, font=font, fill=fill, anchor=anchor)
        cy += line_height
    return cy


def _normalize_options(raw: list[str]) -> list[str]:
    out: list[str] = []
    for item in raw:
        t = str(item or "").strip()
        if t:
            out.append(t)
    if not out:
        raise ValueError("至少提供一个选项")
    return out[:8]


def render_quiz_question_image(
    *,
    header: str,
    question: str,
    options: list[str],
) -> Image.Image:
    hdr = str(header or "").strip() or "公基常识"
    q = str(question or "").strip()
    if not q:
        raise ValueError("题目不能为空")
    opts = _normalize_options(options)

    canvas = Image.new("RGB", (TARGET_W, TARGET_H), COLOR_BG)
    draw = ImageDraw.Draw(canvas)

    title_font = _load_font(76)
    _draw_stroked_text(
        draw,
        (TARGET_W // 2, 100),
        hdr,
        font=title_font,
        fill=COLOR_GREEN,
        stroke_fill=COLOR_BLACK,
        stroke_width=5,
        anchor="mm",
    )

    q_font = _load_font(44)
    q_lines = _wrap_lines(q, q_font, CONTENT_W)
    y = 240
    y = _draw_lines(
        draw,
        q_lines,
        x=TARGET_W // 2,
        y=y,
        font=q_font,
        fill=COLOR_BLACK,
        line_height=58,
        anchor="ma",
    )

    opt_font = _load_font(40)
    y = max(y + 48, 520)
    gap = max(56, (TARGET_H - y - 80) // max(len(opts), 1))
    for opt in opts:
        draw.text((OPTION_X, y), opt, font=opt_font, fill=COLOR_BLACK, anchor="la")
        y += gap

    return canvas


def render_quiz_answer_image(
    *,
    header: str,
    answer: str,
    explanation: str = "",
    extra_title: str = "古代知识拓展：",
    extra_lines: list[str] | None = None,
) -> Image.Image:
    hdr = str(header or "").strip() or "正确答案"
    ans = str(answer or "").strip()
    if not ans:
        raise ValueError("答案不能为空")

    extras = [str(x).strip() for x in (extra_lines or []) if str(x).strip()]

    canvas = Image.new("RGB", (TARGET_W, TARGET_H), COLOR_BG)
    draw = ImageDraw.Draw(canvas)

    title_font = _load_font(76)
    _draw_stroked_text(
        draw,
        (TARGET_W // 2, 100),
        hdr,
        font=title_font,
        fill=COLOR_GREEN,
        stroke_fill=COLOR_BLACK,
        stroke_width=5,
        anchor="mm",
    )

    ans_font = _load_font(52)
    draw.text((TARGET_W // 2, 220), ans, font=ans_font, fill=COLOR_BLACK, anchor="mm")

    y = 310
    exp = str(explanation or "").strip()
    if exp:
        exp_font = _load_font(36)
        exp_lines = _wrap_lines(exp, exp_font, CONTENT_W)
        y = _draw_lines(
            draw,
            exp_lines,
            x=TARGET_W // 2,
            y=y,
            font=exp_font,
            fill=COLOR_BLACK,
            line_height=50,
            anchor="ma",
        )
        y += 24

    if extras or str(extra_title or "").strip():
        et = str(extra_title or "").strip() or "古代知识拓展："
        et_font = _load_font(38)
        draw.text((OPTION_X, y + 10), et, font=et_font, fill=COLOR_BLACK, anchor="la")
        y += 56
        item_font = _load_font(32)
        row_h = 44
        col_w = (TARGET_W - OPTION_X * 2) // 2
        for i, line in enumerate(extras):
            col = i % 2
            row = i // 2
            x = OPTION_X + col * col_w
            yy = y + row * row_h
            draw.text((x, yy), line, font=item_font, fill=COLOR_BLACK, anchor="la")

    return canvas


def _image_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def save_quiz_question_card(
    *,
    work_id: str,
    header: str,
    question: str,
    options: list[str],
) -> dict[str, Any]:
    wid = str(work_id or "").strip()
    if not wid:
        return {"ok": False, "error": "work_id 无效"}
    try:
        img = render_quiz_question_image(header=header, question=question, options=options)
        stored = save_work_cover_bytes(
            wid,
            _image_to_png_bytes(img),
            filename="quiz-question.png",
            content_type="image/png",
        )
    except Exception as exc:
        logger.exception("题目卡生成失败")
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "image_path": stored, "kind": "question", "cover_source": "quiz"}


def save_quiz_answer_card(
    *,
    work_id: str,
    header: str,
    answer: str,
    explanation: str = "",
    extra_title: str = "古代知识拓展：",
    extra_lines: list[str] | None = None,
) -> dict[str, Any]:
    wid = str(work_id or "").strip()
    if not wid:
        return {"ok": False, "error": "work_id 无效"}
    try:
        img = render_quiz_answer_image(
            header=header,
            answer=answer,
            explanation=explanation,
            extra_title=extra_title,
            extra_lines=extra_lines,
        )
        stored = save_work_cover_bytes(
            wid,
            _image_to_png_bytes(img),
            filename="quiz-answer.png",
            content_type="image/png",
        )
    except Exception as exc:
        logger.exception("答案卡生成失败")
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "image_path": stored, "kind": "answer", "cover_source": "quiz"}


def parse_options_text(text: str) -> list[str]:
    """将多行文本解析为选项列表，自动补 A. B. 前缀。"""
    lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
    if not lines:
        return []
    out: list[str] = []
    labels = "ABCDEFGH"
    for i, ln in enumerate(lines):
        if re.match(r"^[A-Ha-h][.、．)\]]\s*", ln):
            out.append(ln)
        else:
            label = labels[i] if i < len(labels) else f"{i + 1}."
            out.append(f"{label}. {ln}")
    return out
