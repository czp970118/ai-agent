import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .xhs_note_cache import _sqlite_db_path


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _conn():
    import sqlite3

    return sqlite3.connect(_sqlite_db_path())


def _init_task_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS xhs_schedule_tasks (
            task_id TEXT PRIMARY KEY,
            source TEXT NOT NULL DEFAULT 'xhs',
            run_date TEXT NOT NULL DEFAULT '',
            domain TEXT NOT NULL DEFAULT '',
            city TEXT NOT NULL DEFAULT '',
            fetch_count INTEGER NOT NULL DEFAULT 1,
            time_points_json TEXT NOT NULL DEFAULT '[]',
            topics_json TEXT NOT NULL DEFAULT '[]',
            page_size INTEGER NOT NULL DEFAULT 20,
            repeat_count INTEGER NOT NULL DEFAULT 2,
            email_enabled INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'PENDING',
            slot_results_json TEXT NOT NULL DEFAULT '{}',
            error_message TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_xhs_schedule_tasks_status ON xhs_schedule_tasks(status, updated_at DESC)")
    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(xhs_schedule_tasks)").fetchall()}
    if "run_date" not in columns:
        conn.execute("ALTER TABLE xhs_schedule_tasks ADD COLUMN run_date TEXT NOT NULL DEFAULT ''")


def _normalize_times(value: list[str]) -> list[str]:
    out: list[str] = []
    for raw in value:
        text = str(raw or "").strip()
        if not text:
            continue
        parts = text.split(":")
        if len(parts) != 2:
            continue
        try:
            h = int(parts[0])
            m = int(parts[1])
        except Exception:
            continue
        if h < 0 or h > 23 or m < 0 or m > 59:
            continue
        item = f"{h:02d}:{m:02d}"
        if item not in out:
            out.append(item)
    out.sort()
    return out


def _normalize_topics(value: list[str]) -> list[str]:
    out: list[str] = []
    for raw in value:
        text = str(raw or "").strip()
        if text:
            out.append(text)
    return out


def _normalize_run_date(value: Any) -> str:
    text = str(value or "").strip()
    try:
        return datetime.strptime(text, "%Y-%m-%d").strftime("%Y-%m-%d")
    except Exception as exc:
        raise ValueError("执行日期格式必须是 YYYY-MM-DD") from exc


def create_task(payload: dict[str, Any]) -> dict[str, Any]:
    source = str(payload.get("source") or "xhs").strip() or "xhs"
    run_date = _normalize_run_date(payload.get("run_date"))
    domain = str(payload.get("domain") or "").strip()
    city = str(payload.get("city") or "").strip()
    fetch_count = max(int(payload.get("fetch_count") or 1), 1)
    time_points = _normalize_times(payload.get("time_points") if isinstance(payload.get("time_points"), list) else [])
    topics = _normalize_topics(payload.get("topics") if isinstance(payload.get("topics"), list) else [])
    if len(time_points) != fetch_count:
        raise ValueError("时间点数量必须与抓取次数一致")
    if len(topics) != fetch_count:
        raise ValueError("主题数量必须与抓取次数一致")
    task_id = uuid4().hex
    now = _utc_now_iso()
    page_size = max(min(int(payload.get("page_size") or 20), 100), 1)
    repeat_count = max(min(int(payload.get("repeat_count") or 2), 10), 1)
    email_enabled = 1 if bool(payload.get("email_enabled", True)) else 0
    with _conn() as conn:
        _init_task_table(conn)
        conn.execute(
            """
            INSERT INTO xhs_schedule_tasks (
                task_id, source, run_date, domain, city, fetch_count, time_points_json, topics_json,
                page_size, repeat_count, email_enabled, status, slot_results_json, error_message,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '{}', '', ?, ?)
            """,
            (
                task_id,
                source,
                run_date,
                domain,
                city,
                fetch_count,
                json.dumps(time_points, ensure_ascii=False),
                json.dumps(topics, ensure_ascii=False),
                page_size,
                repeat_count,
                email_enabled,
                now,
                now,
            ),
        )
        conn.commit()
    return get_task(task_id) or {}


def _row_to_task(row) -> dict[str, Any]:
    (
        task_id,
        source,
        run_date,
        domain,
        city,
        fetch_count,
        time_points_json,
        topics_json,
        page_size,
        repeat_count,
        email_enabled,
        status,
        slot_results_json,
        error_message,
        created_at,
        updated_at,
    ) = row
    try:
        time_points = json.loads(str(time_points_json or "[]"))
    except Exception:
        time_points = []
    try:
        topics = json.loads(str(topics_json or "[]"))
    except Exception:
        topics = []
    try:
        slot_results = json.loads(str(slot_results_json or "{}"))
    except Exception:
        slot_results = {}
    return {
        "task_id": str(task_id or ""),
        "source": str(source or "xhs"),
        "run_date": str(run_date or ""),
        "domain": str(domain or ""),
        "city": str(city or ""),
        "fetch_count": int(fetch_count or 0),
        "time_points": time_points if isinstance(time_points, list) else [],
        "topics": topics if isinstance(topics, list) else [],
        "page_size": int(page_size or 20),
        "repeat_count": int(repeat_count or 2),
        "email_enabled": bool(email_enabled),
        "status": str(status or "PENDING"),
        "slot_results": slot_results if isinstance(slot_results, dict) else {},
        "error_message": str(error_message or ""),
        "created_at": str(created_at or ""),
        "updated_at": str(updated_at or ""),
    }


def list_tasks(limit: int = 100) -> list[dict[str, Any]]:
    page_size = max(min(int(limit), 500), 1)
    with _conn() as conn:
        _init_task_table(conn)
        rows = conn.execute(
            """
            SELECT task_id, source, run_date, domain, city, fetch_count, time_points_json, topics_json,
                   page_size, repeat_count, email_enabled, status, slot_results_json, error_message,
                   created_at, updated_at
            FROM xhs_schedule_tasks
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (page_size,),
        ).fetchall()
    return [_row_to_task(r) for r in rows]


def get_task(task_id: str) -> dict[str, Any] | None:
    target = str(task_id or "").strip()
    if not target:
        return None
    with _conn() as conn:
        _init_task_table(conn)
        row = conn.execute(
            """
            SELECT task_id, source, run_date, domain, city, fetch_count, time_points_json, topics_json,
                   page_size, repeat_count, email_enabled, status, slot_results_json, error_message,
                   created_at, updated_at
            FROM xhs_schedule_tasks
            WHERE task_id = ?
            LIMIT 1
            """,
            (target,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_task(row)


def mark_task_cancelled(task_id: str) -> dict[str, Any] | None:
    target = str(task_id or "").strip()
    if not target:
        return None
    now = _utc_now_iso()
    with _conn() as conn:
        _init_task_table(conn)
        conn.execute(
            "UPDATE xhs_schedule_tasks SET status='FAILED', error_message='cancelled by user', updated_at=? WHERE task_id=?",
            (now, target),
        )
        conn.commit()
    return get_task(target)


def retry_task_failed_slots(task_id: str) -> dict[str, Any] | None:
    target = str(task_id or "").strip()
    if not target:
        return None
    task = get_task(target)
    if task is None:
        return None
    slot_results = task.get("slot_results") if isinstance(task.get("slot_results"), dict) else {}
    changed = False
    for idx in range(int(task.get("fetch_count") or 0)):
        key = str(idx)
        value = str(slot_results.get(key) or "")
        if value == "FAILED":
            slot_results[key] = "PENDING"
            changed = True
    if not changed:
        return task
    now = _utc_now_iso()
    with _conn() as conn:
        _init_task_table(conn)
        conn.execute(
            "UPDATE xhs_schedule_tasks SET slot_results_json=?, status='PENDING', error_message='', updated_at=? WHERE task_id=?",
            (json.dumps(slot_results, ensure_ascii=False), now, target),
        )
        conn.commit()
    return get_task(target)


def claim_due_pending_task(run_date: str, now_hm: str) -> dict[str, Any] | None:
    tasks = [
        t
        for t in list_tasks(limit=200)
        if str(t.get("status")) == "PENDING" and str(t.get("run_date") or "").strip() == run_date
    ]
    for task in tasks:
        slot_results = task.get("slot_results") if isinstance(task.get("slot_results"), dict) else {}
        time_points = task.get("time_points") if isinstance(task.get("time_points"), list) else []
        for idx, slot in enumerate(time_points):
            slot_text = str(slot or "").strip()
            if not slot_text or now_hm < slot_text:
                continue
            if str(slot_results.get(str(idx)) or "") in ("SUCCESS", "FAILED"):
                continue
            slot_results[str(idx)] = "RUNNING"
            now = _utc_now_iso()
            with _conn() as conn:
                _init_task_table(conn)
                conn.execute(
                    "UPDATE xhs_schedule_tasks SET slot_results_json=?, updated_at=? WHERE task_id=?",
                    (json.dumps(slot_results, ensure_ascii=False), now, task["task_id"]),
                )
                conn.commit()
            task["slot_results"] = slot_results
            task["_claimed_index"] = idx
            return task
    return None


def update_task_slot_result(task_id: str, index: int, ok: bool, error_message: str = "") -> dict[str, Any] | None:
    task = get_task(task_id)
    if task is None:
        return None
    slot_results = task.get("slot_results") if isinstance(task.get("slot_results"), dict) else {}
    slot_results[str(index)] = "SUCCESS" if ok else "FAILED"
    now = _utc_now_iso()
    status = "PENDING"
    values = [str(slot_results.get(str(i)) or "") for i in range(int(task.get("fetch_count") or 0))]
    if values and all(v == "SUCCESS" for v in values):
        status = "SUCCESS"
    elif any(v == "FAILED" for v in values) and all(v in ("SUCCESS", "FAILED") for v in values):
        status = "FAILED"
    with _conn() as conn:
        _init_task_table(conn)
        conn.execute(
            "UPDATE xhs_schedule_tasks SET slot_results_json=?, status=?, error_message=?, updated_at=? WHERE task_id=?",
            (json.dumps(slot_results, ensure_ascii=False), status, str(error_message or ""), now, task_id),
        )
        conn.commit()
    return get_task(task_id)


def mark_task_slot_running(task_id: str, index: int) -> dict[str, Any] | None:
    task = get_task(task_id)
    if task is None:
        return None
    slot_results = task.get("slot_results") if isinstance(task.get("slot_results"), dict) else {}
    value = str(slot_results.get(str(index)) or "")
    if value in ("SUCCESS", "FAILED", "RUNNING"):
        return task
    slot_results[str(index)] = "RUNNING"
    now = _utc_now_iso()
    with _conn() as conn:
        _init_task_table(conn)
        conn.execute(
            "UPDATE xhs_schedule_tasks SET slot_results_json=?, updated_at=? WHERE task_id=?",
            (json.dumps(slot_results, ensure_ascii=False), now, task_id),
        )
        conn.commit()
    return get_task(task_id)
