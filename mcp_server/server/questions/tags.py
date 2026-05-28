"""题库标签：清洗与序列化。"""

from __future__ import annotations

import json
from typing import Any


def normalize_tags(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                parsed = [text]
            return normalize_tags(parsed)
        return normalize_tags([part.strip() for part in text.replace("，", ",").split(",")])
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        value = str(item or "").strip()
        if value and value not in out:
            out.append(value)
    return out


def tags_to_json(tags: list[str]) -> str:
    return json.dumps(normalize_tags(tags), ensure_ascii=False)


def tags_from_json(raw: str | None) -> list[str]:
    if not str(raw or "").strip():
        return []
    try:
        parsed = json.loads(str(raw))
    except json.JSONDecodeError:
        return []
    return normalize_tags(parsed)
