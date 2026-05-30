"""真题考试类型与展示文案（国考 / 省考 / 联考 / 事业单位 / 选调生）。"""

from __future__ import annotations

# 行测类真题常见来源（与导入、每日一题顶栏一致）
REAL_EXAM_KINDS: tuple[str, ...] = ("国考", "省考", "联考", "事业单位", "选调生")
REAL_EXAM_KINDS_SET = frozenset(REAL_EXAM_KINDS)
KINDS_REQUIRE_REGION = frozenset({"省考", "联考", "事业单位", "选调生"})
EXAM_KIND_ALIASES = {"事业编": "事业单位"}


def canonical_exam_kind(kind: str) -> str:
    k = str(kind or "").strip()
    return EXAM_KIND_ALIASES.get(k, k)


def format_real_exam_summary(*, year: str, region: str, kind: str) -> str:
    k = canonical_exam_kind(kind)
    if not k:
        return ""
    y = str(year or "").strip()
    r = str(region or "").strip()
    if k == "国考" and not r:
        r = "全国"
    region_part = r if r else ""
    if y:
        return f"{y}年{region_part}{k}"
    return f"{region_part}{k}" if region_part else k


def normalize_real_exam_meta(
    *,
    is_real_exam: bool,
    exam_year: str = "",
    exam_region: str = "",
    exam_kind: str = "",
) -> tuple[str, str, str]:
    if not is_real_exam:
        return "", "", ""
    kind = canonical_exam_kind(exam_kind)
    year = str(exam_year or "").strip()
    region = str(exam_region or "").strip()
    kinds_label = "、".join(REAL_EXAM_KINDS)
    if kind not in REAL_EXAM_KINDS_SET:
        raise ValueError(f"真题须选择考试类型：{kinds_label}")
    if not year:
        raise ValueError("真题须填写年份")
    if kind in KINDS_REQUIRE_REGION and not region:
        raise ValueError(f"{kind}须填写省份")
    if kind == "国考" and not region:
        region = "全国"
    return year, region, kind
