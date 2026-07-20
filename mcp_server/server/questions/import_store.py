"""导入批次与预览项。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any
from uuid import uuid4

from ..chat.chat_memory_db import init_chat_memory_db, utc_now_iso
from ..chat.memory_store import _db_path
from .real_exam import canonical_exam_kind


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_chat_memory_db(conn)
    return conn


def _import_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    warnings: list[str] = []
    try:
        pr = json.loads(str(row["parse_result_json"] or "{}"))
        if isinstance(pr, dict):
            warnings = [str(w) for w in (pr.get("warnings") or []) if str(w).strip()]
    except json.JSONDecodeError:
        pass
    return {
        "id": str(row["id"]),
        "filename": str(row["filename"] or ""),
        "mimeType": str(row["mime_type"] or ""),
        "fileSize": int(row["file_size"] or 0),
        "category": str(row["category"] or ""),
        "status": str(row["status"] or ""),
        "extractError": str(row["extract_error"] or ""),
        "parseError": str(row["parse_error"] or ""),
        "questionCount": int(row["question_count"] or 0),
        "confirmedCount": int(row["confirmed_count"] or 0),
        "warnings": warnings,
        "createdAt": str(row["created_at"] or ""),
        "confirmedAt": str(row["confirmed_at"] or ""),
        "discardedAt": str(row["discarded_at"] or ""),
    }


def _item_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    try:
        options = json.loads(str(row["options_json"] or "[]"))
    except json.JSONDecodeError:
        options = []
    if not isinstance(options, list):
        options = []
    return {
        "id": str(row["id"]),
        "importId": str(row["import_id"]),
        "rowIndex": int(row["row_index"] or 0),
        "header": str(row["header"] or ""),
        "stem": str(row["stem"] or ""),
        "options": [str(x) for x in options],
        "answer": str(row["answer"] or ""),
        "explanation": str(row["explanation"] or ""),
        "extraTitle": str(row["extra_title"] or ""),
        "extraText": str(row["extra_text"] or ""),
        "category": str(row["category"] or ""),
        "subjectDomain": str(row["subject_domain"] or ""),
        "questionType": str(row["question_type"] or "single"),
        "confidence": row["confidence"],
        "isRealExam": bool(int(row["is_real_exam"] or 0)),
        "examYear": str(row["exam_year"] or ""),
        "examRegion": str(row["exam_region"] or ""),
        "examKind": canonical_exam_kind(str(row["exam_kind"] or "")),
        "examSourceRaw": str(row["exam_source_raw"] or ""),
        "selected": bool(int(row["selected"] or 0)),
        "edited": bool(int(row["edited"] or 0)),
        "createdAt": str(row["created_at"] or ""),
    }


def create_import_record(
    *,
    filename: str,
    mime_type: str,
    file_size: int,
    file_sha256: str,
    source_path: str,
    category: str,
    import_id: str | None = None,
) -> dict[str, Any]:
    iid = str(import_id or uuid4()).strip() or str(uuid4())
    now = utc_now_iso()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO question_imports (
                id, filename, mime_type, file_size, file_sha256,
                source_path, extracted_text_path, category, status,
                extract_error, parse_error, parse_result_json,
                question_count, confirmed_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, '', ?, 'uploaded', '', '', '{}', 0, 0, ?)
            """,
            (
                iid,
                str(filename or ""),
                str(mime_type or ""),
                int(file_size),
                str(file_sha256 or ""),
                str(source_path or ""),
                str(category or ""),
                now,
            ),
        )
        conn.commit()
    return get_import(iid)


def get_import(import_id: str) -> dict[str, Any]:
    iid = str(import_id or "").strip()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM question_imports WHERE id = ?",
            (iid,),
        ).fetchone()
    if not row:
        raise ValueError("导入批次不存在")
    return _import_row_to_dict(row)


def update_import_status(
    import_id: str,
    *,
    status: str | None = None,
    extract_error: str | None = None,
    parse_error: str | None = None,
    extracted_text_path: str | None = None,
    source_path: str | None = None,
    filename: str | None = None,
    file_size: int | None = None,
    file_sha256: str | None = None,
    parse_result_json: str | None = None,
    question_count: int | None = None,
    confirmed_count: int | None = None,
    confirmed_at: str | None = None,
    discarded_at: str | None = None,
) -> dict[str, Any]:
    iid = str(import_id or "").strip()
    fields: list[str] = []
    values: list[Any] = []
    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if extract_error is not None:
        fields.append("extract_error = ?")
        values.append(extract_error)
    if parse_error is not None:
        fields.append("parse_error = ?")
        values.append(parse_error)
    if extracted_text_path is not None:
        fields.append("extracted_text_path = ?")
        values.append(extracted_text_path)
    if source_path is not None:
        fields.append("source_path = ?")
        values.append(source_path)
    if filename is not None:
        fields.append("filename = ?")
        values.append(filename)
    if file_size is not None:
        fields.append("file_size = ?")
        values.append(int(file_size))
    if file_sha256 is not None:
        fields.append("file_sha256 = ?")
        values.append(file_sha256)
    if parse_result_json is not None:
        fields.append("parse_result_json = ?")
        values.append(parse_result_json)
    if question_count is not None:
        fields.append("question_count = ?")
        values.append(int(question_count))
    if confirmed_count is not None:
        fields.append("confirmed_count = ?")
        values.append(int(confirmed_count))
    if confirmed_at is not None:
        fields.append("confirmed_at = ?")
        values.append(confirmed_at)
    if discarded_at is not None:
        fields.append("discarded_at = ?")
        values.append(discarded_at)
    if not fields:
        return get_import(iid)
    values.append(iid)
    with _connect() as conn:
        conn.execute(
            f"UPDATE question_imports SET {', '.join(fields)} WHERE id = ?",
            values,
        )
        conn.commit()
    return get_import(iid)


