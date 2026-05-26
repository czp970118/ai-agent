"""正式题库 question_bank。"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from typing import Any
from uuid import uuid4

from ..chat.chat_memory_db import init_chat_memory_db, utc_now_iso
from ..chat.memory_store import _db_path
from .import_store import get_import, list_import_items


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_chat_memory_db(conn)
    return conn


def stem_hash(stem: str) -> str:
    normalized = re.sub(r"\s+", "", str(stem or "").strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _bank_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    try:
        options = json.loads(str(row["options_json"] or "[]"))
    except json.JSONDecodeError:
        options = []
    if not isinstance(options, list):
        options = []
    return {
        "id": str(row["id"]),
        "importId": str(row["import_id"] or ""),
        "importItemId": str(row["import_item_id"] or ""),
        "category": str(row["category"] or ""),
        "questionType": str(row["question_type"] or "single"),
        "header": str(row["header"] or ""),
        "stem": str(row["stem"] or ""),
        "options": [str(x) for x in options],
        "answer": str(row["answer"] or ""),
        "explanation": str(row["explanation"] or ""),
        "extraTitle": str(row["extra_title"] or ""),
        "extraText": str(row["extra_text"] or ""),
        "status": str(row["status"] or ""),
        "sortOrder": int(row["sort_order"] or 0),
        "usedAt": str(row["used_at"] or ""),
        "createdAt": str(row["created_at"] or ""),
        "updatedAt": str(row["updated_at"] or ""),
    }


def list_questions(
    *,
    status: str = "ready",
    category: str = "",
    usage: str = "",
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    st = str(status or "ready").strip() or "ready"
    cat = str(category or "").strip()
    usage_key = str(usage or "").strip().lower()
    lim = max(1, min(int(limit), 500))
    off = max(0, int(offset))
    where = ["status = ?"]
    params: list[Any] = [st]
    if cat:
        where.append("category = ?")
        params.append(cat)
    if usage_key == "unused":
        where.append("(used_at IS NULL OR used_at = '')")
    elif usage_key == "used":
        where.append("used_at != ''")

    base_where = ["status = ?"]
    base_params: list[Any] = [st]
    if cat:
        base_where.append("category = ?")
        base_params.append(cat)
    base_clause = " AND ".join(base_where)

    clause = " AND ".join(where)
    with _connect() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM question_bank WHERE {clause}",
            params,
        ).fetchone()[0]
        used_total = conn.execute(
            f"""
            SELECT COUNT(*) FROM question_bank
            WHERE {base_clause} AND used_at != ''
            """,
            base_params,
        ).fetchone()[0]
        unused_total = conn.execute(
            f"""
            SELECT COUNT(*) FROM question_bank
            WHERE {base_clause} AND (used_at IS NULL OR used_at = '')
            """,
            base_params,
        ).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT * FROM question_bank
            WHERE {clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, lim, off),
        ).fetchall()
    return {
        "items": [_bank_row_to_dict(r) for r in rows],
        "total": int(total),
        "usedTotal": int(used_total),
        "unusedTotal": int(unused_total),
        "limit": lim,
        "offset": off,
    }


def recall_random_questions(
    *,
    count: int = 7,
    exclude_ids: list[str] | None = None,
    category: str = "",
    status: str = "ready",
) -> dict[str, Any]:
    cnt = max(1, min(int(count), 20))
    st = str(status or "ready").strip() or "ready"
    cat = str(category or "").strip()
    exclude = [str(x).strip() for x in (exclude_ids or []) if str(x).strip()]

    where = ["status = ?"]
    params: list[Any] = [st]
    if cat:
        where.append("category = ?")
        params.append(cat)
    where.append("(used_at IS NULL OR used_at = '')")
    if exclude:
        placeholders = ",".join("?" * len(exclude))
        where.append(f"id NOT IN ({placeholders})")
        params.extend(exclude)

    clause = " AND ".join(where)
    with _connect() as conn:
        available = conn.execute(
            f"SELECT COUNT(*) FROM question_bank WHERE {clause}",
            params,
        ).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT * FROM question_bank
            WHERE {clause}
            ORDER BY RANDOM()
            LIMIT ?
            """,
            (*params, cnt),
        ).fetchall()

    return {
        "items": [_bank_row_to_dict(r) for r in rows],
        "requested": cnt,
        "returned": len(rows),
        "available": int(available),
    }


def confirm_import(
    import_id: str,
    *,
    item_ids: list[str] | None = None,
) -> dict[str, Any]:
    imp = get_import(import_id)
    if imp["status"] != "parsed":
        raise ValueError("仅 parsed 状态的批次可确认入库")
    items = list_import_items(import_id)
    if item_ids:
        allowed = {str(x).strip() for x in item_ids if str(x).strip()}
        items = [it for it in items if it["id"] in allowed]
    else:
        items = [it for it in items if it["selected"]]

    if not items:
        raise ValueError("请至少选择一道题目")

    now = utc_now_iso()
    inserted = 0
    skipped = 0
    duplicate_stems: list[str] = []

    with _connect() as conn:
        for it in items:
            sh = stem_hash(it["stem"])
            exists = conn.execute(
                "SELECT id FROM question_bank WHERE stem_hash = ? AND status = 'ready'",
                (sh,),
            ).fetchone()
            if exists:
                skipped += 1
                duplicate_stems.append(it["stem"][:80])
                continue
            qid = str(uuid4())
            conn.execute(
                """
                INSERT INTO question_bank (
                    id, import_id, import_item_id, category, question_type,
                    header, stem, options_json, answer, explanation,
                    extra_title, extra_text, status, stem_hash, sort_order,
                    used_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, '', ?, ?)
                """,
                (
                    qid,
                    import_id,
                    it["id"],
                    it["category"],
                    it["questionType"],
                    it["header"],
                    it["stem"],
                    json.dumps(it["options"], ensure_ascii=False),
                    it["answer"],
                    it["explanation"],
                    it["extraTitle"],
                    it["extraText"],
                    sh,
                    it["rowIndex"],
                    now,
                    now,
                ),
            )
            inserted += 1

        conn.execute(
            """
            UPDATE question_imports
            SET status = 'confirmed', confirmed_count = ?, confirmed_at = ?
            WHERE id = ?
            """,
            (inserted, now, import_id),
        )
        conn.commit()

    return {
        "ok": True,
        "importId": import_id,
        "inserted": inserted,
        "skippedDuplicates": skipped,
        "duplicateStems": duplicate_stems,
    }


def mark_questions_used(question_ids: list[str]) -> dict[str, Any]:
    """将题目标记为已使用（发布/导出后不再参与随机召回）。"""
    ids: list[str] = []
    seen: set[str] = set()
    for raw in question_ids:
        qid = str(raw or "").strip()
        if not qid or qid in seen:
            continue
        seen.add(qid)
        ids.append(qid)
    if not ids:
        return {"requested": 0, "marked": 0}

    now = utc_now_iso()
    marked = 0
    with _connect() as conn:
        for qid in ids:
            cur = conn.execute(
                """
                UPDATE question_bank
                SET used_at = ?, updated_at = ?
                WHERE id = ? AND status = 'ready'
                  AND (used_at IS NULL OR used_at = '')
                """,
                (now, now, qid),
            )
            marked += int(cur.rowcount or 0)
        conn.commit()
    return {"requested": len(ids), "marked": marked}
