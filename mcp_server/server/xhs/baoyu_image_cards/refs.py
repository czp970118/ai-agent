from __future__ import annotations

import re
from pathlib import Path

from .paths import VENDOR_REFS

_STYLE_FALLBACK: dict[str, str] = {
    "notion": (
        "**Color Palette**:\n- Primary: Black #1A1A1A, dark gray #4A4A4A\n"
        "- Background: Pure white #FFFFFF, off-white #FAFAFA\n"
        "- Accents: Pastel blue #A8D4F0, yellow #F9E79F, pink #FADBD8\n\n"
        "**Visual Elements**:\n- Simple line doodles, hand-drawn wobble\n"
        "- Geometric shapes, maximum whitespace\n\n"
        "**Typography**:\n- Clean hand-drawn lettering, minimal decoration"
    ),
    "cute": (
        "**Color Palette**: Soft pink, cream, pastel accents\n"
        "**Visual Elements**: Rounded shapes, cute doodles, stickers\n"
        "**Typography**: Bubbly hand-drawn titles"
    ),
    "fresh": (
        "**Color Palette**: Light greens, sky blue, white space\n"
        "**Visual Elements**: Natural motifs, airy composition\n"
        "**Typography**: Light friendly hand lettering"
    ),
    "minimal": (
        "**Color Palette**: Black/white with one accent\n"
        "**Visual Elements**: Extreme whitespace, single focal point\n"
        "**Typography**: Bold minimal sans hand-drawn"
    ),
    "pop": (
        "**Color Palette**: High saturation primaries\n"
        "**Visual Elements**: Dynamic shapes, stickers, burst lines\n"
        "**Typography**: Chunky bold display lettering"
    ),
    "warm": (
        "**Color Palette**: Peach, terracotta, golden tones\n"
        "**Visual Elements**: Cozy scenes, soft textures\n"
        "**Typography**: Friendly rounded handwriting"
    ),
    "bold": (
        "**Color Palette**: Strong contrast, warning colors\n"
        "**Visual Elements**: Big icons, thick outlines\n"
        "**Typography**: Heavy bold titles"
    ),
    "chalkboard": (
        "**Color Palette**: Dark board + colorful chalk\n"
        "**Visual Elements**: Chalk texture, educational icons\n"
        "**Typography**: Chalk-style lettering"
    ),
    "study-notes": (
        "**Color Palette**: Notebook paper, blue pen, red mark, yellow highlight\n"
        "**Visual Elements**: Realistic note photo style\n"
        "**Typography**: Handwritten study notes"
    ),
    "sketch-notes": (
        "**Color Palette**: Warm cream #F5F0E8, macaron zones\n"
        "**Visual Elements**: Wobble lines, hand-drawn infographic\n"
        "**Typography**: Casual marker labels"
    ),
    "screen-print": (
        "**Color Palette**: 2-5 flat colors, duotone pairs\n"
        "**Visual Elements**: Silkscreen poster, halftone, symbolic shapes\n"
        "**Typography**: Bold condensed stencil-like type"
    ),
    "retro": (
        "**Color Palette**: Muted vintage tones\n"
        "**Visual Elements**: Grain, retro patterns\n"
        "**Typography**: Retro display lettering"
    ),
}

_LAYOUT_SPECS: dict[str, str] = {
    "sparse": (
        "**Information Density**: Low (1-2 points)\n"
        "**Whitespace**: 60-70%\n"
        "**Structure**: Single hero title + one hook line; cover-first impact"
    ),
    "balanced": (
        "**Information Density**: Medium (3-4 points)\n"
        "**Whitespace**: 40-50%\n"
        "**Structure**: Title + subtitle + a few bullet highlights"
    ),
    "dense": (
        "**Information Density**: High (5-8 points)\n"
        "**Whitespace**: 20-30%\n"
        "**Structure**: Title + multiple sections with headers"
    ),
    "list": "**Information Density**: List (4-7 items)\n**Structure**: Numbered or bulleted list layout",
    "comparison": "**Structure**: Side-by-side contrast blocks",
    "flow": "**Structure**: 3-6 step process with arrows",
    "mindmap": "**Structure**: Central topic with radial branches",
    "quadrant": "**Structure**: Four-quadrant grid",
}

_PALETTE_SPECS: dict[str, str] = {
    "macaron": (
        "**Background**: Warm cream #F5F0E8\n"
        "**Colors**: Blue #A8D8EA, Lavender #D5C6E0, Mint #B5E5CF, Peach #F8D5C4\n"
        "**Accent**: Coral #E8655A\n"
        "**Constraint**: Soft educational feel"
    ),
    "warm": (
        "**Background**: Soft peach #FFECD2\n"
        "**Colors**: Orange #ED8936, Terracotta #C05621, Golden #F6AD55\n"
        "**Accent**: Sienna #A0522D"
    ),
    "neon": (
        "**Background**: Dark purple #1A1025\n"
        "**Colors**: Cyan #00F5FF, Magenta #FF00FF, Green #39FF14\n"
        "**Accent**: Yellow #FFFF00"
    ),
}


def load_style_section(style: str) -> str:
    path = VENDOR_REFS / "presets" / f"{style}.md"
    if path.is_file():
        body = _strip_frontmatter(path.read_text(encoding="utf-8"))
        chunk = _extract_md_section(body, "Visual Elements")
        colors = _extract_md_section(body, "Color Palette")
        typo = _extract_md_section(body, "Typography")
        if colors or chunk or typo:
            parts = [f"## Style: {style}\n"]
            if colors:
                parts.append(colors)
            if chunk:
                parts.append(chunk)
            if typo:
                parts.append(typo)
            return "\n\n".join(parts)
    fb = _STYLE_FALLBACK.get(style) or _STYLE_FALLBACK["notion"]
    return f"## Style: {style}\n\n{fb}"


def load_palette_section(palette: str) -> str:
    path = VENDOR_REFS / "palettes" / f"{palette}.md"
    if path.is_file():
        body = _strip_frontmatter(path.read_text(encoding="utf-8"))
        return f"## Palette Override: {palette}\n\n{body.strip()}"
    spec = _PALETTE_SPECS.get(palette, "")
    return f"## Palette Override: {palette}\n\n{spec}"


def load_layout_section(layout: str) -> str:
    spec = _LAYOUT_SPECS.get(layout, _LAYOUT_SPECS["sparse"])
    return f"## Layout: {layout}\n\n{spec}"


def _strip_frontmatter(text: str) -> str:
    t = text.strip()
    if t.startswith("---"):
        parts = t.split("---", 2)
        if len(parts) >= 3:
            return parts[2].strip()
    return t


def _extract_md_section(body: str, heading: str) -> str:
    pattern = rf"##\s*{re.escape(heading)}\s*\n(.*?)(?=\n##\s|\Z)"
    m = re.search(pattern, body, re.DOTALL | re.IGNORECASE)
    if not m:
        return ""
    return f"**{heading}**:\n{m.group(1).strip()}"