def delete_import_items(import_id: str) -> None:
    iid = str(import_id or "").strip()
    with _connect() as conn:
        conn.execute("DELETE FROM question_import_items WHERE import_id = ?", (iid,))
        conn.commit()


def insert_import_items(import_id: str, questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    iid = str(import_id or "").strip()
    now = utc_now_iso()
    delete_import_items(iid)
    rows: list[dict[str, Any]] = []
    with _connect() as conn:
        for idx, q in enumerate(questions):
            item_id = str(uuid4())
            opts = q.get("options") or []
            conn.execute(
                """
                INSERT INTO question_import_items (
                    id, import_id, row_index, header, stem, options_json,
                    answer, explanation, extra_title, extra_text,
                    category, question_type, subject_domain, confidence,
                    is_real_exam, exam_year, exam_region, exam_kind, exam_source_raw,
                    selected, edited, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
                """,
                (
                    item_id,
                    iid,
                    idx,
                    str(q.get("header") or ""),
                    str(q.get("stem") or ""),
                    json.dumps(opts, ensure_ascii=False),
                    str(q.get("answer") or ""),
                    str(q.get("explanation") or ""),
                    str(q.get("extra_title") or ""),
                    str(q.get("extra_text") or ""),
                    str(q.get("category") or ""),
                    str(q.get("question_type") or "single"),
                    str(q.get("subject_domain") or ""),
                    q.get("confidence"),
                    1 if q.get("is_real_exam") else 0,
                    str(q.get("exam_year") or ""),
                    str(q.get("exam_region") or ""),
                    canonical_exam_kind(str(q.get("exam_kind") or "")),
                    str(q.get("exam_source_raw") or ""),
                    now,
                ),
            )
        conn.commit()
    return list_import_items(iid)


def list_import_items(import_id: str) -> list[dict[str, Any]]:
    iid = str(import_id or "").strip()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM question_import_items
            WHERE import_id = ?
            ORDER BY row_index ASC
            """,
            (iid,),
        ).fetchall()
    return [_item_row_to_dict(r) for r in rows]


def get_import_item(import_id: str, item_id: str) -> dict[str, Any]:
    iid = str(import_id or "").strip()
    it = str(item_id or "").strip()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM question_import_items WHERE import_id = ? AND id = ?",
            (iid, it),
        ).fetchone()
    if not row:
        raise ValueError("预览项不存在")
    return _item_row_to_dict(row)


def patch_import_item(
    import_id: str,
    item_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    iid = str(import_id or "").strip()
    it = str(item_id or "").strip()
    current = get_import_item(iid, it)
    header = patch.get("header", current["header"])
    stem = patch.get("stem", current["stem"])
    options = patch.get("options", current["options"])
    answer = patch.get("answer", current["answer"])
    explanation = patch.get("explanation", current["explanation"])
    extra_title = patch.get("extraTitle", patch.get("extra_title", current["extraTitle"]))
    extra_text = patch.get("extraText", patch.get("extra_text", current["extraText"]))
    category = patch.get("category", current["category"])
    subject_domain = patch.get(
        "subjectDomain", patch.get("subject_domain", current["subjectDomain"])
    )
    question_type = patch.get("questionType", patch.get("question_type", current["questionType"]))
    selected = patch.get("selected", current["selected"])
    is_real_exam = patch.get("isRealExam", patch.get("is_real_exam", current["isRealExam"]))
    exam_year = patch.get("examYear", patch.get("exam_year", current["examYear"]))
    exam_region = patch.get("examRegion", patch.get("exam_region", current["examRegion"]))
    exam_kind = canonical_exam_kind(
        str(patch.get("examKind", patch.get("exam_kind", current["examKind"])) or "")
    )
    exam_source_raw = patch.get(
        "examSourceRaw", patch.get("exam_source_raw", current["examSourceRaw"])
    )
    if not str(stem or "").strip():
        raise ValueError("题干不能为空")
    opts = [str(x).strip() for x in (options or []) if str(x).strip()]
    if len(opts) < 2:
        raise ValueError("至少两个选项")
    if not str(answer or "").strip():
        raise ValueError("答案不能为空")

    with _connect() as conn:
        conn.execute(
            """
            UPDATE question_import_items SET
                header = ?, stem = ?, options_json = ?, answer = ?,
                explanation = ?, extra_title = ?, extra_text = ?,
                category = ?, subject_domain = ?, question_type = ?,
                is_real_exam = ?, exam_year = ?, exam_region = ?, exam_kind = ?,
                exam_source_raw = ?, selected = ?, edited = 1
            WHERE import_id = ? AND id = ?
            """,
            (
                str(header or ""),
                str(stem or "").strip(),
                json.dumps(opts, ensure_ascii=False),
                str(answer or "").strip().upper(),
                str(explanation or ""),
                str(extra_title or ""),
                str(extra_text or ""),
                str(category or ""),
                str(subject_domain or ""),
                str(question_type or "single"),
                1 if is_real_exam else 0,
                str(exam_year or ""),
                str(exam_region or ""),
                str(exam_kind or ""),
                str(exam_source_raw or ""),
                1 if selected else 0,
                iid,
                it,
            ),
        )
        conn.commit()
    return get_import_item(iid, it)


def file_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


