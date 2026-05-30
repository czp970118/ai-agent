"""从粘贴文本或 LLM 字段解析真题来源（年份 / 省份或地区 / 考试类型）。"""

from __future__ import annotations

import re
from typing import Any

from .real_exam import REAL_EXAM_KINDS, REAL_EXAM_KINDS_SET, canonical_exam_kind

_SOURCE_LINE_RE = re.compile(
    r"[📌\*\s]*(?:真题来源|来源)[：:]\s*(.+?)(?:\s*$)",
    re.MULTILINE | re.IGNORECASE,
)

_YEAR_RE = re.compile(r"(20\d{2})")

# 长名称优先匹配
_PROVINCE_NAMES: tuple[str, ...] = (
    "内蒙古",
    "黑龙江",
    "广西壮族",
    "宁夏回族",
    "新疆维吾尔",
    "北京",
    "天津",
    "上海",
    "重庆",
    "河北",
    "山西",
    "辽宁",
    "吉林",
    "江苏",
    "浙江",
    "安徽",
    "福建",
    "江西",
    "山东",
    "河南",
    "湖北",
    "湖南",
    "广东",
    "海南",
    "四川",
    "贵州",
    "云南",
    "陕西",
    "甘肃",
    "青海",
    "台湾",
    "广西",
    "西藏",
    "宁夏",
    "新疆",
    "香港",
    "澳门",
)

_KIND_SCAN: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("事业单位", re.compile(r"事业单位|事业编|三支一扶|统考")),
    ("选调生", re.compile(r"选调生|选调")),
    ("国考", re.compile(r"国考")),
    ("省考", re.compile(r"省考")),
    ("联考", re.compile(r"联考")),
)


def _detect_exam_kind(text: str) -> str:
    for kind, pat in _KIND_SCAN:
        if pat.search(text):
            return kind
    return ""


def _detect_exam_year(text: str) -> str:
    m = _YEAR_RE.search(text)
    return m.group(1) if m else ""


def _detect_exam_region(text: str) -> str:
    t = re.sub(r"^20\d{2}\s*年?", "", str(text or ""))
    for name in sorted(_PROVINCE_NAMES, key=len, reverse=True):
        if name in t:
            if name.endswith("壮族") or name.endswith("回族") or name.endswith("维吾尔"):
                return name[:2]
            return name[:6]
    m = re.search(r"([\u4e00-\u9fff]{2,4}?)市", t)
    if m:
        return m.group(1)
    return ""


def parse_exam_source_text(raw: str) -> dict[str, Any]:
    """解析单行来源文案，如「2023年广东事业单位统考」。"""
    raw_line = re.sub(r"\s+", "", str(raw or "").strip())
    if not raw_line:
        return {
            "is_real_exam": False,
            "exam_year": "",
            "exam_region": "",
            "exam_kind": "",
            "exam_source_raw": "",
        }

    kind = _detect_exam_kind(raw_line)
    year = _detect_exam_year(raw_line)
    region = _detect_exam_region(raw_line)

    if kind and canonical_exam_kind(kind) not in REAL_EXAM_KINDS_SET:
        kind = ""

    is_real = bool(kind and year) or bool(kind and region) or bool(year and region)
    if not is_real and ("真题" in raw_line or "考" in raw_line) and year:
        is_real = bool(region or kind)

    return {
        "is_real_exam": is_real,
        "exam_year": year,
        "exam_region": region,
        "exam_kind": canonical_exam_kind(kind) if kind in REAL_EXAM_KINDS_SET else kind,
        "exam_source_raw": str(raw or "").strip()[:200],
    }


def extract_exam_sources_in_order(text: str) -> list[dict[str, Any]]:
    """按出现顺序提取文中所有「真题来源」行。"""
    out: list[dict[str, Any]] = []
    for m in _SOURCE_LINE_RE.finditer(str(text or "")):
        parsed = parse_exam_source_text(m.group(1))
        if parsed.get("exam_year") or parsed.get("exam_kind") or parsed.get("exam_region"):
            parsed["is_real_exam"] = True
            out.append(parsed)
    return out


def _apply_parsed_meta(out: dict[str, Any], parsed: dict[str, Any]) -> None:
    for key in ("exam_year", "exam_region", "exam_kind", "exam_source_raw"):
        val = str(parsed.get(key) or "").strip()
        if val and not str(out.get(key) or "").strip():
            out[key] = val
    if parsed.get("is_real_exam"):
        out["is_real_exam"] = True


def merge_exam_meta_into_question(
    q: dict[str, Any],
    source: dict[str, Any] | None,
) -> dict[str, Any]:
    """将来源元数据写入题目 dict（用于 import_items）。"""
    out = dict(q)
    if source:
        _apply_parsed_meta(out, source)

    llm_src = str(
        q.get("exam_source_raw")
        or q.get("exam_source")
        or q.get("examSource")
        or ""
    ).strip()
    if llm_src:
        _apply_parsed_meta(out, parse_exam_source_text(llm_src))

    if out.get("exam_year") or out.get("exam_kind"):
        out["is_real_exam"] = True
    return out


def merge_exam_sources_into_questions(
    questions: list[dict[str, Any]],
    sources: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """按题序将正则提取的来源与 LLM 题目对齐。"""
    merged: list[dict[str, Any]] = []
    for i, q in enumerate(questions):
        src = sources[i] if i < len(sources) else None
        merged.append(merge_exam_meta_into_question(q, src))
    if len(sources) > len(questions):
        extra = len(sources) - len(questions)
        return merged  # caller adds warning
    return merged


def apply_exam_sources_from_text(
    questions: list[dict[str, Any]],
    full_text: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """全文提取来源并按序合并；返回附加 warnings。"""
    sources = extract_exam_sources_in_order(full_text)
    warnings: list[str] = []
    if not sources:
        return [merge_exam_meta_into_question(q, None) for q in questions], warnings
    if len(sources) != len(questions):
        warnings.append(
            f"真题来源行数（{len(sources)}）与识别题目数（{len(questions)}）不一致，已按顺序尽量匹配"
        )
    merged = merge_exam_sources_into_questions(questions, sources)
    return merged, warnings
