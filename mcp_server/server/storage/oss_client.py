"""阿里云 OSS：经服务端上传与读取（私有 Bucket + 代理出图）。"""

from __future__ import annotations

import os
import re

import oss2

_PREFIX_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-./]*$")


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def is_oss_configured() -> bool:
    return bool(
        _env("OSS_ACCESS_KEY_ID")
        and _env("OSS_ACCESS_KEY_SECRET")
        and _env("OSS_BUCKET")
        and _env("OSS_ENDPOINT")
    )


def oss_root_prefix() -> str:
    return _env("OSS_PREFIX", "xhs/images").strip("/")


def is_oss_image_key(path: str) -> bool:
    p = str(path or "").strip()
    if not p:
        return False
    if p.startswith("oss:"):
        p = p[4:].lstrip("/")
    root = oss_root_prefix()
    return p == root or p.startswith(f"{root}/")


def _bucket() -> oss2.Bucket:
    if not is_oss_configured():
        raise RuntimeError(
            "OSS 未配置：请在 mcp_server/.env 设置 OSS_ENDPOINT、OSS_BUCKET、"
            "OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET（可选 OSS_PREFIX，默认 xhs/images）"
        )
    endpoint = _env("OSS_ENDPOINT")
    if not endpoint.startswith("http"):
        endpoint = f"https://{endpoint}"
    auth = oss2.Auth(_env("OSS_ACCESS_KEY_ID"), _env("OSS_ACCESS_KEY_SECRET"))
    return oss2.Bucket(auth, endpoint, _env("OSS_BUCKET"))


def normalize_oss_key(relative_path: str, *, filename: str | None = None) -> str:
    """将相对路径规范为 Bucket 内 object key（含 OSS_PREFIX）。"""
    root = oss_root_prefix()
    rel = str(relative_path or "").strip().replace("\\", "/").lstrip("/")
    if rel in (".", ""):
        rel = ""
    parts = [p for p in rel.split("/") if p and p != "."]
    for part in parts:
        if part == ".." or not _PREFIX_RE.match(part):
            raise ValueError("路径含非法片段")
    if filename:
        fn = str(filename).strip().lstrip("/")
        if not fn or ".." in fn.split("/"):
            raise ValueError("文件名非法")
        parts.append(fn)
    if not parts:
        raise ValueError("路径不能为空")
    key = "/".join([root, *parts])
    if not key.startswith(root):
        raise ValueError("路径越界")
    return key


def upload_oss_object(
    key: str,
    data: bytes,
    *,
    content_type: str = "application/octet-stream",
) -> str:
    bucket = _bucket()
    headers = {"Content-Type": content_type}
    bucket.put_object(key, data, headers=headers)
    return key


def get_oss_object(key: str) -> tuple[bytes, str]:
    key = str(key or "").strip().lstrip("/")
    root = oss_root_prefix()
    if not key.startswith(root + "/") and key != root:
        raise ValueError("key 不在允许前缀内")
    bucket = _bucket()
    try:
        result = bucket.get_object(key)
    except oss2.exceptions.NoSuchKey as exc:
        raise FileNotFoundError(key) from exc
    body = result.read()
    ctype = result.headers.get("Content-Type") or "application/octet-stream"
    return body, str(ctype)

