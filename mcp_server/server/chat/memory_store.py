import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


DEFAULT_TTL_HOURS = 24


def _db_path() -> Path:
    configured = os.getenv("CHAT_MEMORY_SQLITE_PATH", "").strip()
    if configured:
        path = Path(configured)
    else:
        path = Path(__file__).resolve().parents[2] / "data" / "chat_memory.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _expires_at_iso(now: datetime, ttl_hours: int) -> str:
    return (now + timedelta(hours=max(ttl_hours, 1))).isoformat()


def _init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            agent TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            last_active_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            meta_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_conv_user_agent_active
        ON chat_conversations(user_id, agent, status, last_active_at DESC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_msg_conv_created
        ON chat_messages(conversation_id, created_at ASC)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prompt_categories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            agent TEXT NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, agent, name)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prompt_styles (
            id TEXT PRIMARY KEY,
            category_id TEXT NOT NULL,
            name TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (category_id) REFERENCES prompt_categories(id) ON DELETE CASCADE,
            UNIQUE(category_id, name)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_prompt_cat_user_agent
        ON prompt_categories(user_id, agent, sort_order ASC, created_at ASC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_prompt_style_category
        ON prompt_styles(category_id, sort_order ASC, created_at ASC)
        """
    )


def _row_to_conversation(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "agent": row["agent"],
        "title": row["title"],
        "status": row["status"],
        "last_active_at": row["last_active_at"],
        "expires_at": row["expires_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _create_conversation(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    agent: str,
    ttl_hours: int = DEFAULT_TTL_HOURS,
) -> dict[str, Any]:
    now = _utc_now()
    now_iso = now.isoformat()
    conversation_id = str(uuid4())
    record = {
        "id": conversation_id,
        "user_id": user_id,
        "agent": agent,
        "title": "",
        "status": "active",
        "last_active_at": now_iso,
        "expires_at": _expires_at_iso(now, ttl_hours),
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    conn.execute(
        """
        INSERT INTO chat_conversations
        (id, user_id, agent, title, status, last_active_at, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record["id"],
            record["user_id"],
            record["agent"],
            record["title"],
            record["status"],
            record["last_active_at"],
            record["expires_at"],
            record["created_at"],
            record["updated_at"],
        ),
    )
    return record


def resolve_conversation(
    *,
    user_id: str,
    agent: str,
    force_new: bool = False,
    ttl_hours: int = DEFAULT_TTL_HOURS,
) -> dict[str, Any]:
    clean_user_id = str(user_id or "").strip()
    clean_agent = str(agent or "").strip()
    if not clean_user_id:
        raise ValueError("user_id is required")
    if not clean_agent:
        raise ValueError("agent is required")

    db_path = _db_path()
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        _init_db(conn)
        row = conn.execute(
            """
            SELECT id, user_id, agent, title, status, last_active_at, expires_at, created_at, updated_at
            FROM chat_conversations
            WHERE user_id = ? AND agent = ? AND status = 'active'
            ORDER BY last_active_at DESC
            LIMIT 1
            """,
            (clean_user_id, clean_agent),
        ).fetchone()

        now = _utc_now()
        replaced_expired = False
        if row is not None and not force_new:
            expires_at = _parse_iso(row["expires_at"])
            if expires_at is not None and expires_at > now:
                return {
                    "conversation": _row_to_conversation(row),
                    "is_new": False,
                    "is_expired_replaced": False,
                }
            replaced_expired = True

        conversation = _create_conversation(
            conn,
            user_id=clean_user_id,
            agent=clean_agent,
            ttl_hours=ttl_hours,
        )
        conn.commit()
        return {
            "conversation": conversation,
            "is_new": True,
            "is_expired_replaced": replaced_expired and not force_new,
        }


def list_conversations(*, user_id: str, agent: str, limit: int = 20) -> list[dict[str, Any]]:
    clean_user_id = str(user_id or "").strip()
    clean_agent = str(agent or "").strip()
    if not clean_user_id:
        raise ValueError("user_id is required")
    if not clean_agent:
        raise ValueError("agent is required")
    db_path = _db_path()
    safe_limit = max(1, min(int(limit), 100))
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        _init_db(conn)
        rows = conn.execute(
            """
            SELECT id, user_id, agent, title, status, last_active_at, expires_at, created_at, updated_at
            FROM chat_conversations
            WHERE user_id = ? AND agent = ?
            ORDER BY last_active_at DESC
            LIMIT ?
            """,
            (clean_user_id, clean_agent, safe_limit),
        ).fetchall()
    return [_row_to_conversation(row) for row in rows]


def fetch_messages(*, conversation_id: str) -> list[dict[str, Any]]:
    clean_id = str(conversation_id or "").strip()
    if not clean_id:
        raise ValueError("conversation_id is required")
    db_path = _db_path()
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        _init_db(conn)
        rows = conn.execute(
            """
            SELECT id, conversation_id, role, content, meta_json, created_at
            FROM chat_messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
            """,
            (clean_id,),
        ).fetchall()

    out: list[dict[str, Any]] = []
    for row in rows:
        raw_meta = row["meta_json"]
        try:
            parsed_meta = json.loads(str(raw_meta or "{}"))
        except Exception:
            parsed_meta = {}
        out.append(
            {
                "id": row["id"],
                "conversation_id": row["conversation_id"],
                "role": row["role"],
                "content": row["content"],
                "meta": parsed_meta if isinstance(parsed_meta, dict) else {},
                "created_at": row["created_at"],
            }
        )
    return out


def append_messages(
    *,
    conversation_id: str,
    messages: list[dict[str, Any]],
    ttl_hours: int = DEFAULT_TTL_HOURS,
) -> int:
    clean_id = str(conversation_id or "").strip()
    if not clean_id:
        raise ValueError("conversation_id is required")
    if not isinstance(messages, list) or not messages:
        return 0

    now = _utc_now()
    now_iso = now.isoformat()
    db_path = _db_path()
    inserted = 0
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        _init_db(conn)
        exists = conn.execute(
            "SELECT id FROM chat_conversations WHERE id = ? LIMIT 1",
            (clean_id,),
        ).fetchone()
        if exists is None:
            raise ValueError("conversation not found")

        for item in messages:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            content = str(item.get("content") or "")
            if role not in {"user", "assistant", "system"}:
                continue
            if not content.strip():
                continue
            meta = item.get("meta")
            if not isinstance(meta, dict):
                meta = {}
            conn.execute(
                """
                INSERT INTO chat_messages (id, conversation_id, role, content, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    clean_id,
                    role,
                    content,
                    json.dumps(meta, ensure_ascii=False),
                    now_iso,
                ),
            )
            inserted += 1

        if inserted > 0:
            conn.execute(
                """
                UPDATE chat_conversations
                SET last_active_at = ?, expires_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    now_iso,
                    _expires_at_iso(now, ttl_hours),
                    now_iso,
                    clean_id,
                ),
            )
        conn.commit()
    return inserted
