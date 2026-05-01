import random


def parse_hhmm(value: str, fallback_hour: int, fallback_minute: int) -> tuple[int, int]:
    text = str(value or "").strip()
    try:
        hour_text, minute_text = text.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
        if 0 <= hour <= 24 and 0 <= minute <= 59:
            return hour, minute
    except Exception:
        pass
    return fallback_hour, fallback_minute


def build_day_slots(date_text: str, slot_count: int, start_hhmm: str, end_hhmm: str, seed: str) -> list[str]:
    start_h, start_m = parse_hhmm(start_hhmm, 8, 0)
    end_h, end_m = parse_hhmm(end_hhmm, 24, 0)
    start_total = start_h * 60 + start_m
    end_total = end_h * 60 + end_m
    if end_total <= start_total:
        end_total = start_total + 60
    minutes = list(range(start_total, end_total))
    if not minutes:
        return ["08:00"]
    rng = random.Random(f"{seed}:{date_text}")
    picks = rng.sample(minutes, k=min(max(slot_count, 1), len(minutes)))
    picks.sort()
    out: list[str] = []
    for total in picks:
        hour = min(total // 60, 23)
        minute = total % 60
        out.append(f"{hour:02d}:{minute:02d}")
    return out
