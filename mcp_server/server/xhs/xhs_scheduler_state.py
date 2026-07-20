import os
from typing import Any

from ..scheduler import SchedulerStore

_STORE = SchedulerStore("xhs")


def load_state() -> dict[str, Any]:
    parsed = _STORE.load_state(key="scheduler")
    if not parsed:
        return {
            "plans": {},
            "executed": {},
            "city_cursor": 0,
            "topic_cursor": 0,
        }
    plans = parsed.get("plans")
    executed = parsed.get("executed")
    if not isinstance(plans, dict):
        plans = {}
    if not isinstance(executed, dict):
        executed = {}
    return {
        "plans": plans,
        "executed": executed,
        "city_cursor": int(parsed.get("city_cursor") or 0),
        "topic_cursor": int(parsed.get("topic_cursor") or 0),
    }


def save_state(state: dict[str, Any]) -> None:
    payload = {
        "plans": state.get("plans") if isinstance(state.get("plans"), dict) else {},
        "executed": state.get("executed") if isinstance(state.get("executed"), dict) else {},
        "city_cursor": int(state.get("city_cursor") or 0),
        "topic_cursor": int(state.get("topic_cursor") or 0),
    }
    _STORE.save_state(payload, key="scheduler")


def get_cached_note_count() -> int:
    return _STORE.get_table_count("xhs_note_cache")


def append_run_log(
    *,
    run_date: str,
    slot_time: str,
    city: str,
    topics: list[str],
    total_notes: int,
    before_count: int,
    after_count: int,
    success_count: int,
    failed_count: int,
    errors: list[str],
) -> None:
    _STORE.append_run_log(
        run_date=run_date,
        slot_time=slot_time,
        subject=city,
        labels=topics,
        total_count=total_notes,
        before_count=before_count,
        after_count=after_count,
        success_count=success_count,
        failed_count=failed_count,
        errors=errors,
    )


def load_scheduler_config() -> dict[str, Any]:
    raw = _STORE.load_state(key="config")
    if not isinstance(raw, dict):
        raw = {}
    def _env_int(name: str, default: int) -> int:
        try:
            return int(str(os.getenv(name, str(default)) or str(default)).strip())
        except Exception:
            return default
    env_enabled = str(os.getenv("XHS_SCHEDULER_ENABLED", "0") or "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    return {
        "enabled": bool(raw.get("enabled", env_enabled)),
        "source": str(raw.get("source") or "xhs").strip() or "xhs",
        "email_enabled": bool(raw.get("email_enabled", True)),
        "per_query_page_size": int(raw.get("per_query_page_size") or _env_int("XHS_PER_QUERY_PAGE_SIZE", 20)),
        "combo_repeat_min": int(raw.get("combo_repeat_min") or _env_int("XHS_COMBO_REPEAT_MIN", 2)),
        "combo_repeat_max": int(raw.get("combo_repeat_max") or _env_int("XHS_COMBO_REPEAT_MAX", 3)),
        "topic_batch_size": int(raw.get("topic_batch_size") or _env_int("XHS_TOPIC_BATCH_SIZE", 2)),
    }


