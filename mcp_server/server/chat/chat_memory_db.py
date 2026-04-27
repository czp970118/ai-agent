import os
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

CHAT_MEMORY_TTL_HOURS = 24
USER_ID_MAX_LENGTH = 128


def normalize_user_id(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("user_id 不能为空")
    if len(text) > USER_ID_MAX_LENGTH:
        raise ValueError(f"user_id 长度超过 {USER_ID_MAX_LENGTH}")
    return text


def _chat_memory_db_path() -> Path:
    configured = os.getenv("CHAT_MEMORY_SQLITE_PATH", "").strip()
    if configured:
        path = Path(configured)
    else:
        path = Path(__file__).resolve().parents[2] / "data" / "chat_memory.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def parse_iso_utc(value: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError("empty datetime value")
    normalized = text.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt


def calculate_expires_at(last_active_at: str, ttl_hours: int = CHAT_MEMORY_TTL_HOURS) -> str:
    last_active = parse_iso_utc(last_active_at)
    return (last_active + timedelta(hours=ttl_hours)).isoformat()


def is_conversation_expired(last_active_at: str, now: datetime | None = None, ttl_hours: int = CHAT_MEMORY_TTL_HOURS) -> bool:
    current = now.astimezone(UTC) if isinstance(now, datetime) and now.tzinfo else now or datetime.now(UTC)
    if isinstance(current, datetime) and current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    expires_at = parse_iso_utc(calculate_expires_at(last_active_at, ttl_hours=ttl_hours))
    return current >= expires_at


def init_chat_memory_db(conn: sqlite3.Connection) -> None:
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
            created_at TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prompt_templates (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            agent TEXT NOT NULL,
            domain TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, agent, domain, name)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_prompt_templates_user_agent_domain
        ON prompt_templates(user_id, agent, domain, updated_at DESC)
        """
    )
    # 历史库升级：补齐 is_default 字段。
    columns = {
        str(row[1])  # pragma_table_info 第二列是 name
        for row in conn.execute("PRAGMA table_info(prompt_templates)").fetchall()
    }
    if "is_default" not in columns:
        conn.execute("ALTER TABLE prompt_templates ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_templates_one_default
        ON prompt_templates(user_id, agent, domain)
        WHERE is_default = 1
        """
    )


def get_chat_memory_connection() -> sqlite3.Connection:
    db_path = _chat_memory_db_path()
    conn = sqlite3.connect(db_path)
    init_chat_memory_db(conn)
    return conn
