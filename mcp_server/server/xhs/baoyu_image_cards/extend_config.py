from __future__ import annotations

import re
from typing import Any

from .paths import extend_paths


def load_extend_config() -> dict[str, Any]:
    for path in extend_paths():
        if path.is_file():
            return _parse_extend(path.read_text(encoding="utf-8"))
    return {
        "style": "notion",
        "layout": "sparse",
        "palette": "macaron",
        "watermark_enabled": False,
        "watermark_content": "",
        "watermark_position": "bottom-right",
        "language": "zh",
        "generation_batch_size": 4,
        "source_path": None,
    }


def _parse_extend(text: str) -> dict[str, Any]:
    out: dict[str, Any] = {
        "style": "notion",
        "layout": "sparse",
        "palette": "macaron",
        "watermark_enabled": False,
        "watermark_content": "",
        "watermark_position": "bottom-right",
        "language": "zh",
        "generation_batch_size": 4,
        "source_path": None,
    }
    raw = text.strip()
    if not raw:
        return out
    # YAML frontmatter
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            body = parts[2]
            fm = parts[1]
            for line in fm.splitlines():
                if "preferred_style" in line or "name:" in line:
                    m = re.search(r"name:\s*(\S+)", line)
                    if m:
                        out["style"] = m.group(1).strip()
                if "preferred_layout" in line:
                    m = re.search(r"preferred_layout:\s*(\S+)", line)
                    if m and m.group(1) != "null":
                        out["layout"] = m.group(1).strip()
                if "preferred_palette" in line:
                    m = re.search(r"preferred_palette:\s*(\S+)", line)
                    if m and m.group(1) != "null":
                        out["palette"] = m.group(1).strip()
                if "enabled:" in line and "watermark" in fm[: fm.find(line)]:
                    out["watermark_enabled"] = "true" in line.lower()
                if line.strip().startswith("content:") and "watermark" in fm:
                    m = re.search(r'content:\s*"?([^"\n]+)"?', line)
                    if m:
                        out["watermark_content"] = m.group(1).strip()
            raw = body
    # Legacy EXTEND.md key: value lines (xhs_cover_image)
    for line in raw.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        key = k.strip()
        val = v.strip().strip('"').strip("'")
        if key == "preferred_style" and val:
            out["style"] = val
        elif key == "preferred_layout" and val:
            out["layout"] = val
        elif key == "preferred_palette" and val and val != "none":
            out["palette"] = val
    out["source_path"] = str(extend_paths()[0])
    return out
