import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _sqlite_db_path() -> Path:
    configured = os.getenv("XHS_SQLITE_PATH", "").strip()
    if configured:
        path = Path(configured)
    else:
        path = Path(__file__).resolve().parents[2] / "data" / "xhs_cache.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _merge_tags(old_tags: list[str], new_tags: list[str]) -> list[str]:
    out: list[str] = []
    for tag in [*old_tags, *new_tags]:
        value = str(tag or "").strip()
        if value and value not in out:
            out.append(value)
    return out


def _build_query_tags(keyword: str, requirements: list[str]) -> list[str]:
    tags: list[str] = []
    for raw in [keyword, *requirements]:
        text = str(raw or "").strip()
        if text and text not in tags:
            tags.append(text)
    return tags


def _normalize_domains(domains: list[str] | None) -> list[str]:
    out: list[str] = []
    for raw in domains or []:
        text = str(raw or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def _domain_filter_like_expr(domains: list[str]) -> tuple[str, list[str]]:
    if not domains:
        return "", []
    likes = [f'%"{domain}"%' for domain in domains]
    return " OR ".join(["domains_json LIKE ?"] * len(likes)), likes


def _query_storage_tags(keyword: str, requirements: list[str], note_count: int, *, referenced: bool = False) -> list[str]:
    query_tags = _build_query_tags(keyword, requirements)
    tags = [*query_tags, f"note_count:{note_count}", "status:ok" if note_count > 0 else "status:empty"]
    if referenced:
        tags.append("referenced:true")
    return tags


def _init_cache_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS xhs_note_cache (
            note_id TEXT PRIMARY KEY,
            note_json TEXT NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            domains_json TEXT NOT NULL DEFAULT '[]',
            city_name TEXT NOT NULL DEFAULT '',
            query_terms_json TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'xhs_search',
            used_count INTEGER NOT NULL DEFAULT 0,
            last_used_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_xhs_note_cache_updated_at ON xhs_note_cache(updated_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_xhs_note_cache_used_count ON xhs_note_cache(used_count DESC)"
    )
    # 历史库升级：补齐 domains_json 字段。
    columns = {
        str(row[1])
        for row in conn.execute("PRAGMA table_info(xhs_note_cache)").fetchall()
    }
    if "domains_json" not in columns:
        conn.execute("ALTER TABLE xhs_note_cache ADD COLUMN domains_json TEXT NOT NULL DEFAULT '[]'")
    if "city_name" not in columns:
        conn.execute("ALTER TABLE xhs_note_cache ADD COLUMN city_name TEXT NOT NULL DEFAULT ''")


def db_fetch_cached_payload(
    keyword: str,
    requirements: list[str],
    target_count: int,
    city_name: str = "",
    domains: list[str] | None = None,
) -> dict[str, Any] | None:
    query_tags = _build_query_tags(keyword, requirements)
    if not query_tags:
        return None
    keyword_text = str(keyword or "").strip()
    if not keyword_text:
        return None
    requirement_tags = [tag for tag in query_tags if tag != keyword_text]
    clean_domains = _normalize_domains(domains)
    clean_city_name = str(city_name or "").strip()
    is_travel_domain = "旅游" in clean_domains
    if is_travel_domain and not clean_city_name:
        # 旅游领域必须带城市名，不满足则不走缓存，避免串地名。
        return None
    db_path = _sqlite_db_path()
    now = _utc_now_iso()
    limit = max(int(target_count), 1)
    where_parts: list[str] = ["(query_terms_json LIKE ? OR note_json LIKE ?)"]
    where_args: list[Any] = [f'%"{keyword_text}"%', f"%{keyword_text}%"]
    if requirement_tags:
        requirement_likes = [f'%"{tag}"%' for tag in requirement_tags]
        where_parts.append("(" + " OR ".join(["query_terms_json LIKE ?"] * len(requirement_likes)) + ")")
        where_args.extend(requirement_likes)
    if is_travel_domain:
        where_parts.append("city_name = ?")
        where_args.append(clean_city_name)
    domain_expr, domain_params = _domain_filter_like_expr(clean_domains)
    full_where = " AND ".join(where_parts)
    if domain_expr:
        full_where += f" AND ({domain_expr})"
    with sqlite3.connect(db_path) as conn:
        _init_cache_db(conn)
        rows = conn.execute(
            """
            SELECT note_id, note_json, tags_json, domains_json, city_name, used_count
            FROM xhs_note_cache
            WHERE """
            + full_where
            + """
            ORDER BY used_count DESC, updated_at DESC
            LIMIT ?
            """,
            (*where_args, *domain_params, limit),
        ).fetchall()
        if not rows:
            return None
        notes: list[dict[str, Any]] = []
        hit_ids: list[str] = []
        for note_id, note_json, _tags_json, domains_json, row_city_name, _used_count in rows:
            try:
                note_obj = json.loads(str(note_json or ""))
            except Exception:
                continue
            if isinstance(note_obj, dict):
                try:
                    row_domains = json.loads(str(domains_json or "[]"))
                except Exception:
                    row_domains = []
                if not isinstance(row_domains, list):
                    row_domains = []
                note_obj["domains"] = [str(x).strip() for x in row_domains if str(x).strip()]
                note_obj["city_name"] = str(row_city_name or "").strip()
                notes.append(note_obj)
                hit_ids.append(str(note_id))
            if len(notes) >= limit:
                break
        if len(notes) < limit:
            return None
        referenced_tags = _query_storage_tags(keyword, requirements, len(notes), referenced=True)
        for note_id in hit_ids:
            row = conn.execute(
                "SELECT tags_json, used_count FROM xhs_note_cache WHERE note_id = ? LIMIT 1",
                (note_id,),
            ).fetchone()
            if row is None:
                continue
            old_tags_raw, used_count = row
            try:
                old_tags = json.loads(str(old_tags_raw or "[]"))
            except Exception:
                old_tags = []
            merged_tags = _merge_tags(old_tags if isinstance(old_tags, list) else [], referenced_tags)
            conn.execute(
                """
                UPDATE xhs_note_cache
                SET used_count = ?, last_used_at = ?, updated_at = ?, tags_json = ?
                WHERE note_id = ?
                """,
                (int(used_count or 0) + 1, now, now, json.dumps(merged_tags, ensure_ascii=False), note_id),
            )
        conn.commit()
        return {
            "ok": True,
            "params": {
                "topic": keyword,
                "requirements": requirements,
                "db_hit": True,
                "db_hit_count": len(notes),
                "db_tags": query_tags,
                "domains": clean_domains,
                "city_name": clean_city_name,
            },
            "notes": notes,
        }


def db_upsert_query_cache(
    keyword: str,
    payload: dict[str, Any],
    requirements: list[str],
    city_name: str = "",
    domains: list[str] | None = None,
) -> None:
    notes = payload.get("notes")
    if not isinstance(notes, list) or not notes:
        return
    query_tags = _build_query_tags(keyword, requirements)
    if not query_tags:
        return
    tags = _query_storage_tags(keyword, requirements, len(notes))
    clean_domains = _normalize_domains(domains)
    clean_city_name = str(city_name or "").strip()
    db_path = _sqlite_db_path()
    now = _utc_now_iso()
    with sqlite3.connect(db_path) as conn:
        _init_cache_db(conn)
        for note in notes:
            if not isinstance(note, dict):
                continue
            note_id = str(note.get("note_id") or "").strip()
            if not note_id:
                continue
            row = conn.execute(
                "SELECT tags_json, domains_json, city_name, used_count, created_at FROM xhs_note_cache WHERE note_id = ? LIMIT 1",
                (note_id,),
            ).fetchone()
            note["domains"] = clean_domains
            note["city_name"] = clean_city_name
            note_json = json.dumps(note, ensure_ascii=False)
            if row is None:
                conn.execute(
                    """
                    INSERT INTO xhs_note_cache (note_id, note_json, tags_json, domains_json, city_name, query_terms_json, source, used_count, last_used_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'xhs_search', 0, NULL, ?, ?)
                    """,
                    (
                        note_id,
                        note_json,
                        json.dumps(tags, ensure_ascii=False),
                        json.dumps(clean_domains, ensure_ascii=False),
                        clean_city_name,
                        json.dumps(query_tags, ensure_ascii=False),
                        now,
                        now,
                    ),
                )
                continue
            existing_tags_raw, existing_domains_raw, existing_city_name, used_count, created_at = row
            try:
                existing_tags = json.loads(str(existing_tags_raw or "[]"))
            except Exception:
                existing_tags = []
            try:
                existing_domains = json.loads(str(existing_domains_raw or "[]"))
            except Exception:
                existing_domains = []
            merged_tags = _merge_tags(existing_tags if isinstance(existing_tags, list) else [], tags)
            merged_domains = _merge_tags(
                existing_domains if isinstance(existing_domains, list) else [],
                clean_domains,
            )
            conn.execute(
                """
                UPDATE xhs_note_cache
                SET note_json = ?, tags_json = ?, domains_json = ?, city_name = ?, query_terms_json = ?, used_count = ?, created_at = ?, updated_at = ?
                WHERE note_id = ?
                """,
                (
                    note_json,
                    json.dumps(merged_tags, ensure_ascii=False),
                    json.dumps(merged_domains, ensure_ascii=False),
                    clean_city_name or str(existing_city_name or "").strip(),
                    json.dumps(query_tags, ensure_ascii=False),
                    int(used_count or 0),
                    str(created_at or now),
                    now,
                    note_id,
                ),
            )
        conn.commit()


def db_list_cached_notes(
    *,
    keyword: str = "",
    tag: str = "",
    domains: list[str] | None = None,
    sort_by: str = "",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    q = str(keyword or "").strip()
    t = str(tag or "").strip()
    clean_domains: list[str] = []
    for raw in domains or []:
        value = str(raw or "").strip()
        if value and value not in clean_domains:
            clean_domains.append(value)
    page_size = max(1, min(int(limit), 100))
    page_offset = max(0, int(offset))
    db_path = _sqlite_db_path()
    with sqlite3.connect(db_path) as conn:
        _init_cache_db(conn)
        where_parts: list[str] = []
        where_args: list[Any] = []
        if q:
            where_parts.append("note_json LIKE ?")
            where_args.append(f"%{q}%")
        if t:
            where_parts.append("tags_json LIKE ?")
            where_args.append(f'%"{t}"%')
        if clean_domains:
            where_parts.append("(" + " OR ".join(["domains_json LIKE ?"] * len(clean_domains)) + ")")
            where_args.extend([f'%"{d}"%' for d in clean_domains])
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

        total = conn.execute(
            f"SELECT COUNT(1) FROM xhs_note_cache {where_sql}",
            tuple(where_args),
        ).fetchone()
        total_count = int(total[0] if total else 0)

        sort_key = str(sort_by or "").strip()
        metric_expr_map = {
            "like_count": "CAST(COALESCE(json_extract(note_json, '$.like_count'), 0) AS INTEGER)",
            "collect_count": "CAST(COALESCE(json_extract(note_json, '$.collect_count'), 0) AS INTEGER)",
            "comment_count": "CAST(COALESCE(json_extract(note_json, '$.comment_count'), 0) AS INTEGER)",
        }
        metric_expr = metric_expr_map.get(sort_key)
        order_sql = (
            f"ORDER BY {metric_expr} DESC, updated_at DESC"
            if metric_expr
            else "ORDER BY updated_at DESC"
        )

        rows = conn.execute(
            f"""
            SELECT note_id, note_json, tags_json, domains_json, query_terms_json, used_count, last_used_at, updated_at
            FROM xhs_note_cache
            {where_sql}
            {order_sql}
            LIMIT ? OFFSET ?
            """,
            (*where_args, page_size, page_offset),
        ).fetchall()

    items: list[dict[str, Any]] = []
    for row in rows:
        note_id, note_json, tags_json, domains_json, query_terms_json, used_count, last_used_at, updated_at = row
        try:
            note = json.loads(str(note_json or "{}"))
        except Exception:
            note = {}
        if not isinstance(note, dict):
            note = {}
        try:
            tags = json.loads(str(tags_json or "[]"))
        except Exception:
            tags = []
        if not isinstance(tags, list):
            tags = []
        try:
            domains = json.loads(str(domains_json or "[]"))
        except Exception:
            domains = []
        if not isinstance(domains, list):
            domains = []
        try:
            query_terms = json.loads(str(query_terms_json or "[]"))
        except Exception:
            query_terms = []
        if not isinstance(query_terms, list):
            query_terms = []

        items.append(
            {
                "note_id": str(note.get("note_id") or note_id or ""),
                "title": str(note.get("title") or ""),
                "url": str(note.get("note_url") or note.get("url") or ""),
                "image_list": note.get("image_list") if isinstance(note.get("image_list"), list) else [],
                "content_text": str(note.get("content_text") or ""),
                "like_count": note.get("like_count"),
                "collect_count": note.get("collect_count"),
                "comment_count": note.get("comment_count"),
                "author_name": note.get("author_name"),
                "updated_at": str(updated_at or ""),
                "last_used_at": str(last_used_at or ""),
                "used_count": int(used_count or 0),
                "tags": tags,
                "domains": domains,
                "city_name": str(note.get("city_name") or ""),
                "query_terms": query_terms,
            }
        )
    return {
        "items": items,
        "total": total_count,
        "limit": page_size,
        "offset": page_offset,
    }


def db_get_cached_note(note_id: str) -> dict[str, Any] | None:
    target_id = str(note_id or "").strip()
    if not target_id:
        return None
    db_path = _sqlite_db_path()
    with sqlite3.connect(db_path) as conn:
        _init_cache_db(conn)
        row = conn.execute(
            """
            SELECT note_id, note_json, tags_json, domains_json, query_terms_json, used_count, last_used_at, updated_at
            FROM xhs_note_cache
            WHERE note_id = ?
            LIMIT 1
            """,
            (target_id,),
        ).fetchone()
    if row is None:
        return None
    note_id_value, note_json, tags_json, domains_json, query_terms_json, used_count, last_used_at, updated_at = row
    try:
        note = json.loads(str(note_json or "{}"))
    except Exception:
        note = {}
    if not isinstance(note, dict):
        note = {}
    try:
        tags = json.loads(str(tags_json or "[]"))
    except Exception:
        tags = []
    if not isinstance(tags, list):
        tags = []
    try:
        domains = json.loads(str(domains_json or "[]"))
    except Exception:
        domains = []
    if not isinstance(domains, list):
        domains = []
    try:
        query_terms = json.loads(str(query_terms_json or "[]"))
    except Exception:
        query_terms = []
    if not isinstance(query_terms, list):
        query_terms = []
    return {
        "note_id": str(note.get("note_id") or note_id_value or ""),
        "title": str(note.get("title") or ""),
        "url": str(note.get("note_url") or note.get("url") or ""),
        "image_list": note.get("image_list") if isinstance(note.get("image_list"), list) else [],
        "city_name": str(note.get("city_name") or ""),
        "content_text": str(note.get("content_text") or ""),
        "like_count": note.get("like_count"),
        "collect_count": note.get("collect_count"),
        "comment_count": note.get("comment_count"),
        "author_name": note.get("author_name"),
        "updated_at": str(updated_at or ""),
        "last_used_at": str(last_used_at or ""),
        "used_count": int(used_count or 0),
        "tags": tags,
        "domains": domains,
        "query_terms": query_terms,
    }


def db_update_cached_note(
    note_id: str,
    *,
    title: str,
    content_text: str,
    tags: list[str],
    domains: list[str],
    city_name: str,
    image_list: list[str],
) -> dict[str, Any] | None:
    target_id = str(note_id or "").strip()
    if not target_id:
        return None
    clean_tags: list[str] = []
    for raw in tags:
        value = str(raw or "").strip()
        if value and value not in clean_tags:
            clean_tags.append(value)
    clean_domains: list[str] = []
    for raw in domains:
        value = str(raw or "").strip()
        if value and value not in clean_domains:
            clean_domains.append(value)
    clean_images: list[str] = []
    for raw in image_list:
        value = str(raw or "").strip()
        if value and value not in clean_images:
            clean_images.append(value)
    db_path = _sqlite_db_path()
    now = _utc_now_iso()
    with sqlite3.connect(db_path) as conn:
        _init_cache_db(conn)
        row = conn.execute(
            "SELECT note_json, query_terms_json, used_count, last_used_at, created_at FROM xhs_note_cache WHERE note_id = ? LIMIT 1",
            (target_id,),
        ).fetchone()
        if row is None:
            return None
        note_json, query_terms_json, used_count, last_used_at, created_at = row
        try:
            note = json.loads(str(note_json or "{}"))
        except Exception:
            note = {}
        if not isinstance(note, dict):
            note = {}
        note["note_id"] = target_id
        note["title"] = title
        note["content_text"] = content_text
        note["domains"] = clean_domains
        note["city_name"] = str(city_name or "").strip()
        note["image_list"] = clean_images
        conn.execute(
            """
            UPDATE xhs_note_cache
            SET note_json = ?, tags_json = ?, domains_json = ?, query_terms_json = ?, used_count = ?, last_used_at = ?, created_at = ?, updated_at = ?
            WHERE note_id = ?
            """,
            (
                json.dumps(note, ensure_ascii=False),
                json.dumps(clean_tags, ensure_ascii=False),
                json.dumps(clean_domains, ensure_ascii=False),
                str(query_terms_json or "[]"),
                int(used_count or 0),
                str(last_used_at or ""),
                str(created_at or now),
                now,
                target_id,
            ),
        )
        conn.commit()
    return db_get_cached_note(target_id)


def db_delete_cached_note(note_id: str) -> bool:
    target_id = str(note_id or "").strip()
    if not target_id:
        return False
    db_path = _sqlite_db_path()
    with sqlite3.connect(db_path) as conn:
        _init_cache_db(conn)
        cursor = conn.execute("DELETE FROM xhs_note_cache WHERE note_id = ?", (target_id,))
        conn.commit()
        return int(cursor.rowcount or 0) > 0
