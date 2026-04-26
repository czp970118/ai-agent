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


def db_fetch_cached_payload(keyword: str, requirements: list[str], target_count: int) -> dict[str, Any] | None:
    query_tags = _build_query_tags(keyword, requirements)
    if not query_tags:
        return None
    db_path = _sqlite_db_path()
    now = _utc_now_iso()
    limit = max(int(target_count), 1)
    like_params = [f'%"{tag}"%' for tag in query_tags]
    where_expr = " OR ".join(["tags_json LIKE ?"] * len(like_params))
    with sqlite3.connect(db_path) as conn:
        _init_cache_db(conn)
        rows = conn.execute(
            """
            SELECT note_id, note_json, tags_json, used_count
            FROM xhs_note_cache
            WHERE """
            + where_expr
            + """
            ORDER BY used_count DESC, updated_at DESC
            LIMIT ?
            """,
            (*like_params, limit),
        ).fetchall()
        if not rows:
            return None
        notes: list[dict[str, Any]] = []
        hit_ids: list[str] = []
        for note_id, note_json, _tags_json, _used_count in rows:
            try:
                note_obj = json.loads(str(note_json or ""))
            except Exception:
                continue
            if isinstance(note_obj, dict):
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
            },
            "notes": notes,
        }


def db_upsert_query_cache(keyword: str, payload: dict[str, Any], requirements: list[str]) -> None:
    notes = payload.get("notes")
    if not isinstance(notes, list) or not notes:
        return
    query_tags = _build_query_tags(keyword, requirements)
    if not query_tags:
        return
    tags = _query_storage_tags(keyword, requirements, len(notes))
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
                "SELECT tags_json, used_count, created_at FROM xhs_note_cache WHERE note_id = ? LIMIT 1",
                (note_id,),
            ).fetchone()
            note_json = json.dumps(note, ensure_ascii=False)
            if row is None:
                conn.execute(
                    """
                    INSERT INTO xhs_note_cache (note_id, note_json, tags_json, query_terms_json, source, used_count, last_used_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'xhs_search', 0, NULL, ?, ?)
                    """,
                    (
                        note_id,
                        note_json,
                        json.dumps(tags, ensure_ascii=False),
                        json.dumps(query_tags, ensure_ascii=False),
                        now,
                        now,
                    ),
                )
                continue
            existing_tags_raw, used_count, created_at = row
            try:
                existing_tags = json.loads(str(existing_tags_raw or "[]"))
            except Exception:
                existing_tags = []
            merged_tags = _merge_tags(existing_tags if isinstance(existing_tags, list) else [], tags)
            conn.execute(
                """
                UPDATE xhs_note_cache
                SET note_json = ?, tags_json = ?, query_terms_json = ?, used_count = ?, created_at = ?, updated_at = ?
                WHERE note_id = ?
                """,
                (
                    note_json,
                    json.dumps(merged_tags, ensure_ascii=False),
                    json.dumps(query_tags, ensure_ascii=False),
                    int(used_count or 0),
                    str(created_at or now),
                    now,
                    note_id,
                ),
            )
        conn.commit()
