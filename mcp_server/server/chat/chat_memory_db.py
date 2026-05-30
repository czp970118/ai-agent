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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS creative_works (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            prompt TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            domain TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            platform TEXT NOT NULL DEFAULT 'xhs',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_creative_works_updated
        ON creative_works(updated_at DESC)
        """
    )
    cw_columns = {
        str(row[1])
        for row in conn.execute("PRAGMA table_info(creative_works)").fetchall()
    }
    for col_name, col_def in (
        ("cover_path", "TEXT NOT NULL DEFAULT ''"),
        ("cover_source", "TEXT NOT NULL DEFAULT ''"),
        ("cover_template_id", "TEXT NOT NULL DEFAULT ''"),
        ("cover_ref_urls", "TEXT NOT NULL DEFAULT '[]'"),
        ("cover_title_main", "TEXT NOT NULL DEFAULT ''"),
        ("cover_title_sub", "TEXT NOT NULL DEFAULT ''"),
    ):
        if col_name not in cw_columns:
            conn.execute(f"ALTER TABLE creative_works ADD COLUMN {col_name} {col_def}")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS question_imports (
            id TEXT PRIMARY KEY NOT NULL,
            filename TEXT NOT NULL DEFAULT '',
            mime_type TEXT NOT NULL DEFAULT '',
            file_size INTEGER NOT NULL DEFAULT 0,
            file_sha256 TEXT NOT NULL DEFAULT '',
            source_path TEXT NOT NULL DEFAULT '',
            extracted_text_path TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'uploaded',
            extract_error TEXT NOT NULL DEFAULT '',
            parse_error TEXT NOT NULL DEFAULT '',
            parse_result_json TEXT NOT NULL DEFAULT '{}',
            question_count INTEGER NOT NULL DEFAULT 0,
            confirmed_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            confirmed_at TEXT NOT NULL DEFAULT '',
            discarded_at TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_question_imports_created
        ON question_imports(created_at DESC)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS question_import_items (
            id TEXT PRIMARY KEY NOT NULL,
            import_id TEXT NOT NULL,
            row_index INTEGER NOT NULL DEFAULT 0,
            header TEXT NOT NULL DEFAULT '',
            stem TEXT NOT NULL DEFAULT '',
            options_json TEXT NOT NULL DEFAULT '[]',
            answer TEXT NOT NULL DEFAULT '',
            explanation TEXT NOT NULL DEFAULT '',
            extra_title TEXT NOT NULL DEFAULT '',
            extra_text TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            question_type TEXT NOT NULL DEFAULT 'single',
            subject_domain TEXT NOT NULL DEFAULT '',
            confidence REAL,
            selected INTEGER NOT NULL DEFAULT 1,
            edited INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (import_id) REFERENCES question_imports(id)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_question_import_items_import
        ON question_import_items(import_id, row_index ASC)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS question_bank (
            id TEXT PRIMARY KEY NOT NULL,
            import_id TEXT NOT NULL DEFAULT '',
            import_item_id TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            question_type TEXT NOT NULL DEFAULT 'single',
            header TEXT NOT NULL DEFAULT '',
            stem TEXT NOT NULL,
            options_json TEXT NOT NULL,
            answer TEXT NOT NULL,
            explanation TEXT NOT NULL DEFAULT '',
            extra_title TEXT NOT NULL DEFAULT '',
            extra_text TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]',
            subject_domain TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'ready',
            stem_hash TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            used_at TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_question_bank_status_created
        ON question_bank(status, created_at DESC)
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_stem_hash_ready
        ON question_bank(stem_hash)
        WHERE status = 'ready'
        """
    )
    qb_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(question_bank)").fetchall()}
    if "tags_json" not in qb_columns:
        conn.execute(
            "ALTER TABLE question_bank ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"
        )
    if "subject_domain" not in qb_columns:
        conn.execute(
            "ALTER TABLE question_bank ADD COLUMN subject_domain TEXT NOT NULL DEFAULT ''"
        )
    if "is_real_exam" not in qb_columns:
        conn.execute(
            "ALTER TABLE question_bank ADD COLUMN is_real_exam INTEGER NOT NULL DEFAULT 0"
        )
    if "exam_year" not in qb_columns:
        conn.execute(
            "ALTER TABLE question_bank ADD COLUMN exam_year TEXT NOT NULL DEFAULT ''"
        )
    if "exam_region" not in qb_columns:
        conn.execute(
            "ALTER TABLE question_bank ADD COLUMN exam_region TEXT NOT NULL DEFAULT ''"
        )
    if "exam_kind" not in qb_columns:
        conn.execute(
            "ALTER TABLE question_bank ADD COLUMN exam_kind TEXT NOT NULL DEFAULT ''"
        )
    conn.execute(
        "UPDATE question_bank SET exam_kind = '事业单位' WHERE exam_kind = '事业编'"
    )
    qi_columns = {
        str(row[1]) for row in conn.execute("PRAGMA table_info(question_import_items)").fetchall()
    }
    if "subject_domain" not in qi_columns:
        conn.execute(
            "ALTER TABLE question_import_items ADD COLUMN subject_domain TEXT NOT NULL DEFAULT ''"
        )


def get_chat_memory_connection() -> sqlite3.Connection:
    db_path = _chat_memory_db_path()
    conn = sqlite3.connect(db_path)
    init_chat_memory_db(conn)
    return conn
