"""封面读写：OSS 已配置时写入 xhs/images/…，否则落盘 image-cards/。"""

from __future__ import annotations

import io
from pathlib import Path

from ..xhs.baoyu_image_cards.paths import IMAGE_CARDS_ROOT
from .oss_client import (
    get_oss_object,
    is_oss_configured,
    is_oss_image_key,
    normalize_oss_key,
    upload_oss_object,
)


def work_cover_local_dir(work_id: str) -> Path:
    return (IMAGE_CARDS_ROOT / "creative-covers" / str(work_id).strip()).resolve()


def save_work_cover_bytes(
    work_id: str,
    data: bytes,
    *,
    filename: str,
    content_type: str = "image/png",
) -> str:
    wid = str(work_id or "").strip()
    if not wid:
        raise ValueError("work_id 无效")
    fn = Path(str(filename or "").strip()).name
    if not fn or fn != filename or ".." in fn:
        raise ValueError("文件名非法")
    if is_oss_configured():
        key = normalize_oss_key(f"creative-covers/{wid}/{fn}")
        upload_oss_object(key, data, content_type=content_type)
        return key
    out_dir = work_cover_local_dir(wid)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / fn
    out_path.write_bytes(data)
    return str(out_path)


def promote_local_file_to_cover_storage(
    local_path: Path,
    *,
    oss_relative: str,
) -> str:
    """AI 等先写本地文件，再按需上传 OSS 并返回 DB 用的 coverPath。"""
    path = local_path.resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    if is_oss_configured():
        key = normalize_oss_key(oss_relative)
        ctype = "image/png" if path.suffix.lower() == ".png" else "application/octet-stream"
        upload_oss_object(key, path.read_bytes(), content_type=ctype)
        return key
    return str(path)


def load_cover_image_bytes(path_or_key: str) -> bytes:
    raw = str(path_or_key or "").strip()
    if not raw:
        raise ValueError("路径为空")
    if is_oss_image_key(raw):
        key = raw[4:] if raw.startswith("oss:") else raw
        body, _ = get_oss_object(key)
        return body
    target = Path(raw)
    if not target.is_absolute():
        from ..xhs.baoyu_image_cards.paths import REPO_ROOT

        target = REPO_ROOT / target
    resolved = target.resolve(strict=True)
    allowed = IMAGE_CARDS_ROOT.resolve()
    if allowed not in resolved.parents and resolved != allowed:
        raise ValueError("底图路径不在允许目录内")
    return resolved.read_bytes()


def load_cover_image_pil(path_or_key: str):
    from PIL import Image

    return Image.open(io.BytesIO(load_cover_image_bytes(path_or_key)))
