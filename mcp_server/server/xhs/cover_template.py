"""封面模版：提示词库 domain=封面模版，content 为 JSON 或纯文本 prompt。"""

from __future__ import annotations

import json
from typing import Any

COVER_TEMPLATE_DOMAIN = "封面模版"
DEFAULT_STYLE = "notion"
DEFAULT_LAYOUT = "sparse"
DEFAULT_PALETTE = "macaron"


def parse_cover_template_body(body: str) -> dict[str, str]:
    text = str(body or "").strip()
    out: dict[str, str] = {
        "style": DEFAULT_STYLE,
        "layout": DEFAULT_LAYOUT,
        "palette": DEFAULT_PALETTE,
        "prompt_template": "",
    }
    if not text:
        return out
    if text.startswith("{"):
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            out["prompt_template"] = text
            return out
        if isinstance(raw, dict):
            for key in ("style", "layout", "palette", "prompt_template"):
                val = raw.get(key)
                if isinstance(val, str) and val.strip():
                    out[key] = val.strip()
            return out
    out["prompt_template"] = text
    return out


def render_cover_prompt(
    *,
    template: dict[str, str],
    topic: str,
    title_main: str,
    title_sub: str,
    reference_image_urls: list[str] | None = None,
) -> str:
    custom = str(template.get("prompt_template") or "").strip()
    style = str(template.get("style") or DEFAULT_STYLE)
    layout = str(template.get("layout") or DEFAULT_LAYOUT)
    palette = str(template.get("palette") or DEFAULT_PALETTE)
    refs = [str(u).strip() for u in (reference_image_urls or []) if str(u).strip()]

    if custom:
        prompt = (
            custom.replace("{topic}", topic)
            .replace("{title_main}", title_main)
            .replace("{title_sub}", title_sub)
            .replace("{style}", style)
            .replace("{layout}", layout)
            .replace("{palette}", palette)
        )
    else:
        prompt = (
            "请生成一张小红书竖版封面图。\n"
            f"- 主题：{topic}\n"
            f"- 风格：{style}\n"
            f"- 布局：{layout}\n"
            f"- 配色：{palette}\n"
            f"- 主标题：{title_main}\n"
            f"- 副标题：{title_sub}\n"
            "- 视觉：干净、信息明确、大留白，手机端一眼读懂。\n"
            "- 避免：人物写实脸、复杂背景、文字过多。\n"
        )
    if refs:
        prompt += "\n\n参考素材图（构图/场景/色调，勿照搬文字）：\n"
        for idx, url in enumerate(refs[:12], start=1):
            prompt += f"- 参考图{idx}：{url}\n"
    return prompt
