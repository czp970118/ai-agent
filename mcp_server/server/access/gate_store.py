"""访问门禁：SQLite 存待审、通过、拒绝与一次性激活令牌。"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

_DB_PATH: Path | None = None


def _db_path() -> Path:
    global _DB_PATH
    if _DB_PATH is not None:
        return _DB_PATH
    import os

    raw = (os.getenv("ACCESS_GATE_SQLITE_PATH") or "").strip()
    if raw:
        _DB_PATH = Path(raw)
    else:
        _DB_PATH = Path(__file__).resolve().parents[2] / "data" / "access_gate.db"
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return _DB_PATH


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(_db_path()), timeout=30)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS access_pending (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                created_at REAL NOT NULL,
                UNIQUE(email)
            );
            CREATE TABLE IF NOT EXISTS access_approved (
                email TEXT PRIMARY KEY,
                approved_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS access_denied (
                email TEXT PRIMARY KEY,
                denied_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS access_activation (
                token TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                expires_at REAL NOT NULL
            );
            """
        )


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def get_status(email: str) -> str | None:
    """返回 approved | denied | pending | None"""
    e = normalize_email(email)
    if not e:
        return None
    init_db()
    with _conn() as c:
        if c.execute("SELECT 1 FROM access_approved WHERE email = ?", (e,)).fetchone():
            return "approved"
        if c.execute("SELECT 1 FROM access_denied WHERE email = ?", (e,)).fetchone():
            return "denied"
        if c.execute("SELECT 1 FROM access_pending WHERE email = ?", (e,)).fetchone():
            return "pending"
    return None


def add_pending(request_id: str, email: str) -> bool:
    """插入待审；若已 pending 返回 False（不重复插入）。"""
    e = normalize_email(email)
    init_db()
    now = time.time()
    with _conn() as c:
        try:
            c.execute(
                "INSERT INTO access_pending (id, email, created_at) VALUES (?, ?, ?)",
                (request_id, e, now),
            )
            return True
        except sqlite3.IntegrityError:
            return False


def remove_pending_by_id(request_id: str) -> str | None:
    """删除 pending 行并返回 email，若无则 None。"""
    init_db()
    with _conn() as c:
        row = c.execute("SELECT email FROM access_pending WHERE id = ?", (request_id,)).fetchone()
        if not row:
            return None
        email = str(row["email"])
        c.execute("DELETE FROM access_pending WHERE id = ?", (request_id,))
        return email


def remove_pending_by_email(email: str) -> None:
    e = normalize_email(email)
    init_db()
    with _conn() as c:
        c.execute("DELETE FROM access_pending WHERE email = ?", (e,))


def approve_email(email: str) -> None:
    e = normalize_email(email)
    init_db()
    now = time.time()
    with _conn() as c:
        c.execute("DELETE FROM access_pending WHERE email = ?", (e,))
        c.execute("DELETE FROM access_denied WHERE email = ?", (e,))
        c.execute(
            "INSERT OR REPLACE INTO access_approved (email, approved_at) VALUES (?, ?)",
            (e, now),
        )


def deny_email(email: str) -> None:
    e = normalize_email(email)
    init_db()
    now = time.time()
    with _conn() as c:
        c.execute("DELETE FROM access_pending WHERE email = ?", (e,))
        c.execute("DELETE FROM access_approved WHERE email = ?", (e,))
        c.execute(
            "INSERT OR REPLACE INTO access_denied (email, denied_at) VALUES (?, ?)",
            (e, now),
        )


def add_activation_token(token: str, email: str, ttl_seconds: float) -> None:
    init_db()
    exp = time.time() + ttl_seconds
    e = normalize_email(email)
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO access_activation (token, email, expires_at) VALUES (?, ?, ?)",
            (token, e, exp),
        )


def consume_activation_token(token: str) -> str | None:
    """一次性：成功返回 email，失败 None。"""
    if not token:
        return None
    init_db()
    now = time.time()
    with _conn() as c:
        row = c.execute(
            "SELECT email, expires_at FROM access_activation WHERE token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        if float(row["expires_at"]) < now:
            c.execute("DELETE FROM access_activation WHERE token = ?", (token,))
            return None
        email = str(row["email"])
        c.execute("DELETE FROM access_activation WHERE token = ?", (token,))
        return email
