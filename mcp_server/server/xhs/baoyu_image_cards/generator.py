from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from ..xhs_cover_image import generate_xhs_cover_image, topic_slug
from .assembler import assemble_cover_prompt
from .catalog import resolve_dimensions
from .extend_config import load_extend_config
from .paths import IMAGE_CARDS_ROOT


def generate_baoyu_cover(
    *,
    topic: str,
    content: str = "",
    title_main: str = "",
    title_sub: str = "",
    work_id: str | None = None,
    preset: str | None = None,
    style: str | None = None,
    layout: str | None = None,
    palette: str | None = None,
    reference_image_urls: list[str] | None = None,
    extra_prompt: str = "",
) -> dict[str, Any]:
    ext = load_extend_config()
    dims = resolve_dimensions(
        preset=preset,
        style=style,
        layout=layout,
        palette=palette,
        extend_defaults={
            "style": str(ext.get("style") or "notion"),
            "layout": str(ext.get("layout") or "sparse"),
            "palette": str(ext.get("palette") or "") or None,
        },
    )
    st = str(dims["style"])
    la = str(dims["layout"])
    pa = dims.get("palette")
    pa_str = str(pa) if pa else ""

    topic_clean = str(topic or "").strip() or "小红书封面"
    tm = str(title_main or "").strip() or topic_clean[:24]
    ts = str(title_sub or "").strip()
    excerpt = str(content or "").strip()[:1200]

    wid = str(work_id or "").strip()
    slug = f"creative-{wid}" if wid else topic_slug(topic_clean)

    watermark = None
    if ext.get("watermark_enabled"):
        watermark = {
            "enabled": True,
            "content": str(ext.get("watermark_content") or ""),
            "position": str(ext.get("watermark_position") or "bottom-right"),
        }

    assembled = assemble_cover_prompt(
        style=st,
        layout=la,
        palette=str(pa) if pa else None,
        title_main=tm,
        title_sub=ts,
        topic=topic_clean,
        body_excerpt=excerpt,
        reference_image_urls=reference_image_urls,
        watermark=watermark,
        extra_prompt=extra_prompt,
    )

    base_dir = IMAGE_CARDS_ROOT / slug
    prompt_dir = base_dir / "prompts"
    prompt_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = prompt_dir / f"01-cover-{slug}.md"
    if prompt_path.exists():
        ts_name = datetime.now().strftime("%Y%m%d-%H%M%S")
        prompt_path.rename(prompt_dir / f"01-cover-{slug}-backup-{ts_name}.md")

    frontmatter = (
        f"---\nstyle: {st}\nlayout: {la}\npalette: {pa_str or 'default'}\n"
        f"preset: {dims.get('preset') or ''}\nposition: Cover\n---\n\n"
    )
    prompt_path.write_text(frontmatter + assembled, encoding="utf-8")

    workflow = {
        "generate_cover_image": True,
        "cover": {
            "style": st,
            "layout": la,
            "palette": pa_str or "macaron",
            "title_main": tm,
            "title_sub": ts,
            "slug": slug,
        },
    }
    result = generate_xhs_cover_image(
        topic=topic_clean,
        content=excerpt,
        workflow=workflow,
        force_generate=True,
        prompt_override=assembled,
        slug_override=slug,
    )
    return {
        **result,
        "baoyu": {
            "preset": dims.get("preset"),
            "style": st,
            "layout": la,
            "palette": pa,
            "slug": slug,
            "assembled_prompt_path": str(prompt_path),
        },
    }
