"""在已有底图上叠加标题文字，不重绘整张图。"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageFont

from ..storage.cover_storage import load_cover_image_pil, save_work_cover_bytes

logger = logging.getLogger("mcp_server.cover_overlay")

# 小红书竖版封面常用比例
TARGET_W = 1080
TARGET_H = 1440

_FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/msyh.ttc",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        p = Path(path)
        if not p.is_file():
            continue
        try:
            return ImageFont.truetype(str(p), size=size)
        except OSError:
            continue
    logger.warning("未找到中文字体，使用默认位图字体")
    return ImageFont.load_default()


def _draw_stroked_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    *,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    fill: tuple[int, int, int],
    stroke_fill: tuple[int, int, int],
    stroke_width: int,
    anchor: str = "mm",
) -> None:
    draw.text(
        xy,
        text,
        font=font,
        fill=fill,
        stroke_width=stroke_width,
        stroke_fill=stroke_fill,
        anchor=anchor,
    )


def _fit_cover(img: Image.Image, width: int, height: int) -> Image.Image:
    src = img.convert("RGB")
    sw, sh = src.size
    scale = max(width / sw, height / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - width) // 2
    top = (nh - height) // 2
    return resized.crop((left, top, left + width, top + height))


async def fetch_image_bytes(url: str, timeout: float = 30.0) -> bytes:
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        res = await client.get(url)
        res.raise_for_status()
        return res.content


def load_image_from_bytes(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def render_xhs_travel_overlay(
    base: Image.Image,
    *,
    title_main: str,
    title_sub: str = "",
) -> Image.Image:
    canvas = _fit_cover(base, TARGET_W, TARGET_H)
    draw = ImageDraw.Draw(canvas)

    main = str(title_main or "").strip()
    sub = str(title_sub or "").strip()

    if sub:
        sub_font = _load_font(42)
        _draw_stroked_text(
            draw,
            (TARGET_W // 2, int(TARGET_H * 0.08)),
            sub if sub.startswith("@") else f"@{sub.lstrip('@')}",
            font=sub_font,
            fill=(255, 220, 0),
            stroke_fill=(0, 0, 0),
            stroke_width=3,
            anchor="mm",
        )

    if main:
        size = 96 if len(main) <= 6 else 72 if len(main) <= 10 else 56
        main_font = _load_font(size)
        _draw_stroked_text(
            draw,
            (TARGET_W // 2, int(TARGET_H * 0.42)),
            main,
            font=main_font,
            fill=(255, 255, 255),
            stroke_fill=(0, 0, 0),
            stroke_width=6,
            anchor="mm",
        )

    return canvas


async def overlay_cover_to_file(
    *,
    work_id: str,
    title_main: str,
    title_sub: str = "",
    base_image_path: str | None = None,
    base_image_url: str | None = None,
) -> dict[str, Any]:
    wid = str(work_id or "").strip()
    if not wid:
        return {"ok": False, "error": "work_id 无效"}

    main = str(title_main or "").strip()
    if not main:
        return {"ok": False, "error": "主标题不能为空"}

    path_raw = str(base_image_path or "").strip()
    url_raw = str(base_image_url or "").strip()
    if not path_raw and not url_raw:
        return {"ok": False, "error": "请提供底图（上传路径或配图 URL）"}

    try:
        if path_raw:
            base = load_cover_image_pil(path_raw)
        else:
            data = await fetch_image_bytes(url_raw)
            base = load_image_from_bytes(data)
    except Exception as exc:
        logger.exception("加载底图失败")
        return {"ok": False, "error": f"加载底图失败: {exc}"}

    try:
        rendered = render_xhs_travel_overlay(
            base,
            title_main=main,
            title_sub=str(title_sub or "").strip(),
        )
        buf = io.BytesIO()
        rendered.save(buf, format="PNG", optimize=True)
        stored = save_work_cover_bytes(wid, buf.getvalue(), filename="cover.png", content_type="image/png")
    except Exception as exc:
        logger.exception("叠字导出失败")
        return {"ok": False, "error": f"叠字失败: {exc}"}

    return {
        "ok": True,
        "image_path": stored,
        "cover_source": "overlay",
        "width": TARGET_W,
        "height": TARGET_H,
    }
