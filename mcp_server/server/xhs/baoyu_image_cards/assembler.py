from __future__ import annotations

from typing import Any

from .refs import load_layout_section, load_palette_section, load_style_section

_BASE = """Create a Xiaohongshu (Little Red Book) style infographic following these guidelines:

## Image Specifications

- **Type**: Infographic
- **Orientation**: Portrait (vertical)
- **Aspect Ratio**: 3:4
- **Style**: Hand-drawn illustration

## Core Principles

- Hand-drawn quality throughout - NO realistic or photographic elements
- If content involves sensitive or copyrighted figures, create stylistically similar alternatives
- Keep information concise, highlight keywords and core concepts
- Use ample whitespace for easy visual scanning
- Maintain clear visual hierarchy

## Text Style (CRITICAL)

- **ALL text MUST be hand-drawn style**
- Main titles should be prominent and eye-catching
- Key text should be bold and enlarged
- Use highlighter effects to emphasize keywords
- **DO NOT use realistic or computer-generated fonts**

## Language

- Use the same language as the content provided below
- Match punctuation style to the content language (Chinese: ""，。！)
"""


def assemble_cover_prompt(
    *,
    style: str,
    layout: str,
    palette: str | None,
    title_main: str,
    title_sub: str,
    topic: str,
    body_excerpt: str = "",
    reference_image_urls: list[str] | None = None,
    watermark: dict[str, Any] | None = None,
    extra_prompt: str = "",
) -> str:
    sections = [_BASE.strip(), "---", load_style_section(style), "---", load_layout_section(layout)]
    if palette:
        sections.extend(["---", load_palette_section(palette)])
    sections.extend(
        [
            "---",
            _content_section(
                title_main=title_main,
                title_sub=title_sub,
                topic=topic,
                body_excerpt=body_excerpt,
            ),
        ]
    )
    refs = [str(u).strip() for u in (reference_image_urls or []) if str(u).strip()]
    if refs:
        sections.append("---\n## Reference Images\n")
        for idx, url in enumerate(refs[:12], start=1):
            sections.append(f"- Reference {idx}: {url}")
        sections.append(
            "\nUse references for composition, mood, and color — do not copy text verbatim."
        )
    wm = watermark or {}
    if wm.get("enabled") and str(wm.get("content") or "").strip():
        pos = str(wm.get("position") or "bottom-right")
        content = str(wm["content"]).strip()
        sections.extend(
            [
                "---",
                "## Watermark\n",
                f'Include a subtle watermark "{content}" positioned at {pos}. '
                "Legible but not distracting.",
            ]
        )
    if str(extra_prompt or "").strip():
        sections.extend(["---", "## Additional Instructions\n", extra_prompt.strip()])
    sections.append(
        "\n---\n\nGenerate the infographic as a high-quality raster image per the specifications above."
    )
    return "\n".join(sections)


def _content_section(*, title_main: str, title_sub: str, topic: str, body_excerpt: str) -> str:
    points: list[str] = []
    if body_excerpt.strip():
        for line in body_excerpt.strip().splitlines()[:6]:
            t = line.strip()
            if t and len(t) < 80:
                points.append(t)
    text_block = [
        f"- Title: 「{title_main}」",
    ]
    if title_sub:
        text_block.append(f"- Subtitle: {title_sub}")
    if points:
        text_block.append("- Points:")
        text_block.extend([f"  - {p}" for p in points[:5]])
    return (
        "## Content\n\n"
        "**Position**: Cover (Page 1)\n"
        f"**Core Message**: {topic}\n\n"
        "**Text Content**:\n"
        + "\n".join(text_block)
        + "\n\n"
        "**Visual Concept**:\n"
        "Strong cover hook, clear title hierarchy, scroll-stopping thumbnail for mobile feed."
    )
