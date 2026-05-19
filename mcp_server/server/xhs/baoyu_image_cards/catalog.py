from __future__ import annotations

from typing import Any

# 与 baoyu-image-cards SKILL.md 对齐
STYLES: dict[str, str] = {
    "cute": "甜美可爱，经典小红书少女风",
    "fresh": "清新自然，干净通透",
    "warm": "温暖亲切，生活感",
    "bold": "高对比醒目，强提醒",
    "minimal": "极简留白，高级感",
    "retro": "复古怀旧，潮流感",
    "pop": "高饱和潮流，吸睛",
    "notion": "手绘线稿知识风，理性克制",
    "chalkboard": "彩色粉笔黑板，教学感",
    "study-notes": "仿真手写笔记，蓝笔红批",
    "screen-print": "丝网海报，大色块 symbolism",
    "sketch-notes": "手绘教育信息图，马卡龙奶油底",
}

LAYOUTS: dict[str, str] = {
    "sparse": "1-2 个要点，封面冲击力强",
    "balanced": "3-4 个要点，常规信息密度",
    "dense": "5-8 个要点，知识卡",
    "list": "清单 / 排行 4-7 项",
    "comparison": "左右对比",
    "flow": "流程 / 时间线 3-6 步",
    "mindmap": "中心发散 4-8 枝",
    "quadrant": "四象限",
}

PALETTES: dict[str, str] = {
    "macaron": "奶油底 + 马卡龙分区色，偏教育分享",
    "warm": "暖桃大地色，生活情感",
    "neon": "深紫底霓虹色，强能量感",
}

# preset -> style, layout, palette(None=用风格内置色)
PRESETS: dict[str, dict[str, str | None]] = {
    "knowledge-card": {"style": "notion", "layout": "dense", "palette": None},
    "checklist": {"style": "notion", "layout": "list", "palette": None},
    "tutorial": {"style": "chalkboard", "layout": "flow", "palette": None},
    "study-guide": {"style": "study-notes", "layout": "dense", "palette": None},
    "hand-drawn-edu": {"style": "sketch-notes", "layout": "flow", "palette": "macaron"},
    "sketch-card": {"style": "sketch-notes", "layout": "dense", "palette": "macaron"},
    "cute-share": {"style": "cute", "layout": "balanced", "palette": None},
    "girly": {"style": "cute", "layout": "sparse", "palette": None},
    "cozy-story": {"style": "warm", "layout": "balanced", "palette": None},
    "product-review": {"style": "fresh", "layout": "comparison", "palette": None},
    "warning": {"style": "bold", "layout": "list", "palette": None},
    "versus": {"style": "bold", "layout": "comparison", "palette": None},
    "clean-quote": {"style": "minimal", "layout": "sparse", "palette": None},
    "pro-summary": {"style": "minimal", "layout": "balanced", "palette": None},
    "retro-ranking": {"style": "retro", "layout": "list", "palette": None},
    "pop-facts": {"style": "pop", "layout": "list", "palette": None},
    "hype": {"style": "pop", "layout": "sparse", "palette": None},
    "poster": {"style": "screen-print", "layout": "sparse", "palette": None},
    "editorial": {"style": "screen-print", "layout": "balanced", "palette": None},
}

# 创作中心封面推荐 preset
COVER_PRESET_IDS = [
    "girly",
    "clean-quote",
    "hype",
    "cute-share",
    "cozy-story",
    "knowledge-card",
    "tutorial",
    "poster",
    "hand-drawn-edu",
    "product-review",
]


def resolve_dimensions(
    *,
    preset: str | None = None,
    style: str | None = None,
    layout: str | None = None,
    palette: str | None = None,
    extend_defaults: dict[str, str] | None = None,
) -> dict[str, str | None]:
    ext = extend_defaults or {}
    p = str(preset or "").strip()
    st = str(style or ext.get("style") or "notion").strip()
    la = str(layout or ext.get("layout") or "sparse").strip()
    pa: str | None = str(palette or ext.get("palette") or "").strip() or None
    if p and p in PRESETS:
        row = PRESETS[p]
        st = str(row.get("style") or st)
        la = str(row.get("layout") or la)
        if row.get("palette"):
            pa = str(row["palette"])
    if st not in STYLES:
        st = "notion"
    if la not in LAYOUTS:
        la = "sparse"
    if pa and pa not in PALETTES:
        pa = None
    return {"preset": p or None, "style": st, "layout": la, "palette": pa}


def get_catalog(extend_summary: dict[str, Any] | None = None) -> dict[str, Any]:
    presets_out = []
    for pid, row in PRESETS.items():
        presets_out.append(
            {
                "id": pid,
                "style": row["style"],
                "layout": row["layout"],
                "palette": row.get("palette"),
                "label": _preset_label(pid),
                "forCover": pid in COVER_PRESET_IDS,
            }
        )
    return {
        "styles": [{"id": k, "label": v} for k, v in STYLES.items()],
        "layouts": [{"id": k, "label": v} for k, v in LAYOUTS.items()],
        "palettes": [{"id": k, "label": v} for k, v in PALETTES.items()],
        "presets": presets_out,
        "coverPresetIds": COVER_PRESET_IDS,
        "extend": extend_summary or {},
        "workflow": {
            "promptDir": "image-cards/{slug}/prompts/",
            "coverFile": "01-cover-{slug}.png",
            "aspectRatio": "3:4",
            "skillDoc": "https://www.skills.sh/jimliu/baoyu-skills/baoyu-image-cards",
        },
    }


def _preset_label(pid: str) -> str:
    labels = {
        "girly": "甜美封面",
        "clean-quote": "金句极简封面",
        "hype": "炸裂吸睛封面",
        "cute-share": "少女风分享",
        "cozy-story": "温暖故事",
        "knowledge-card": "干货知识卡",
        "tutorial": "教程流程",
        "poster": "海报风封面",
        "hand-drawn-edu": "手绘教程",
        "product-review": "产品对比",
    }
    return labels.get(pid, pid)
