import sqlite3
from typing import Any
from uuid import uuid4

from .chat_memory_db import init_chat_memory_db, utc_now_iso
from .memory_store import _db_path

_NAME_MAX = 128
_BODY_MAX = 512_000

_CATEGORY_ID_SEP = "::"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_chat_memory_db(conn)
    return conn


def _preview(body: str, limit: int = 160) -> str:
    text = str(body or "")
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def _encode_category_id(agent: str, domain: str) -> str:
    return f"{agent.strip()}{_CATEGORY_ID_SEP}{domain.strip()}"


def _decode_category_id(category_id: str) -> tuple[str, str]:
    raw = str(category_id or "").strip()
    if _CATEGORY_ID_SEP not in raw:
        raise ValueError("category_id 无效")
    agent, domain = raw.split(_CATEGORY_ID_SEP, 1)
    aid = agent.strip()
    d = domain.strip()
    if not aid or not d:
        raise ValueError("category_id 无效")
    return aid, d


def fetch_style_body(*, user_id: str, agent: str, style_id: str) -> str | None:
    aid = str(agent or "").strip()
    sid = str(style_id or "").strip()
    if not aid or not sid:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT content AS body
            FROM prompt_templates
            WHERE id = ? AND agent = ?
            """,
            (sid, aid),
        ).fetchone()
        if row is None:
            return None
        body = str(row["body"] or "").strip()
        return body or None


def list_prompt_library(*, user_id: str, agent: str, include_body: bool = False, domain: str = "") -> dict[str, Any]:
    aid = str(agent or "").strip()
    d = str(domain or "").strip()
    if not aid:
        raise ValueError("agent 不能为空")
    with _connect() as conn:
        if d:
            rows = conn.execute(
                """
                SELECT id, domain, name, content, is_default, created_at, updated_at
                FROM prompt_templates
                WHERE agent = ? AND domain = ?
                ORDER BY domain ASC, created_at ASC
                """,
                (aid, d),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, domain, name, content, is_default, created_at, updated_at
                FROM prompt_templates
                WHERE agent = ?
                ORDER BY domain ASC, created_at ASC
                """,
                (aid,),
            ).fetchall()
    grouped: dict[str, list[sqlite3.Row]] = {}
    for row in rows:
        domain = str(row["domain"] or "").strip()
        if not domain:
            continue
        grouped.setdefault(domain, []).append(row)
    out_categories: list[dict[str, Any]] = []
    for domain, domain_rows in grouped.items():
        style_list: list[dict[str, Any]] = []
        for s in domain_rows:
            body = str(s["content"] or "")
            item: dict[str, Any] = {
                "id": str(s["id"]),
                "name": str(s["name"]),
                "sort_order": 0,
                "is_default": bool(int(s["is_default"] or 0)),
                "created_at": str(s["created_at"]),
                "updated_at": str(s["updated_at"]),
                "body_preview": _preview(body),
            }
            if include_body:
                item["body"] = body
            style_list.append(item)
        first = domain_rows[0]
        out_categories.append(
            {
                "id": _encode_category_id(aid, domain),
                "name": domain,
                "sort_order": 0,
                "created_at": str(first["created_at"]),
                "updated_at": str(first["updated_at"]),
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
    aid = str(agent or "").strip()
    if not aid:
        raise ValueError("agent 不能为空")
    nm = _clamp_name(name)
    now = utc_now_iso()
    category_id = _encode_category_id(aid, nm)
    return {
        "id": category_id,
        "agent": aid,
        "name": nm,
        "sort_order": 0 if sort_order is None else int(sort_order),
        "created_at": now,
        "updated_at": now,
    }


def update_category(
    *,
    user_id: str,
    category_id: str,
    name: str | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    aid, old_domain = _decode_category_id(category_id)
    new_domain = _clamp_name(name) if name is not None else old_domain
    if new_domain == old_domain and sort_order is None:
        raise ValueError("没有可更新字段")
    now = utc_now_iso()
    with _connect() as conn:
        try:
            cur = conn.execute(
                """
                UPDATE prompt_templates
                SET domain = ?, updated_at = ?
                WHERE agent = ? AND domain = ?
                """,
                (new_domain, now, aid, old_domain),
            )
            if cur.rowcount < 1:
                raise ValueError("分类不存在")
        except sqlite3.IntegrityError as exc:
            raise ValueError("分类名称已存在") from exc
        conn.commit()
    return {
        "id": _encode_category_id(aid, new_domain),
        "agent": aid,
        "name": new_domain,
        "sort_order": 0 if sort_order is None else int(sort_order),
        "created_at": now,
        "updated_at": now,
    }


def delete_category(*, user_id: str, category_id: str) -> None:
    aid, domain = _decode_category_id(category_id)
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM prompt_templates WHERE agent = ? AND domain = ?",
            (aid, domain),
        )
        conn.commit()
        if cur.rowcount < 1:
            raise ValueError("分类不存在")


def create_style(
    *,
    user_id: str,
    category_id: str,
    name: str,
    body: str,
    is_default: bool = False,
    sort_order: int | None = None,
) -> dict[str, Any]:
    aid, domain = _decode_category_id(category_id)
    nm = _clamp_name(name)
    bd = _clamp_body(body)
    now = utc_now_iso()
    sid = str(uuid4())
    so = 0 if sort_order is None else int(sort_order)
    with _connect() as conn:
        try:
            if is_default:
                conn.execute(
                    """
                    UPDATE prompt_templates
                    SET is_default = 0, updated_at = ?
                    WHERE agent = ? AND domain = ?
                    """,
                    (now, aid, domain),
                )
            conn.execute(
                """
                INSERT INTO prompt_templates (id, user_id, agent, domain, name, content, is_default, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (sid, "__global__", aid, domain, nm, bd, 1 if is_default else 0, now, now),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("该分类下风格名称已存在") from exc
    return {
        "id": sid,
        "category_id": _encode_category_id(aid, domain),
        "name": nm,
        "body": bd,
        "is_default": bool(is_default),
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
    is_default: bool | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
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
    if is_default is not None:
        fields.append("is_default = ?")
        params.append(1 if is_default else 0)
    if sort_order is not None:
        # 单表结构下暂不持久化排序字段，保持向后兼容但不报错。
        pass
    if not fields:
        raise ValueError("没有可更新字段")
    now = utc_now_iso()
    fields.append("updated_at = ?")
    params.append(now)
    params.append(sid)
    row: sqlite3.Row | None = None
    with _connect() as conn:
        try:
            if is_default is True:
                scope = conn.execute(
                    """
                    SELECT agent, domain FROM prompt_templates
                    WHERE id = ?
                    LIMIT 1
                    """,
                    (sid,),
                ).fetchone()
                if scope is None:
                    raise ValueError("风格不存在")
                conn.execute(
                    """
                    UPDATE prompt_templates
                    SET is_default = 0, updated_at = ?
                    WHERE agent = ? AND domain = ? AND id <> ?
                    """,
                    (now, str(scope["agent"]), str(scope["domain"]), sid),
                )
            cur = conn.execute(
                f"""
                UPDATE prompt_templates SET {", ".join(fields).replace("body", "content")}
                WHERE id = ?
                """,
                params,
            )
            if cur.rowcount != 1:
                raise ValueError("风格不存在")
            row = conn.execute(
                """
                SELECT id, agent, domain, name, content, is_default, created_at, updated_at
                FROM prompt_templates
                WHERE id = ?
                """,
                (sid,),
            ).fetchone()
        except sqlite3.IntegrityError as exc:
            raise ValueError("该分类下风格名称已存在") from exc
        conn.commit()
    if row is None:
        raise ValueError("风格不存在")
    return {
        "id": str(row["id"]),
        "category_id": _encode_category_id(str(row["agent"]), str(row["domain"])),
        "name": str(row["name"]),
        "body": str(row["content"]),
        "is_default": bool(int(row["is_default"] or 0)),
        "sort_order": 0,
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


def delete_style(*, user_id: str, style_id: str) -> None:
    sid = str(style_id or "").strip()
    if not sid:
        raise ValueError("style_id 无效")
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM prompt_templates WHERE id = ?",
            (sid,),
        )
        conn.commit()
        if cur.rowcount != 1:
            raise ValueError("风格不存在")
