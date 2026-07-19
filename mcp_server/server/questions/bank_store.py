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
from .real_exam import REAL_EXAM_KINDS_SET, canonical_exam_kind, normalize_real_exam_meta
from .tags import normalize_tags, tags_from_json, tags_to_json


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
        "subjectDomain": str(row["subject_domain"] or ""),
        "questionType": str(row["question_type"] or "single"),
        "header": str(row["header"] or ""),
        "stem": str(row["stem"] or ""),
        "options": [str(x) for x in options],
        "answer": str(row["answer"] or ""),
        "explanation": str(row["explanation"] or ""),
        "extraTitle": str(row["extra_title"] or ""),
        "extraText": str(row["extra_text"] or ""),
        "tags": tags_from_json(str(row["tags_json"] or "[]")),
        "isRealExam": bool(int(row["is_real_exam"] or 0)),
        "examYear": str(row["exam_year"] or ""),
        "examRegion": str(row["exam_region"] or ""),
        "examKind": canonical_exam_kind(str(row["exam_kind"] or "")),
        "status": str(row["status"] or ""),
        "sortOrder": int(row["sort_order"] or 0),
        "usedAt": str(row["used_at"] or ""),
        "createdAt": str(row["created_at"] or ""),
        "updatedAt": str(row["updated_at"] or ""),
    }


def _append_tags_filter(where: list[str], params: list[Any], tags: list[str] | None) -> None:
    for tag in normalize_tags(tags or []):
        where.append("tags_json LIKE ?")
        params.append(f'%"{tag}"%')


def _append_keyword_filter(where: list[str], params: list[Any], keyword: str) -> None:
    kw = str(keyword or "").strip()
    if not kw:
        return
    like = f"%{kw}%"
    where.append("(stem LIKE ? OR header LIKE ? OR explanation LIKE ? OR extra_text LIKE ?)")
    params.extend([like, like, like, like])


def list_questions(
    *,
    status: str = "ready",
    category: str = "",
    subject_domain: str = "",
    usage: str = "",
    tags: list[str] | None = None,
    keyword: str = "",
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    st = str(status or "ready").strip() or "ready"
    cat = str(category or "").strip()
    domain = str(subject_domain or "").strip()
    usage_key = str(usage or "").strip().lower()
    kw = str(keyword or "").strip()
    lim = max(1, min(int(limit), 500))
    off = max(0, int(offset))
    where = ["status = ?"]
    params: list[Any] = [st]
    if cat:
        where.append("category = ?")
        params.append(cat)
    if domain:
        where.append("subject_domain = ?")
        params.append(domain)
    if usage_key == "unused":
        where.append("(used_at IS NULL OR used_at = '')")
    elif usage_key == "used":
        where.append("used_at != ''")
    _append_tags_filter(where, params, tags)
    _append_keyword_filter(where, params, kw)

    base_where = ["status = ?"]
    base_params: list[Any] = [st]
    if cat:
        base_where.append("category = ?")
        base_params.append(cat)
    if domain:
        base_where.append("subject_domain = ?")
        base_params.append(domain)
    _append_tags_filter(base_where, base_params, tags)
    _append_keyword_filter(base_where, base_params, kw)
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
    subject_domain: str = "",
    tags: list[str] | None = None,
    real_exam_filter: str = "all",
    status: str = "ready",
) -> dict[str, Any]:
    cnt = max(1, min(int(count), 20))
    st = str(status or "ready").strip() or "ready"
    cat = str(category or "").strip()
    domain = str(subject_domain or "").strip()
    exclude = [str(x).strip() for x in (exclude_ids or []) if str(x).strip()]

    where = ["status = ?"]
    params: list[Any] = [st]
    if cat:
        where.append("category = ?")
        params.append(cat)
    if domain:
        where.append("subject_domain = ?")
        params.append(domain)
    where.append("(used_at IS NULL OR used_at = '')")
    exam_filt = str(real_exam_filter or "all").strip().lower()
    if exam_filt == "only":
        where.append("is_real_exam = 1")
    elif exam_filt == "exclude":
        where.append("is_real_exam = 0")
    _append_tags_filter(where, params, tags)
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


def get_question(question_id: str) -> dict[str, Any]:
    qid = str(question_id or "").strip()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM question_bank WHERE id = ?",
            (qid,),
        ).fetchone()
    if not row:
        raise ValueError("题目不存在")
    return _bank_row_to_dict(row)


