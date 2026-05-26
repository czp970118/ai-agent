"""题库导入文件：本地 mcp_server/data/question-imports/{import_id}/。"""

from __future__ import annotations

import os
from pathlib import Path


def _imports_root() -> Path:
    configured = os.getenv("QUESTION_IMPORT_DATA_DIR", "").strip()
    if configured:
        root = Path(configured)
    else:
        root = Path(__file__).resolve().parents[2] / "data" / "question-imports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def import_dir(import_id: str) -> Path:
    iid = str(import_id or "").strip()
    if not iid or ".." in iid or "/" in iid or "\\" in iid:
        raise ValueError("import_id 无效")
    d = (_imports_root() / iid).resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_source_file(import_id: str, data: bytes, ext: str, *, role: str = "question") -> str:
    normalized = str(ext or "").strip().lower()
    if normalized != ".docx":
        raise ValueError("不支持的源文件类型")
    role_key = str(role or "question").strip().lower()
    if role_key not in ("question", "answer"):
        raise ValueError("role 无效")
    stem = "source" if role_key == "question" else "source-answer"
    path = import_dir(import_id) / f"{stem}{normalized}"
    path.write_bytes(data)
    return str(path)


def save_source_docx(import_id: str, data: bytes) -> str:
    """兼容旧调用。"""
    return save_source_file(import_id, data, ".docx")


def save_extracted_text(import_id: str, text: str) -> str:
    path = import_dir(import_id) / "extracted.txt"
    path.write_text(text, encoding="utf-8")
    return str(path)


def save_extracted_question_text(import_id: str, text: str) -> str:
    path = import_dir(import_id) / "extracted-question.txt"
    path.write_text(str(text or ""), encoding="utf-8")
    return str(path)


def save_extracted_answer_text(import_id: str, text: str) -> str:
    path = import_dir(import_id) / "extracted-answer.txt"
    path.write_text(str(text or ""), encoding="utf-8")
    return str(path)


def read_extracted_question_text(import_id: str) -> str:
    path = import_dir(import_id) / "extracted-question.txt"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def read_extracted_answer_text(import_id: str) -> str:
    path = import_dir(import_id) / "extracted-answer.txt"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def read_extracted_text(extracted_text_path: str) -> str:
    path = Path(str(extracted_text_path or "").strip())
    if not path.is_file():
        raise FileNotFoundError("提取文本不存在")
    return path.read_text(encoding="utf-8")
