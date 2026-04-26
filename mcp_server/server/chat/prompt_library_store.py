import sqlite3
from typing import Any
from uuid import uuid4

from .chat_memory_db import normalize_user_id, utc_now_iso
from .memory_store import _db_path, _init_db

_NAME_MAX = 128
_BODY_MAX = 512_000


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    _init_db(conn)
    return conn


def _preview(body: str, limit: int = 160) -> str:
    text = str(body or "")
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def fetch_style_body(*, user_id: str, agent: str, style_id: str) -> str | None:
    uid = normalize_user_id(user_id)
    aid = str(agent or "").strip()
    sid = str(style_id or "").strip()
    if not aid or not sid:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT s.body AS body
            FROM prompt_styles s
            JOIN prompt_categories c ON c.id = s.category_id
            WHERE s.id = ? AND c.user_id = ? AND c.agent = ?
            """,
            (sid, uid, aid),
        ).fetchone()
        if row is None:
            return None
        body = str(row["body"] or "").strip()
        return body or None


def list_prompt_library(*, user_id: str, agent: str, include_body: bool = False) -> dict[str, Any]:
    uid = normalize_user_id(user_id)
    aid = str(agent or "").strip()
    if not aid:
        raise ValueError("agent 不能为空")
    with _connect() as conn:
        cats = conn.execute(
            """
            SELECT id, name, sort_order, created_at, updated_at
            FROM prompt_categories
            WHERE user_id = ? AND agent = ?
            ORDER BY sort_order ASC, created_at ASC
            """,
            (uid, aid),
        ).fetchall()
        out_categories: list[dict[str, Any]] = []
        for c in cats:
            cid = str(c["id"])
            styles = conn.execute(
                """
                SELECT id, name, sort_order, created_at, updated_at, body
                FROM prompt_styles
                WHERE category_id = ?
                ORDER BY sort_order ASC, created_at ASC
                """,
                (cid,),
            ).fetchall()
            style_list: list[dict[str, Any]] = []
            for s in styles:
                body = str(s["body"] or "")
                item: dict[str, Any] = {
                    "id": str(s["id"]),
                    "name": str(s["name"]),
                    "sort_order": int(s["sort_order"] or 0),
                    "created_at": str(s["created_at"]),
                    "updated_at": str(s["updated_at"]),
                    "body_preview": _preview(body),
                }
                if include_body:
                    item["body"] = body
                style_list.append(item)
            out_categories.append(
                {
                    "id": cid,
                    "name": str(c["name"]),
                    "sort_order": int(c["sort_order"] or 0),
                    "created_at": str(c["created_at"]),
                    "updated_at": str(c["updated_at"]),
                    "styles": style_list,
                }
            )
        return {"categories": out_categories}


def _clamp_name(name: str) -> str:
    text = str(name or "").strip()
    if not text:
        raise ValueError("名称不能为空")
    if len(text) > _NAME_MAX:
        raise ValueError(f"名称长度不能超过 {_NAME_MAX}")
    return text


def _clamp_body(body: str) -> str:
    text = str(body or "")
    if len(text) > _BODY_MAX:
        raise ValueError(f"正文长度不能超过 {_BODY_MAX}")
    return text


def create_category(*, user_id: str, agent: str, name: str, sort_order: int | None = None) -> dict[str, Any]:
    uid = normalize_user_id(user_id)
    aid = str(agent or "").strip()
    if not aid:
        raise ValueError("agent 不能为空")
    nm = _clamp_name(name)
    now = utc_now_iso()
    cid = str(uuid4())
    so = 0 if sort_order is None else int(sort_order)
    with _connect() as conn:
        try:
            conn.execute(
                """
                INSERT INTO prompt_categories (id, user_id, agent, name, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (cid, uid, aid, nm, so, now, now),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("分类名称已存在") from exc
    return {"id": cid, "user_id": uid, "agent": aid, "name": nm, "sort_order": so, "created_at": now, "updated_at": now}


def update_category(
    *,
    user_id: str,
    category_id: str,
    name: str | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    uid = normalize_user_id(user_id)
    cid = str(category_id or "").strip()
    if not cid:
        raise ValueError("category_id 无效")
    fields: list[str] = []
    params: list[Any] = []
    if name is not None:
        fields.append("name = ?")
        params.append(_clamp_name(name))
    if sort_order is not None:
        fields.append("sort_order = ?")
        params.append(int(sort_order))
    if not fields:
        raise ValueError("没有可更新字段")
    now = utc_now_iso()
    fields.append("updated_at = ?")
    params.append(now)
    params.extend([cid, uid])
    row: sqlite3.Row | None = None
    with _connect() as conn:
        try:
            cur = conn.execute(
                f"UPDATE prompt_categories SET {', '.join(fields)} WHERE id = ? AND user_id = ?",
                params,
            )
            if cur.rowcount != 1:
                raise ValueError("分类不存在")
            row = conn.execute(
                """
                SELECT id, user_id, agent, name, sort_order, created_at, updated_at
                FROM prompt_categories WHERE id = ?
                """,
                (cid,),
            ).fetchone()
        except sqlite3.IntegrityError as exc:
            raise ValueError("分类名称已存在") from exc
        conn.commit()
    if row is None:
        raise ValueError("分类不存在")
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "agent": str(row["agent"]),
        "name": str(row["name"]),
        "sort_order": int(row["sort_order"] or 0),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def delete_category(*, user_id: str, category_id: str) -> None:
    uid = normalize_user_id(user_id)
    cid = str(category_id or "").strip()
    if not cid:
        raise ValueError("category_id 无效")
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM prompt_categories WHERE id = ? AND user_id = ?",
            (cid, uid),
        )
        conn.commit()
        if cur.rowcount != 1:
            raise ValueError("分类不存在")


def create_style(
    *,
    user_id: str,
    category_id: str,
    name: str,
    body: str,
    sort_order: int | None = None,
) -> dict[str, Any]:
    uid = normalize_user_id(user_id)
    cat_id = str(category_id or "").strip()
    if not cat_id:
        raise ValueError("category_id 无效")
    nm = _clamp_name(name)
    bd = _clamp_body(body)
    now = utc_now_iso()
    sid = str(uuid4())
    so = 0 if sort_order is None else int(sort_order)
    with _connect() as conn:
        row = conn.execute(
            "SELECT id FROM prompt_categories WHERE id = ? AND user_id = ?",
            (cat_id, uid),
        ).fetchone()
        if row is None:
            raise ValueError("分类不存在")
        try:
            conn.execute(
                """
                INSERT INTO prompt_styles (id, category_id, name, body, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (sid, cat_id, nm, bd, so, now, now),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("该分类下风格名称已存在") from exc
    return {
        "id": sid,
        "category_id": cat_id,
        "name": nm,
        "body": bd,
        "sort_order": so,
        "created_at": now,
        "updated_at": now,
    }


def update_style(
    *,
    user_id: str,
    style_id: str,
    name: str | None = None,
    body: str | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    uid = normalize_user_id(user_id)
    sid = str(style_id or "").strip()
    if not sid:
        raise ValueError("style_id 无效")
    fields: list[str] = []
    params: list[Any] = []
    if name is not None:
        fields.append("name = ?")
        params.append(_clamp_name(name))
    if body is not None:
        fields.append("body = ?")
        params.append(_clamp_body(body))
    if sort_order is not None:
        fields.append("sort_order = ?")
        params.append(int(sort_order))
    if not fields:
        raise ValueError("没有可更新字段")
    now = utc_now_iso()
    fields.append("updated_at = ?")
    params.append(now)
    params.extend([sid, uid])
    row: sqlite3.Row | None = None
    with _connect() as conn:
        try:
            cur = conn.execute(
                f"""
                UPDATE prompt_styles SET {", ".join(fields)}
                WHERE id = ? AND category_id IN (
                    SELECT id FROM prompt_categories WHERE user_id = ?
                )
                """,
                params,
            )
            if cur.rowcount != 1:
                raise ValueError("风格不存在")
            row = conn.execute(
                """
                SELECT s.id, s.category_id, s.name, s.body, s.sort_order, s.created_at, s.updated_at
                FROM prompt_styles s
                JOIN prompt_categories c ON c.id = s.category_id
                WHERE s.id = ? AND c.user_id = ?
                """,
                (sid, uid),
            ).fetchone()
        except sqlite3.IntegrityError as exc:
            raise ValueError("该分类下风格名称已存在") from exc
        conn.commit()
    if row is None:
        raise ValueError("风格不存在")
    return {
        "id": str(row["id"]),
        "category_id": str(row["category_id"]),
        "name": str(row["name"]),
        "body": str(row["body"]),
        "sort_order": int(row["sort_order"] or 0),
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def delete_style(*, user_id: str, style_id: str) -> None:
    uid = normalize_user_id(user_id)
    sid = str(style_id or "").strip()
    if not sid:
        raise ValueError("style_id 无效")
    with _connect() as conn:
        cur = conn.execute(
            """
            DELETE FROM prompt_styles
            WHERE id = ? AND category_id IN (
                SELECT id FROM prompt_categories WHERE user_id = ?
            )
            """,
            (sid, uid),
        )
        conn.commit()
        if cur.rowcount != 1:
            raise ValueError("风格不存在")