def patch_question(question_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    qid = str(question_id or "").strip()
    current = get_question(qid)
    header = patch.get("header", current["header"])
    stem = str(patch.get("stem", current["stem"]) or "").strip()
    options = patch.get("options", current["options"])
    answer = str(patch.get("answer", current["answer"]) or "").strip().upper()
    explanation = patch.get("explanation", current["explanation"])
    extra_title = patch.get("extraTitle", patch.get("extra_title", current["extraTitle"]))
    extra_text = patch.get("extraText", patch.get("extra_text", current["extraText"]))
    category = patch.get("category", current["category"])
    subject_domain = patch.get(
        "subjectDomain", patch.get("subject_domain", current["subjectDomain"])
    )
    tags = patch.get("tags", current.get("tags"))
    if "isRealExam" in patch or "is_real_exam" in patch:
        is_real_exam = bool(patch.get("isRealExam", patch.get("is_real_exam")))
    else:
        is_real_exam = bool(current.get("isRealExam"))
    exam_year = str(
        patch.get("examYear", patch.get("exam_year", current.get("examYear"))) or ""
    )
    exam_region = str(
        patch.get("examRegion", patch.get("exam_region", current.get("examRegion")))
        or ""
    )
    exam_kind = str(
        patch.get("examKind", patch.get("exam_kind", current.get("examKind"))) or ""
    )
    year, region, kind = normalize_real_exam_meta(
        is_real_exam=is_real_exam,
        exam_year=exam_year,
        exam_region=exam_region,
        exam_kind=exam_kind,
    )
    real_exam_flag = 1 if is_real_exam else 0
    if not stem:
        raise ValueError("题干不能为空")
    opts = [str(x).strip() for x in (options or []) if str(x).strip()]
    if len(opts) < 2:
        raise ValueError("至少两个选项")
    if not answer:
        raise ValueError("答案不能为空")

    sh = stem_hash(stem)
    now = utc_now_iso()
    tag_json = tags_to_json(tags if tags is not None else current.get("tags") or [])

    with _connect() as conn:
        exists = conn.execute(
            """
            SELECT id FROM question_bank
            WHERE stem_hash = ? AND status = 'ready' AND id != ?
            """,
            (sh, qid),
        ).fetchone()
        if exists:
            raise ValueError("与已有题目题干重复，无法保存")
        conn.execute(
            """
            UPDATE question_bank SET
                header = ?, stem = ?, options_json = ?, answer = ?,
                explanation = ?, extra_title = ?, extra_text = ?,
                category = ?, subject_domain = ?, tags_json = ?,
                is_real_exam = ?, exam_year = ?, exam_region = ?, exam_kind = ?,
                stem_hash = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                str(header or ""),
                stem,
                json.dumps(opts, ensure_ascii=False),
                answer,
                str(explanation or ""),
                str(extra_title or ""),
                str(extra_text or ""),
                str(category or ""),
                str(subject_domain or ""),
                tag_json,
                real_exam_flag,
                year,
                region,
                kind,
                sh,
                now,
                qid,
            ),
        )
        conn.commit()
    return get_question(qid)


def delete_questions(question_ids: list[str]) -> dict[str, Any]:
    ids: list[str] = []
    seen: set[str] = set()
    for raw in question_ids:
        qid = str(raw or "").strip()
        if not qid or qid in seen:
            continue
        seen.add(qid)
        ids.append(qid)
    if not ids:
        return {"requested": 0, "deleted": 0}

    deleted = 0
    with _connect() as conn:
        for qid in ids:
            cur = conn.execute("DELETE FROM question_bank WHERE id = ?", (qid,))
            deleted += int(cur.rowcount or 0)
        conn.commit()
    return {"requested": len(ids), "deleted": deleted}


def _resolve_item_real_exam(
    it: dict[str, Any],
    *,
    batch_is_real: bool,
    batch_year: str,
    batch_region: str,
    batch_kind: str,
) -> tuple[int, str, str, str]:
    """单题解析来源优先，否则用批次真题配置。"""
    item_year = str(it.get("examYear") or "").strip()
    item_region = str(it.get("examRegion") or "").strip()
    item_kind = canonical_exam_kind(str(it.get("examKind") or ""))
    item_real = bool(it.get("isRealExam")) or bool(item_year or item_kind)

    if item_real:
        year = item_year or batch_year
        region = item_region or batch_region
        kind = item_kind or batch_kind
        if kind not in REAL_EXAM_KINDS_SET:
            if batch_kind in REAL_EXAM_KINDS_SET:
                kind = batch_kind
            else:
                raise ValueError(
                    f"第 {int(it.get('rowIndex') or 0) + 1} 题缺少有效考试类型，"
                    f"请在预览中补全或勾选批次真题配置"
                )
        y, r, k = normalize_real_exam_meta(
            is_real_exam=True,
            exam_year=year,
            exam_region=region,
            exam_kind=kind,
        )
        return 1, y, r, k

    if batch_is_real:
        y, r, k = normalize_real_exam_meta(
            is_real_exam=True,
            exam_year=batch_year,
            exam_region=batch_region,
            exam_kind=batch_kind,
        )
        return 1, y, r, k

    return 0, "", "", ""


def confirm_import(
    import_id: str,
    *,
    item_ids: list[str] | None = None,
    tags: list[str] | None = None,
    is_real_exam: bool = False,
    exam_year: str = "",
    exam_region: str = "",
    exam_kind: str = "",
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

    tag_json = tags_to_json(tags or [])
    batch_year = str(exam_year or "").strip()
    batch_region = str(exam_region or "").strip()
    batch_kind = canonical_exam_kind(str(exam_kind or ""))
    if is_real_exam:
        batch_year, batch_region, batch_kind = normalize_real_exam_meta(
            is_real_exam=True,
            exam_year=batch_year,
            exam_region=batch_region,
            exam_kind=batch_kind,
        )
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
            real_exam_flag, year, region, kind = _resolve_item_real_exam(
                it,
                batch_is_real=is_real_exam,
                batch_year=batch_year,
                batch_region=batch_region,
                batch_kind=batch_kind,
            )
            qid = str(uuid4())
            conn.execute(
                """
                INSERT INTO question_bank (
                    id, import_id, import_item_id, category, question_type,
                    header, stem, options_json, answer, explanation,
                    extra_title, extra_text, tags_json, subject_domain, is_real_exam,
                    exam_year, exam_region, exam_kind,
                    status, stem_hash, sort_order,
                    used_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, '', ?, ?)
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
                    tag_json,
                    str(it.get("subjectDomain") or ""),
                    real_exam_flag,
                    year,
                    region,
                    kind,
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
