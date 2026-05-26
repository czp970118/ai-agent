"""题库导入：上传格式配置。"""

from __future__ import annotations

ALLOWED_EXTENSIONS = frozenset({".docx"})


def allowed_upload_extensions() -> frozenset[str]:
    return ALLOWED_EXTENSIONS


def upload_config_payload(*, max_upload_bytes: int) -> dict[str, object]:
    exts = sorted(ALLOWED_EXTENSIONS)
    return {
        "allowedExtensions": exts,
        "maxUploadBytes": max_upload_bytes,
        "hint": "题目/答案卷仅支持 .docx，至少上传其一。先预览再 AI 结构化。",
    }
