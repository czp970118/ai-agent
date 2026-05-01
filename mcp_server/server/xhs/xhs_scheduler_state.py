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


def save_scheduler_config(config: dict[str, Any]) -> dict[str, Any]:
    current = load_scheduler_config()
    merged = {**current, **(config if isinstance(config, dict) else {})}
    merged["source"] = str(merged.get("source") or "xhs").strip() or "xhs"
    merged["per_query_page_size"] = max(1, min(int(merged.get("per_query_page_size") or 20), 100))
    merged["combo_repeat_min"] = max(1, min(int(merged.get("combo_repeat_min") or 2), 10))
    merged["combo_repeat_max"] = max(
        merged["combo_repeat_min"],
        min(int(merged.get("combo_repeat_max") or 3), 20),
    )
    merged["topic_batch_size"] = max(1, min(int(merged.get("topic_batch_size") or 2), 20))
    merged["enabled"] = bool(merged.get("enabled"))
    merged["email_enabled"] = bool(merged.get("email_enabled"))
    _STORE.save_state(merged, key="config")
    return merged


def list_recent_scheduler_runs(limit: int = 20) -> list[dict[str, Any]]:
    return _STORE.list_recent_runs(limit=limit)
