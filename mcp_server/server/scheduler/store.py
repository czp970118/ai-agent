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


class SchedulerStore:
    """通用调度状态/执行日志存储，可按 source 复用。"""

    def __init__(self, source: str) -> None:
        text = str(source or "").strip().lower()
        self.source = text or "default"

    def _init_tables(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scheduler_state (
                source TEXT NOT NULL,
                state_key TEXT NOT NULL,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (source, state_key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scheduler_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                run_date TEXT NOT NULL,
                slot_time TEXT NOT NULL,
                subject TEXT NOT NULL DEFAULT '',
                labels_json TEXT NOT NULL DEFAULT '[]',
                total_count INTEGER NOT NULL DEFAULT 0,
                before_count INTEGER NOT NULL DEFAULT 0,
                after_count INTEGER NOT NULL DEFAULT 0,
                inserted_count INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                errors_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_scheduler_runs_source_date_time ON scheduler_runs(source, run_date DESC, slot_time DESC)"
        )

    def load_state(self, key: str = "scheduler") -> dict[str, Any]:
        db_path = _sqlite_db_path()
        with sqlite3.connect(db_path) as conn:
            self._init_tables(conn)
            row = conn.execute(
                "SELECT value_json FROM scheduler_state WHERE source = ? AND state_key = ? LIMIT 1",
                (self.source, key),
            ).fetchone()
        if row is None:
            return {}
        raw = str(row[0] or "{}")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {}
        return payload if isinstance(payload, dict) else {}

    def save_state(self, state: dict[str, Any], key: str = "scheduler") -> None:
        payload = state if isinstance(state, dict) else {}
        now = _utc_now_iso()
        db_path = _sqlite_db_path()
        with sqlite3.connect(db_path) as conn:
            self._init_tables(conn)
            conn.execute(
                """
                INSERT INTO scheduler_state (source, state_key, value_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(source, state_key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at
                """,
                (self.source, key, json.dumps(payload, ensure_ascii=False), now),
            )
            conn.commit()

    def append_run_log(
        self,
        *,
        run_date: str,
        slot_time: str,
        subject: str,
        labels: list[str],
        total_count: int,
        before_count: int,
        after_count: int,
        success_count: int,
        failed_count: int,
        errors: list[str],
    ) -> None:
        db_path = _sqlite_db_path()
        now = _utc_now_iso()
        with sqlite3.connect(db_path) as conn:
            self._init_tables(conn)
            conn.execute(
                """
                INSERT INTO scheduler_runs (
                    source, run_date, slot_time, subject, labels_json, total_count, before_count, after_count,
                    inserted_count, success_count, failed_count, errors_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.source,
                    run_date,
                    slot_time,
                    subject,
                    json.dumps(labels, ensure_ascii=False),
                    int(total_count),
                    int(before_count),
                    int(after_count),
                    max(int(after_count) - int(before_count), 0),
                    int(success_count),
                    int(failed_count),
                    json.dumps(errors, ensure_ascii=False),
                    now,
                ),
            )
            conn.commit()

    def get_table_count(self, table_name: str) -> int:
        target = str(table_name or "").strip()
        if not target:
            return 0
        db_path = _sqlite_db_path()
        with sqlite3.connect(db_path) as conn:
            self._init_tables(conn)
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
                (target,),
            ).fetchone()
            if row is None:
                return 0
            count_row = conn.execute(f"SELECT COUNT(1) FROM {target}").fetchone()
        return int(count_row[0] if count_row else 0)

    def list_recent_runs(self, limit: int = 20) -> list[dict[str, Any]]:
        page_size = max(1, min(int(limit), 200))
        db_path = _sqlite_db_path()
        with sqlite3.connect(db_path) as conn:
            self._init_tables(conn)
            rows = conn.execute(
                """
                SELECT run_date, slot_time, subject, labels_json, total_count, before_count, after_count,
                       inserted_count, success_count, failed_count, errors_json, created_at
                FROM scheduler_runs
                WHERE source = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (self.source, page_size),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            (
                run_date,
                slot_time,
                subject,
                labels_json,
                total_count,
                before_count,
                after_count,
                inserted_count,
                success_count,
                failed_count,
                errors_json,
                created_at,
            ) = row
            try:
                labels = json.loads(str(labels_json or "[]"))
            except Exception:
                labels = []
            if not isinstance(labels, list):
                labels = []
            try:
                errors = json.loads(str(errors_json or "[]"))
            except Exception:
                errors = []
            if not isinstance(errors, list):
                errors = []
            out.append(
                {
                    "run_date": str(run_date or ""),
                    "slot_time": str(slot_time or ""),
                    "subject": str(subject or ""),
                    "labels": [str(x) for x in labels if str(x).strip()],
                    "total_count": int(total_count or 0),
                    "before_count": int(before_count or 0),
                    "after_count": int(after_count or 0),
                    "inserted_count": int(inserted_count or 0),
                    "success_count": int(success_count or 0),
                    "failed_count": int(failed_count or 0),
                    "errors": [str(x) for x in errors if str(x).strip()],
                    "created_at": str(created_at or ""),
                }
            )
        return out
