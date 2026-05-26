"""每日一题：水墨底图答题卡 / 答案解析卡（Pillow 排版，非 AI 生图）。"""

from __future__ import annotations

import io
import logging
import os
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from ..storage.cover_storage import save_work_cover_bytes
from .cover_overlay import TARGET_H, TARGET_W, _fit_cover, _load_font

logger = logging.getLogger("mcp_server.quiz_card")

COLOR_TEXT = (32, 32, 32)
MARGIN_X = 88
CONTENT_W = TARGET_W - MARGIN_X * 2
OPT_CONTENT_W = CONTENT_W - 32

# 1080×1440 出图，按手机全屏浏览放大字号
TITLE_Y = 168
TITLE_SIZE = 96
BODY_START_Y = 328

Q_FONT_SIZE = 58
Q_LINE_HEIGHT = 84
Q_OPT_GAP = 50
OPT_FONT_SIZE = 54
OPT_LINE_HEIGHT = 74
OPT_ITEM_GAP = 18

ANS_FONT_SIZE = 58
ANS_LINE_HEIGHT = 84
ANS_EXP_GAP = 56
EXP_FONT_SIZE = 56
EXP_LINE_HEIGHT = 78
EXP_LABEL_BODY_GAP = 18

_BG_TEMPLATE: Image.Image | None = None


def _quiz_bg_path() -> Path:
    configured = os.getenv("QUIZ_CARD_BG_PATH", "").strip()
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "assets" / "quiz" / "card_bg.png"


def _new_canvas() -> Image.Image:
    global _BG_TEMPLATE
    path = _quiz_bg_path()
    if not path.is_file():
        raise FileNotFoundError(f"答题卡背景图不存在: {path}")
    if _BG_TEMPLATE is None:
        with Image.open(path) as src:
            _BG_TEMPLATE = _fit_cover(src, TARGET_W, TARGET_H)
    return _BG_TEMPLATE.copy()


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


def _wrap_option_lines(
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
    *,
    base_x: int,
) -> tuple[list[str], int | None]:
    """选项换行：首行保留 A. 前缀，续行按前缀宽度缩进。"""
    raw = str(text or "").strip()
    if not raw:
        return [""], None
    m = re.match(r"^([A-Ha-h][.、．)\]]\s*)(.*)$", raw, re.DOTALL)
    if not m:
        return _wrap_lines(raw, font, max_width), None

    prefix = m.group(1)
    body = m.group(2).strip()
    prefix_w = int(font.getlength(prefix))
    body_max = max(max_width - prefix_w, max_width // 4)
    body_lines = _wrap_lines(body, font, body_max) if body else [""]

    out: list[str] = []
    for i, line in enumerate(body_lines):
        out.append(f"{prefix}{line}" if i == 0 else line)
    indent_x = base_x + prefix_w if len(body_lines) > 1 else None
    return out, indent_x


def _draw_lines_left(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    *,
    x: int,
    y: int,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int],
    line_height: int,
    indent_x: int | None = None,
) -> int:
    cy = y
    for i, line in enumerate(lines):
        if not line:
            cy += line_height // 2
            continue
        lx = indent_x if i > 0 and indent_x is not None else x
        draw.text((lx, cy), line, font=font, fill=fill, anchor="la")
        cy += line_height
    return cy


def _draw_title(draw: ImageDraw.ImageDraw, text: str, *, y: int = TITLE_Y) -> None:
    font = _load_font(TITLE_SIZE)
    draw.text((TARGET_W // 2, y), text, font=font, fill=COLOR_TEXT, anchor="mm")


def _normalize_options(raw: list[str]) -> list[str]:
    out: list[str] = []
    for item in raw:
        t = str(item or "").strip()
        if t:
            out.append(t)
    if not out:
        raise ValueError("至少提供一个选项")
    return out[:8]


def _format_answer_line(answer: str) -> str:
    ans = str(answer or "").strip()
    if not ans:
        return ""
    if ans.startswith("正确答案"):
        return ans.replace("正确答案:", "正确答案：")
    return f"正确答案：{ans}"


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

    canvas = _new_canvas()
    draw = ImageDraw.Draw(canvas)

    _draw_title(draw, hdr)

    q_font = _load_font(Q_FONT_SIZE)
    q_lines = _wrap_lines(q, q_font, CONTENT_W)
    y = _draw_lines_left(
        draw,
        q_lines,
        x=MARGIN_X,
        y=BODY_START_Y,
        font=q_font,
        fill=COLOR_TEXT,
        line_height=Q_LINE_HEIGHT,
    )

    opt_font = _load_font(OPT_FONT_SIZE)
    y += Q_OPT_GAP
    for opt in opts:
        opt_lines, indent_x = _wrap_option_lines(
            opt, opt_font, OPT_CONTENT_W, base_x=MARGIN_X,
        )
        y = _draw_lines_left(
            draw,
            opt_lines,
            x=MARGIN_X,
            y=y,
            font=opt_font,
            fill=COLOR_TEXT,
            line_height=OPT_LINE_HEIGHT,
            indent_x=indent_x,
        )
        y += OPT_ITEM_GAP

    return canvas


def render_quiz_answer_image(
    *,
    header: str,
    answer: str,
    explanation: str = "",
    extra_title: str = "古代知识拓展：",
    extra_lines: list[str] | None = None,
) -> Image.Image:
    ans = str(answer or "").strip()
    if not ans:
        raise ValueError("答案不能为空")

    page_title = str(header or "").strip() or "答案解析"
    if page_title in ("正确答案", "正确"):
        page_title = "答案解析"

    extras = [str(x).strip() for x in (extra_lines or []) if str(x).strip()]

    canvas = _new_canvas()
    draw = ImageDraw.Draw(canvas)

    _draw_title(draw, page_title)

    ans_font = _load_font(ANS_FONT_SIZE)
    ans_line = _format_answer_line(ans)
    y = BODY_START_Y
    ans_lines = _wrap_lines(ans_line, ans_font, CONTENT_W)
    y = _draw_lines_left(
        draw,
        ans_lines,
        x=MARGIN_X,
        y=y,
        font=ans_font,
        fill=COLOR_TEXT,
        line_height=ANS_LINE_HEIGHT,
    )
    y += ANS_EXP_GAP

    exp = str(explanation or "").strip()
    if exp:
        body_font = _load_font(EXP_FONT_SIZE)
        draw.text((MARGIN_X, y), "解析：", font=body_font, fill=COLOR_TEXT, anchor="la")
        y += EXP_FONT_SIZE + EXP_LABEL_BODY_GAP
        exp_lines = _wrap_lines(exp, body_font, CONTENT_W)
        y = _draw_lines_left(
            draw,
            exp_lines,
            x=MARGIN_X,
            y=y,
            font=body_font,
            fill=COLOR_TEXT,
            line_height=EXP_LINE_HEIGHT,
        )
        y += 24

    if extras or str(extra_title or "").strip():
        et = str(extra_title or "").strip() or "古代知识拓展："
        et_font = _load_font(46)
        draw.text((MARGIN_X, y + 8), et, font=et_font, fill=COLOR_TEXT, anchor="la")
        y += 60
        item_font = _load_font(44)
        row_h = 56
        col_w = (TARGET_W - MARGIN_X * 2) // 2
        for i, line in enumerate(extras):
            col = i % 2
            row = i // 2
            x = MARGIN_X + col * col_w
            yy = y + row * row_h
            draw.text((x, yy), line, font=item_font, fill=COLOR_TEXT, anchor="la")

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
