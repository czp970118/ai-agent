"""创作中心作品：与提示词库共用 chat_memory SQLite（init_chat_memory_db）。"""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any
from uuid import uuid4

from .chat_memory_db import init_chat_memory_db, parse_iso_utc, utc_now_iso
from .memory_store import _db_path

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_TITLE_MAX = 512
_BODY_MAX = 512_000

_CW_SELECT = """
    id, title, prompt, body, domain, status, platform,
    cover_path, cover_source, cover_template_id, cover_ref_urls,
    cover_title_main, cover_title_sub,
    created_at, updated_at
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_chat_memory_db(conn)
    return conn


def _row_get(row: sqlite3.Row, key: str, default: str = "") -> str:
    keys = row.keys()
    if key not in keys:
        return default
    return str(row[key] if row[key] is not None else default)


def _parse_ref_urls(raw: str) -> list[str]:
    text = str(raw or "").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [str(x).strip() for x in data if str(x).strip()]


def _require_cover_path(path: str) -> str:
    p = str(path or "").strip()
    if not p:
        raise ValueError("封面图必填")
    return p


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    updated_ms = int(parse_iso_utc(str(row["updated_at"])).timestamp() * 1000)
    st = str(row["status"] or "").strip()
    pf = str(row["platform"] or "").strip()
    return {
        "id": str(row["id"]),
        "title": str(row["title"] or ""),
        "prompt": str(row["prompt"] or ""),
        "body": str(row["body"] or ""),
        "domain": str(row["domain"] or ""),
        "status": "ready" if st == "ready" else "draft",
        "platform": "douyin" if pf == "douyin" else "xhs",
        "coverPath": _row_get(row, "cover_path"),
        "coverSource": _row_get(row, "cover_source"),
        "coverTemplateId": _row_get(row, "cover_template_id"),
        "coverRefUrls": _parse_ref_urls(_row_get(row, "cover_ref_urls", "[]")),
        "coverTitleMain": _row_get(row, "cover_title_main"),
        "coverTitleSub": _row_get(row, "cover_title_sub"),
        "updatedAt": updated_ms,
    }


def list_creative_works() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT {_CW_SELECT}
            FROM creative_works
            ORDER BY updated_at DESC
            """
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_creative_work(work_id: str) -> dict[str, Any] | None:
    wid = str(work_id or "").strip()
    if not wid:
        return None
    with _connect() as conn:
        row = conn.execute(
            f"SELECT {_CW_SELECT} FROM creative_works WHERE id = ?",
            (wid,),
        ).fetchone()
    return _row_to_dict(row) if row else None


