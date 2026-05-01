import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from ..notify import send_digest
from .xhs_note_pipeline import search_and_poll_notes
from .xhs_scheduler_state import (
    append_run_log,
    get_cached_note_count,
    load_scheduler_config,
)
from .xhs_task_store import (
    claim_due_pending_task,
    get_task,
    mark_task_slot_running,
    update_task_slot_result,
)

logger = logging.getLogger(__name__)
CST = timezone(timedelta(hours=8))


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, str(default)) or str(default)).strip())
    except Exception:
        return default


def _enabled() -> bool:
    cfg = load_scheduler_config()
    if cfg.get("enabled") is True:
        return True
    return str(os.getenv("XHS_SCHEDULER_ENABLED", "0") or "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _today_cst() -> datetime:
    return datetime.now(CST)


def _parse_search_payload(text: str) -> dict[str, Any]:
    try:
        payload = json.loads(text)
    except Exception:
        return {"ok": False, "notes": [], "error": f"返回非JSON: {text[:200]}"}
    if not isinstance(payload, dict):
        return {"ok": False, "notes": [], "error": "返回不是JSON对象"}
    notes = payload.get("notes")
    if not isinstance(notes, list):
        notes = []
    payload["notes"] = notes
    return payload


class XhsSchedulerService:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._stop = asyncio.Event()

    def start(self) -> None:
        if not _enabled():
            logger.info("xhs_scheduler_disabled")
            return
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run_loop(), name="xhs-scheduler")
        logger.info("xhs_scheduler_started")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        logger.info("xhs_scheduler_stopped")

    async def run_task_now(self, task_id: str) -> dict[str, Any]:
        task = get_task(task_id)
        if task is None:
            raise ValueError("task not found")
        if str(task.get("status") or "") == "FAILED" and str(task.get("error_message") or "") == "cancelled by user":
            raise ValueError("task cancelled")
        slot_results = task.get("slot_results") if isinstance(task.get("slot_results"), dict) else {}
        fetch_count = int(task.get("fetch_count") or 0)
        target_index = -1
        for idx in range(fetch_count):
            state = str(slot_results.get(str(idx)) or "")
            if state not in ("SUCCESS", "FAILED", "RUNNING"):
                target_index = idx
                break
        if target_index < 0:
            raise ValueError("no runnable slot")
        updated = mark_task_slot_running(str(task.get("task_id") or ""), target_index)
        if updated is None:
            raise ValueError("task not found")
        await self._run_task_instance_slot(updated, target_index)
        latest = get_task(str(task.get("task_id") or ""))
        return latest or updated

    async def _run_task_instance_slot(self, task: dict[str, Any], index: int) -> None:
        async with self._lock:
            topics = task.get("topics") if isinstance(task.get("topics"), list) else []
            topic = str(topics[index] if index < len(topics) else "").strip()
            city = str(task.get("city") or "").strip()
            source = str(task.get("source") or "xhs").strip() or "xhs"
            domain = str(task.get("domain") or "").strip()
            page_size = max(int(task.get("page_size") or 20), 1)
            repeat_count = max(int(task.get("repeat_count") or 2), 1)
            email_enabled = bool(task.get("email_enabled", True))
            time_points = task.get("time_points") if isinstance(task.get("time_points"), list) else []
            slot_time = str(time_points[index] if index < len(time_points) else "").strip()

            before_count = get_cached_note_count()
            success_count = 0
            failed_count = 0
            total_notes = 0
            errors: list[str] = []
            query = f"{city}{topic}"

            for _ in range(repeat_count):
                try:
                    result_text = await search_and_poll_notes(
                        keyword=query,
                        page_size=page_size,
                        sort=str(os.getenv("XHS_SORT", "general") or "general"),
                        city_name=city,
                        requirements=[topic],
                        domains=[domain] if domain else [],
                    )
                    payload = _parse_search_payload(result_text)
                    notes = payload.get("notes") if isinstance(payload, dict) else []
                    note_count = len(notes) if isinstance(notes, list) else 0
                    total_notes += note_count
                    if payload.get("ok") is False:
                        failed_count += 1
                        errors.append(str(payload.get("error") or "unknown_error"))
                    else:
                        success_count += 1
                except Exception as exc:
                    failed_count += 1
                    errors.append(str(exc))
                await asyncio.sleep(max(float(os.getenv("XHS_REPEAT_GAP_SECONDS", "1.0") or 1.0), 0.1))

            ok = failed_count == 0
            err = "; ".join(errors[:10]) if errors else ""
            update_task_slot_result(str(task.get("task_id") or ""), index, ok=ok, error_message=err)

            date_text = _today_cst().strftime("%Y-%m-%d")
            after_count = get_cached_note_count()
            append_run_log(
                run_date=date_text,
                slot_time=slot_time,
                city=city,
                topics=[topic],
                total_notes=total_notes,
                before_count=before_count,
                after_count=after_count,
                success_count=success_count,
                failed_count=failed_count,
                errors=errors[:20],
            )
            if email_enabled:
                self._send_digest_email(
                    date_text=date_text,
                    slot_time=slot_time,
                    city=city,
                    topics=[topic],
                    total_notes=total_notes,
                    before_count=before_count,
                    after_count=after_count,
                    success_count=success_count,
                    failed_count=failed_count,
                    errors=errors,
                    source=source,
                )

    def _send_digest_email(
        self,
        *,
        date_text: str,
        slot_time: str,
        city: str,
        topics: list[str],
        total_notes: int,
        before_count: int,
        after_count: int,
        success_count: int,
        failed_count: int,
        errors: list[str],
        source: str,
    ) -> None:
        cfg = load_scheduler_config()
        if cfg.get("email_enabled") is False:
            return
        if not str(os.getenv("SMTP_TO", "") or "").strip():
            return
        subject = f"[{source}定时任务] {date_text} {slot_time} {city} 抓取汇总"
        inserted = max(after_count - before_count, 0)
        text = (
            f"执行日期: {date_text}\n"
            f"执行时间: {slot_time}\n"
            f"城市: {city}\n"
            f"Topic批次: {', '.join(topics)}\n"
            f"抓取总条数(累计响应): {total_notes}\n"
            f"任务成功轮次: {success_count}\n"
            f"任务失败轮次: {failed_count}\n"
            f"入库前总量: {before_count}\n"
            f"入库后总量: {after_count}\n"
            f"本次新增(估算): {inserted}\n"
        )
        if errors:
            text += "\n错误摘要:\n" + "\n".join(f"- {line}" for line in errors[:20])
        try:
            send_digest(subject=subject, text_body=text)
        except Exception as exc:
            logger.warning("xhs_scheduler_send_email_failed error=%s", exc)

    async def _run_loop(self) -> None:
        while not self._stop.is_set():
            try:
                now = _today_cst()
                today = now.strftime("%Y-%m-%d")
                now_hm = now.strftime("%H:%M")

                claimed_task = claim_due_pending_task(today, now_hm)
                if claimed_task is not None:
                    claimed_index = int(claimed_task.get("_claimed_index") or 0)
                    await self._run_task_instance_slot(claimed_task, claimed_index)

                await asyncio.sleep(max(_env_int("XHS_SCHEDULER_TICK_SECONDS", 20), 5))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("xhs_scheduler_loop_error error=%s", exc)
                await asyncio.sleep(10)


xhs_scheduler_service = XhsSchedulerService()