def create_creative_work(
    *,
    work_id: str | None,
    title: str,
    prompt: str = "",
    body: str = "",
    domain: str = "",
    status: str = "draft",
    platform: str = "xhs",
    cover_path: str = "",
    cover_source: str = "",
    cover_template_id: str = "",
    cover_ref_urls: list[str] | None = None,
    cover_title_main: str = "",
    cover_title_sub: str = "",
) -> dict[str, Any]:
    tid = str(title or "").strip() or "未命名作品"
    if len(tid) > _TITLE_MAX:
        raise ValueError(f"标题长度不能超过 {_TITLE_MAX}")
    pr = str(prompt or "")
    bd = str(body or "")
    if len(bd) > _BODY_MAX:
        raise ValueError(f"正文长度不能超过 {_BODY_MAX}")
    dom = str(domain or "").strip()
    st = "ready" if str(status or "").strip() == "ready" else "draft"
    pf = "douyin" if str(platform or "").strip() == "douyin" else "xhs"
    cp = _require_cover_path(cover_path)
    cs = str(cover_source or "").strip()
    if cs not in ("upload", "generated", "overlay", "quiz"):
        cs = "generated" if str(cover_template_id or "").strip() else "upload"
    ctid = str(cover_template_id or "").strip()
    refs = cover_ref_urls if isinstance(cover_ref_urls, list) else []
    refs_json = json.dumps([str(x).strip() for x in refs if str(x).strip()], ensure_ascii=False)
    wid = str(work_id or "").strip()
    if wid and not _UUID_RE.match(wid):
        raise ValueError("id 必须为 UUID")
    if not wid:
        wid = str(uuid4())
    now = utc_now_iso()
    with _connect() as conn:
        try:
            conn.execute(
                """
                INSERT INTO creative_works (
                    id, title, prompt, body, domain, status, platform,
                    cover_path, cover_source, cover_template_id, cover_ref_urls,
                    cover_title_main, cover_title_sub,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    wid,
                    tid,
                    pr,
                    bd,
                    dom,
                    st,
                    pf,
                    cp,
                    cs,
                    ctid,
                    refs_json,
                    str(cover_title_main or "").strip(),
                    str(cover_title_sub or "").strip(),
                    now,
                    now,
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("作品 id 已存在") from exc
    return get_creative_work(wid) or {}


def patch_creative_work(work_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    wid = str(work_id or "").strip()
    if not wid:
        raise ValueError("work_id 无效")
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM creative_works WHERE id = ?",
            (wid,),
        ).fetchone()
        if row is None:
            return None
        next_title = str(fields["title"]).strip() if "title" in fields else str(row["title"])
        if not next_title:
            next_title = "未命名作品"
        if len(next_title) > _TITLE_MAX:
            raise ValueError(f"标题长度不能超过 {_TITLE_MAX}")
        next_prompt = str(fields["prompt"]) if "prompt" in fields else str(row["prompt"] or "")
        next_body = str(fields["body"]) if "body" in fields else str(row["body"] or "")
        if len(next_body) > _BODY_MAX:
            raise ValueError(f"正文长度不能超过 {_BODY_MAX}")
        next_domain = str(fields["domain"]).strip() if "domain" in fields else str(row["domain"] or "")
        if "status" in fields:
            next_status = "ready" if str(fields["status"]).strip() == "ready" else "draft"
        else:
            next_status = str(row["status"] or "draft")
        if "platform" in fields:
            next_platform = "douyin" if str(fields["platform"]).strip() == "douyin" else "xhs"
        else:
            next_platform = str(row["platform"] or "xhs")
        if "coverPath" in fields:
            next_cover = _require_cover_path(str(fields["coverPath"]))
        else:
            next_cover = _row_get(row, "cover_path")
        if "coverSource" in fields:
            next_cover_source = str(fields["coverSource"] or "").strip()
        else:
            next_cover_source = _row_get(row, "cover_source")
        if "coverTemplateId" in fields:
            next_template_id = str(fields["coverTemplateId"] or "").strip()
        else:
            next_template_id = _row_get(row, "cover_template_id")
        if "coverRefUrls" in fields:
            refs = fields["coverRefUrls"]
            refs_list = refs if isinstance(refs, list) else []
            next_refs_json = json.dumps(
                [str(x).strip() for x in refs_list if str(x).strip()],
                ensure_ascii=False,
            )
        else:
            next_refs_json = _row_get(row, "cover_ref_urls", "[]")
        if "coverTitleMain" in fields:
            next_title_main = str(fields["coverTitleMain"] or "").strip()
        else:
            next_title_main = _row_get(row, "cover_title_main")
        if "coverTitleSub" in fields:
            next_title_sub = str(fields["coverTitleSub"] or "").strip()
        else:
            next_title_sub = _row_get(row, "cover_title_sub")
        now = utc_now_iso()
        conn.execute(
            """
            UPDATE creative_works SET
                title = ?, prompt = ?, body = ?, domain = ?,
                status = ?, platform = ?,
                cover_path = ?, cover_source = ?, cover_template_id = ?,
                cover_ref_urls = ?, cover_title_main = ?, cover_title_sub = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                next_title,
                next_prompt,
                next_body,
                next_domain,
                next_status,
                next_platform,
                next_cover,
                next_cover_source,
                next_template_id,
                next_refs_json,
                next_title_main,
                next_title_sub,
                now,
                wid,
            ),
        )
        conn.commit()
    return get_creative_work(wid)


def delete_creative_work(work_id: str) -> bool:
    wid = str(work_id or "").strip()
    if not wid:
        return False
    with _connect() as conn:
        cur = conn.execute("DELETE FROM creative_works WHERE id = ?", (wid,))
        conn.commit()
        return cur.rowcount == 1
