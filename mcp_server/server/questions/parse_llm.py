"""考公题目 docx 文本 → DeepSeek 结构化 JSON。"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from ..constants import DEEPSEEK_CHAT_URL

logger = logging.getLogger("mcp_server.questions.parse")

PARSE_SYSTEM_PROMPT = (
    "你是考公题库录入助手。从 Word 纯文本识别选择题，输出 JSON，不要 markdown。\n"
    "题库用途：召回后生成「每日一题」题目图 +「答案解析」图；explanation 即答案解析图上的正文（不含「正确答案 A」标题行）。\n"
    "输出格式：\n"
    '{"questions":[{"header":"公基常识","stem":"题干","options":["A. …","B. …"],'
    '"answer":"A","explanation":"…","extra_text":"",'
    '"category":"","question_type":"single","confidence":0.9}],"warnings":[]}\n'
    "规则：\n"
    "1) 只提取真实题目，禁止编造。\n"
    "2) options 至少 2 项，带 A. B. 前缀；answer 为字母；多选 AB 且 question_type=multi。\n"
    "3) 无法确定答案的题放入 warnings，不要放入 questions。\n"
    "4) 有默认分类且题目无分类时用默认分类。\n"
    "5) 【题目卷】取题干选项；【答案解析卷】取答案与解析，按题号匹配，禁止编造。\n"
    "6) 仅处理本段文本。\n"
    "7) explanation（答案解析卡正文，一段连贯中文，35～88 字，含标点）：\n"
    "   a) 先写清正确答案为何成立，可压缩答案卷长解析，保留关键依据。\n"
    "   b) 若仅写正确项已 ≥48 字，则只写正确项解析即可，不必补充干扰项。\n"
    "   c) 若正确项解析不足 48 字，可再补 1～3 个干扰项的简短说明（每项约 8～18 字），"
    "用分号「；」或自然句衔接，使全文达到约 45～80 字；禁止 A/B/C/D 编号逐条罗列。\n"
    "   d) 全文不超过 88 字；禁止只写「选 C」；禁止把四个选项各写一句凑字数。\n"
    "8) 写法示例（explanation 正文）：\n"
    "   - 仅正确项够长：「彩虹是光学现象，光谱由外至内为红橙黄绿蓝靛紫，最外层是红色。」（约 46 字）\n"
    "   - 正确项+干扰项：「新西兰四面环海、环境独特，无蛇类分布；澳大利亚、加拿大、巴西均有蛇。」\n"
    "   - 正确项+干扰项：「皮肤覆盖体表，是人体最大器官；肝脏最大实质性器官，心脏推动血液循环，肺主呼吸，均非最大。」\n"
    "9) extra_text 通常留空；仅当原文有与卡片无关的独立知识拓展时才填写，不要放选项辨析。\n"
)

CARD_POLISH_SYSTEM_PROMPT = (
    "你是「每日一题·答案解析卡」文案编辑。输入为已识别题目，输出可直接印在 1080×1440 答案解析图上的 explanation 正文。\n"
    "只输出 JSON：{\"items\":[{\"explanation\":\"…\",\"extra_text\":\"\"}]}\n"
    "要求：items 数量与输入一致、顺序不变。\n"
    "explanation：一段连贯中文 35～88 字（含标点），不要 markdown、不要换行。\n"
    "写作策略：\n"
    "1) 优先写清 answer 为何正确；若已 ≥48 字且信息完整，只写正确项即可。\n"
    "2) 若正确项不足 48 字，再补 1～3 个易错干扰项的极短说明，用「；」衔接，总字数 45～80 字为宜。\n"
    "3) 禁止 A/B/C/D 编号罗列；禁止超过 88 字；禁止编造题干与答案卷没有的事实。\n"
    "4) extra_text 通常为空字符串。\n"
)

CARD_EXPLANATION_MIN_CHARS = 32
CARD_EXPLANATION_STANDALONE_CHARS = 48
CARD_EXPLANATION_MAX_CHARS = 90
OPTION_NOTE_MIN_CHARS = 5
OPTION_NOTE_MAX_CHARS = 20
DEFAULT_EXTRA_TITLE = "古代知识拓展："

_OPTION_ENUM_RE = re.compile(
    r"(?:^|[；;\n])\s*([A-H])[.、．:：]\s*([^A-H；;\n]{2,})",
    re.IGNORECASE | re.MULTILINE,
)


def _llm_http_failure_detail(resp: httpx.Response) -> str:
    code = int(resp.status_code)
    if code == 402:
        return "DeepSeek 账户余额不足或未开通计费（HTTP 402），请登录 platform.deepseek.com 充值后重试"
    if code == 401:
        return "DeepSeek API Key 无效或已过期（HTTP 401），请检查 mcp_server/.env 中的 DEEPSEEK_API_KEY"
    if code == 403:
        return "DeepSeek API 无权访问（HTTP 403）"
    if code == 429:
        return "DeepSeek 请求过于频繁（HTTP 429），请稍后重试"
    try:
        data = resp.json()
        err = data.get("error")
        if isinstance(err, dict):
            msg = str(err.get("message") or "").strip()
            if msg:
                return f"DeepSeek 错误（HTTP {code}）：{msg}"
        msg = str(data.get("message") or "").strip()
        if msg:
            return f"DeepSeek 错误（HTTP {code}）：{msg}"
    except (json.JSONDecodeError, ValueError, TypeError):
        pass
    return f"DeepSeek 请求失败（HTTP {code}）"


def force_chunking_enabled() -> bool:
    return os.getenv("QUESTION_PARSE_ENABLE_CHUNKING", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def auto_chunk_threshold() -> int:
    raw = os.getenv("QUESTION_PARSE_AUTO_CHUNK_CHARS", "25000").strip()
    try:
        return max(5000, int(raw))
    except ValueError:
        return 25000


def chunk_chars() -> int:
    raw = os.getenv("QUESTION_PARSE_CHUNK_CHARS", "8000").strip()
    try:
        return max(500, int(raw))
    except ValueError:
        return 8000


def max_split_parts() -> int:
    raw = os.getenv("QUESTION_PARSE_MAX_SPLIT_PARTS", "120").strip()
    try:
        return max(10, int(raw))
    except ValueError:
        return 120


def parse_max_tokens() -> int:
    raw = os.getenv("QUESTION_PARSE_MAX_TOKENS", "8192").strip()
    try:
        return max(1024, min(int(raw), 8192))
    except ValueError:
        return 8192


def parse_timeout_seconds() -> float:
    raw = os.getenv("QUESTION_PARSE_TIMEOUT_SECONDS", "180").strip()
    try:
        return max(10.0, float(raw))
    except ValueError:
        return 180.0


def card_polish_enabled() -> bool:
    return os.getenv("QUESTION_PARSE_CARD_POLISH", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def _merge_parts_to_chunks(parts: list[str], target_chars: int) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for part in parts:
        plen = len(part) + 2
        if current and current_len + plen > target_chars:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        current.append(part)
        current_len += plen
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def split_text_chunks(text: str) -> list[str]:
    body = str(text or "").strip()
    if not body:
        return []

    size = chunk_chars()
    must_chunk = force_chunking_enabled() or len(body) > auto_chunk_threshold()

    if not must_chunk:
        return [body]

    patterns = [
        re.compile(r"(?=\n第\s*\d+\s*题)"),
        re.compile(r"(?=\n\d+[\.、．])"),
        re.compile(r"(?=\n【[^】]{2,12}】)"),
    ]
    cap = max_split_parts()
    for pat in patterns:
        parts = [p.strip() for p in pat.split(body) if p.strip()]
        if 1 < len(parts) <= cap:
            merged = _merge_parts_to_chunks(parts, size)
            if merged:
                return merged

    return [body[i : i + size] for i in range(0, len(body), size)]


def _strip_json_fence(raw: str) -> str:
    t = str(raw or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.I)
        t = re.sub(r"\s*```$", "", t)
    return t.strip()


def _extract_json_object(raw: str) -> str | None:
    t = _strip_json_fence(raw)
    if not t:
        return None
    try:
        json.loads(t)
        return t
    except json.JSONDecodeError:
        pass
    start = t.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return t[start : i + 1]
    return None


def _parse_llm_payload(raw: str) -> dict[str, Any] | None:
    blob = _extract_json_object(raw)
    if not blob:
        return None
    try:
        parsed = json.loads(blob)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _clamp_text(text: str, *, max_chars: int) -> str:
    t = re.sub(r"\s+", " ", str(text or "").strip())
    if len(t) <= max_chars:
        return t
    return t[: max_chars - 1].rstrip() + "…"


def _looks_like_option_enumeration(text: str) -> bool:
    t = str(text or "")
    if len(_OPTION_ENUM_RE.findall(t)) >= 2:
        return True
    if len(re.findall(r"[A-H][.、．:：]", t, flags=re.I)) >= 2:
        return True
    if len(re.findall(r"\d{4}年", t)) >= 3:
        return True
    if len(re.findall(r"(?:内蒙古|新疆|广西|宁夏|西藏|香港|澳门|台湾)", t)) >= 3:
        return True
    return False


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"[。！？；\n]+", str(text or ""))
    return [re.sub(r"\s+", " ", p).strip() for p in parts if p and p.strip()]


def _extract_option_notes_from_enumeration(text: str, *, correct: str) -> dict[str, str]:
    correct_set = {ch for ch in str(correct or "").upper() if ch.isalpha()}
    notes: dict[str, str] = {}
    for label, body in _OPTION_ENUM_RE.findall(str(text or "")):
        key = str(label or "").strip().upper()
        if len(key) != 1 or not key.isalpha() or key in correct_set:
            continue
        snippet = re.split(r"[，,]", str(body or "").strip(), maxsplit=1)[0].strip()
        note = _clamp_text(snippet, max_chars=OPTION_NOTE_MAX_CHARS)
        if len(note) < OPTION_NOTE_MIN_CHARS:
            continue
        if key not in notes or len(note) > len(notes[key]):
            notes[key] = note
        if len(notes) >= 3:
            break
    return notes


def _clamp_card_explanation(text: str) -> str:
    t = re.sub(r"\s+", " ", str(text or "").strip())
    t = re.sub(r"\n+", "", t)
    if len(t) <= CARD_EXPLANATION_MAX_CHARS:
        return t
    cut = t[:CARD_EXPLANATION_MAX_CHARS]
    for delim in ("。", "；", "！", "？"):
        pos = cut.rfind(delim)
        if pos >= CARD_EXPLANATION_MIN_CHARS - 8:
            return cut[: pos + 1]
    return _clamp_text(t, max_chars=CARD_EXPLANATION_MAX_CHARS)


def _option_label_keyword(options: list[str], label: str) -> str:
    want = str(label or "").strip().upper()
    for opt in options:
        m = re.match(r"^\s*([A-H])[.、．:：\s]*(.*)$", str(opt or ""), flags=re.I)
        if m and m.group(1).upper() == want:
            return str(m.group(2) or "").strip()[:10]
    return ""


def _append_distractor_fragments(
    core: str,
    notes: dict[str, str],
    *,
    options: list[str],
    answer: str,
) -> str:
    correct_set = {ch for ch in str(answer or "").upper() if ch.isalpha()}
    frags: list[str] = []
    for label in sorted(notes.keys()):
        if label in correct_set:
            continue
        note = str(notes[label] or "").strip()
        if len(note) < OPTION_NOTE_MIN_CHARS:
            continue
        kw = _option_label_keyword(options, label)
        if kw and kw not in note:
            frags.append(f"{kw}{note}")
        else:
            frags.append(note)
        if len(frags) >= 3:
            break
    if not frags:
        return core
    body = core.rstrip("。！？")
    return f"{body}。{'；'.join(frags)}"


def _pick_card_explanation(
    raw: str, *, answer: str, stem: str = "", options: list[str] | None = None
) -> str:
    text = re.sub(r"\s+", " ", str(raw or "").strip())
    if not text:
        return ""
    correct_set = {ch for ch in str(answer or "").upper() if ch.isalpha()}
    sentences = _split_sentences(text) or [text]

    def _score(s: str) -> int:
        score = 0
        if re.search(r"[A-H][.、．:：]", s, flags=re.I):
            score -= 10
        if len(s) > CARD_EXPLANATION_MAX_CHARS:
            score -= 4
        if CARD_EXPLANATION_MIN_CHARS <= len(s) <= CARD_EXPLANATION_MAX_CHARS:
            score += 4
        if CARD_EXPLANATION_STANDALONE_CHARS <= len(s) <= CARD_EXPLANATION_MAX_CHARS:
            score += 2
        if any(tok in s for tok in ("因此", "所以", "故", "正确", "答案", "最晚", "唯一")):
            score += 3
        if any(f"选{ch}" in s or f"答案{ch}" in s or f"{ch}项" in s for ch in correct_set):
            score += 2
        return score

    best = max(sentences, key=_score)
    if _score(best) < 0:
        best = sentences[-1] if sentences else text
    picked = _clamp_card_explanation(best)
    if picked:
        return picked

    if "最晚" in text or "最晚" in str(stem or ""):
        for opt in options or []:
            m = re.match(r"^\s*([A-H])[.、．:：\s]*(.*)$", str(opt or ""), flags=re.I)
            if not m or m.group(1).upper() not in correct_set:
                continue
            kw = str(m.group(2) or "").strip()[:8]
            year_m = re.search(rf"{re.escape(kw)}[^，。；\n]*?(\d{{4}})年", text) if kw else None
            if not year_m:
                year_m = re.search(r"(\d{4})年", text)
            year_hint = f"{year_m.group(1)}年" if year_m else ""
            if kw:
                return _clamp_card_explanation(
                    f"{kw}{year_hint}设立最晚，为正确选项"
                )
    return _clamp_card_explanation(text)


def _extract_option_notes_from_options(
    text: str, *, options: list[str], correct: str
) -> dict[str, str]:
    correct_set = {ch for ch in str(correct or "").upper() if ch.isalpha()}
    notes: dict[str, str] = {}
    body = re.sub(r"^\s*[A-H][.、．:：]\s*", "", str(text or "").strip(), flags=re.I)
    segments = [s.strip() for s in re.split(r"[，,；;]", body) if s.strip()]

    keywords: list[tuple[str, str]] = []
    for opt in options:
        m = re.match(r"^\s*([A-H])[.、．:：\s]*(.*)$", str(opt or ""), flags=re.I)
        if not m:
            continue
        label = m.group(1).upper()
        if label in correct_set:
            continue
        keyword = str(m.group(2) or "").strip()[:8]
        if len(keyword) >= 2:
            keywords.append((label, keyword))

    for seg in segments:
        for label, keyword in keywords:
            if label in notes or keyword not in seg:
                continue
            year_m = re.search(r"(\d{4}年[^，。；\n]{0,8})", seg)
            if not year_m:
                year_m = re.search(r"(\d{4})(?:年)?", seg)
            note_raw = year_m.group(0) if year_m else seg.replace(keyword, "", 1).strip()
            if year_m and "年" not in note_raw:
                note_raw = f"{year_m.group(1)}年"
            note = _clamp_text(note_raw, max_chars=OPTION_NOTE_MAX_CHARS)
            if len(note) >= OPTION_NOTE_MIN_CHARS:
                notes[label] = note
                break
        if len(notes) >= 3:
            break
    return notes


def _merge_option_notes(*maps: dict[str, str]) -> dict[str, str]:
    merged: dict[str, str] = {}
    for m in maps:
        for key, val in (m or {}).items():
            if key not in merged:
                merged[key] = val
            if len(merged) >= 3:
                return merged
    return merged


def _comma_option_list(text: str) -> bool:
    return bool(re.match(r"^[A-H][.、．:：]", str(text or "").strip(), flags=re.I))


def _finalize_card_explanation(
    *,
    explanation: str,
    extra_text: str,
    option_notes: dict[str, str],
    answer: str,
    options: list[str] | None = None,
    stem: str = "",
) -> tuple[str, str, str]:
    """整理为答案解析图正文：一段 35～88 字，必要时合并干扰项短句。"""
    raw_exp = re.sub(r"^(?:解析|解答|答案解析)[：:]\s*", "", str(explanation or "").strip())
    raw_exp = re.sub(r"\s+", " ", raw_exp)
    raw_extra = str(extra_text or "").strip()
    opts = list(options or [])
    notes = dict(option_notes)

    enum_sources = [t for t in (raw_exp, raw_extra) if _looks_like_option_enumeration(t)]
    for src in enum_sources:
        if opts and _comma_option_list(src):
            notes = _merge_option_notes(
                notes, _extract_option_notes_from_options(src, options=opts, correct=answer)
            )
        elif not _comma_option_list(src):
            notes = _merge_option_notes(
                notes, _extract_option_notes_from_enumeration(src, correct=answer)
            )

    if not raw_exp and notes:
        raw_exp = _pick_card_explanation(
            "；".join(notes.values()), answer=answer, stem=stem, options=opts
        )

    parts = [p.strip() for p in re.split(r"[；;]", raw_exp) if p.strip()]
    core = parts[0].rstrip("。！？") if parts else ""
    inline_tail = parts[1:]

    if _looks_like_option_enumeration(core) or re.search(r"[A-H][.、．:：]", core, flags=re.I):
        card_exp = _pick_card_explanation(raw_exp, answer=answer, stem=stem, options=opts)
    elif len(core) >= CARD_EXPLANATION_STANDALONE_CHARS:
        card_exp = core
    elif inline_tail:
        card_exp = f"{core}。{'；'.join(inline_tail)}"
    elif notes and len(core) < CARD_EXPLANATION_STANDALONE_CHARS:
        card_exp = _append_distractor_fragments(core, notes, options=opts, answer=answer)
    else:
        card_exp = core or raw_exp

    card_exp = _clamp_card_explanation(card_exp)

    extra_body = ""
    extra_title = ""
    if raw_extra and not _looks_like_option_enumeration(raw_extra) and not _comma_option_list(raw_extra):
        extra_body = _clamp_text(raw_extra, max_chars=60)
        if extra_body:
            extra_title = DEFAULT_EXTRA_TITLE

    return card_exp, extra_title, extra_body


def _normalize_option_notes(raw: Any, *, correct: str) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    correct_set = {ch for ch in str(correct or "").upper() if ch.isalpha()}
    notes: dict[str, str] = {}
    for key, val in raw.items():
        label = str(key or "").strip().upper()
        if len(label) != 1 or not label.isalpha() or label in correct_set:
            continue
        note = _clamp_text(str(val or ""), max_chars=OPTION_NOTE_MAX_CHARS)
        if len(note) < OPTION_NOTE_MIN_CHARS:
            continue
        notes[label] = note
        if len(notes) >= 3:
            break
    return notes


def _format_option_notes_lines(notes: dict[str, str]) -> str:
    return "\n".join(f"{label}：{text}" for label, text in sorted(notes.items()))


def _looks_like_abcd_listing(text: str) -> bool:
    """检测 A. … B. … 式编号罗列（与分号衔接的自然句不同）。"""
    return len(re.findall(r"[A-H][.、．:：]", str(text or ""), flags=re.I)) >= 2


def _normalize_question(q: dict[str, Any], default_category: str) -> dict[str, Any] | None:
    stem = str(q.get("stem") or "").strip()
    if not stem:
        return None
    opts = q.get("options") or []
    if not isinstance(opts, list):
        opts = []
    options = [str(x).strip() for x in opts if str(x).strip()]
    if len(options) < 2:
        return None
    answer = str(q.get("answer") or "").strip().upper()
    if not answer:
        return None
    qtype = str(q.get("question_type") or "single").strip().lower()
    if qtype not in ("single", "multi"):
        qtype = "multi" if len(answer) > 1 else "single"
    cat = str(q.get("category") or "").strip() or default_category or "未分类"
    conf = q.get("confidence")
    try:
        confidence = float(conf) if conf is not None else None
    except (TypeError, ValueError):
        confidence = None
    option_notes = _normalize_option_notes(q.get("option_notes"), correct=answer)
    explanation, extra_title, extra_text = _finalize_card_explanation(
        explanation=str(q.get("explanation") or "").strip(),
        extra_text=str(q.get("extra_text") or "").strip(),
        option_notes=option_notes,
        answer=answer,
        options=options,
        stem=stem,
    )
    if not extra_title and extra_text:
        extra_title = str(q.get("extra_title") or "").strip() or DEFAULT_EXTRA_TITLE

    return {
        "header": str(q.get("header") or "").strip() or "公基常识",
        "stem": stem,
        "options": options,
        "answer": answer,
        "explanation": explanation,
        "extra_title": extra_title,
        "extra_text": extra_text,
        "category": cat,
        "question_type": qtype,
        "confidence": confidence,
    }


def _apply_card_polish_item(item: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(item)
    answer = str(out.get("answer") or "").strip().upper()
    exp = str(patch.get("explanation") or "").strip()
    if exp:
        out["explanation"] = exp
    extra_text = str(patch.get("extra_text") or "").strip()
    notes = _normalize_option_notes(patch.get("option_notes"), correct=answer)
    exp2, et2, ex2 = _finalize_card_explanation(
        explanation=str(out.get("explanation") or ""),
        extra_text=extra_text or str(out.get("extra_text") or ""),
        option_notes=notes,
        answer=answer,
        options=list(out.get("options") or []),
        stem=str(out.get("stem") or ""),
    )
    out["explanation"] = exp2 or out.get("explanation") or ""
    out["extra_title"] = et2
    out["extra_text"] = ex2
    return out


async def polish_questions_for_cards(
    questions: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    if not questions or not card_polish_enabled():
        return questions

    payload_items = [
        {
            "stem": str(q.get("stem") or "")[:200],
            "options": list(q.get("options") or [])[:8],
            "answer": str(q.get("answer") or ""),
            "explanation": str(q.get("explanation") or ""),
        }
        for q in questions
    ]
    user_msg = json.dumps({"items": payload_items}, ensure_ascii=False)
    body: dict[str, Any] = {
        "model": model,
        "stream": False,
        "temperature": 0.1,
        "max_tokens": min(parse_max_tokens(), 4096),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": CARD_POLISH_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
    }
    try:
        resp = await client.post(
            DEEPSEEK_CHAT_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json=body,
        )
    except Exception as exc:
        logger.warning("card polish failed: %s", exc)
        return questions

    if not resp.is_success:
        logger.warning("card polish HTTP %s", resp.status_code)
        return questions

    data = resp.json()
    content = str((data.get("choices", [{}])[0] or {}).get("message", {}).get("content", "") or "")
    parsed = _parse_llm_payload(_strip_json_fence(content))
    if not parsed:
        return questions

    patches = parsed.get("items") or parsed.get("questions") or []
    if not isinstance(patches, list) or len(patches) != len(questions):
        return questions

    out: list[dict[str, Any]] = []
    for q, patch in zip(questions, patches):
        if isinstance(patch, dict):
            out.append(_apply_card_polish_item(q, patch))
        else:
            out.append(q)
    return out


async def parse_questions_from_text(
    text: str,
    *,
    default_category: str = "",
    api_key: str,
    model: str,
) -> dict[str, Any]:
    chunks = split_text_chunks(text)
    if not chunks:
        return {"ok": False, "error": "文本为空", "questions": [], "warnings": []}

    all_questions: list[dict[str, Any]] = []
    all_warnings: list[str] = []
    raw_blocks: list[dict[str, Any]] = []
    api_error: str = ""
    default_cat = str(default_category or "").strip()

    timeout = parse_timeout_seconds()
    async with httpx.AsyncClient(timeout=timeout) as client:
        for idx, chunk in enumerate(chunks):
            if len(chunks) == 1:
                user_msg = (
                    f"默认分类：{default_cat or '未分类'}\n"
                    f"文档全文（含【题目卷】与【答案解析卷】）：\n{chunk}"
                )
            else:
                user_msg = (
                    f"默认分类：{default_cat or '未分类'}\n"
                    f"文本块 {idx + 1}/{len(chunks)}（仅处理本块内的题目）：\n{chunk}"
                )
            payload: dict[str, Any] = {
                "model": model,
                "stream": False,
                "temperature": 0.15,
                "max_tokens": parse_max_tokens(),
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": PARSE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
            }
            try:
                resp = await client.post(
                    DEEPSEEK_CHAT_URL,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                    },
                    json=payload,
                )
            except httpx.ReadTimeout:
                all_warnings.append(f"块{idx + 1}：LLM 超时")
                continue
            except Exception as exc:
                all_warnings.append(f"块{idx + 1}：{type(exc).__name__}")
                continue

            if not resp.is_success:
                detail = _llm_http_failure_detail(resp)
                all_warnings.append(f"块{idx + 1}：{detail}")
                if not api_error:
                    api_error = detail
                continue

            data = resp.json()
            choice = data.get("choices", [{}])[0] or {}
            content = str(choice.get("message", {}).get("content", "") or "")
            finish = str(choice.get("finish_reason") or "")
            raw_content = _strip_json_fence(content)
            parsed = _parse_llm_payload(raw_content)

            if not parsed:
                detail = "JSON 解析失败"
                if finish == "length":
                    detail += "（输出被截断，可减小 QUESTION_PARSE_CHUNK_CHARS 或增大 max_tokens）"
                all_warnings.append(f"块{idx + 1}：{detail}")
                raw_blocks.append({"chunk": idx, "raw": raw_content[:2000], "finish_reason": finish})
                continue

            raw_blocks.append({"chunk": idx, "parsed": parsed, "finish_reason": finish})
            for w in parsed.get("warnings") or []:
                if str(w).strip():
                    all_warnings.append(str(w).strip())

            qs = parsed.get("questions") or []
            if not isinstance(qs, list):
                continue
            chunk_norms: list[dict[str, Any]] = []
            for item in qs:
                if not isinstance(item, dict):
                    continue
                norm = _normalize_question(item, default_cat)
                if norm:
                    chunk_norms.append(norm)
                else:
                    all_warnings.append(f"块{idx + 1}：跳过无效题目片段")

            if chunk_norms and card_polish_enabled():
                chunk_norms = await polish_questions_for_cards(
                    chunk_norms,
                    api_key=api_key,
                    model=model,
                    client=client,
                )

            for norm in chunk_norms:
                exp = str(norm.get("explanation") or "")
                if len(exp) < CARD_EXPLANATION_MIN_CHARS:
                    stem_preview = str(norm.get("stem") or "")[:24]
                    all_warnings.append(
                        f"块{idx + 1}：解析过短（建议 35～88 字）— {stem_preview}"
                    )
                if len(exp) > CARD_EXPLANATION_MAX_CHARS:
                    stem_preview = str(norm.get("stem") or "")[:24]
                    all_warnings.append(
                        f"块{idx + 1}：解析过长（建议 ≤88 字）— {stem_preview}"
                    )
                if _looks_like_abcd_listing(exp):
                    stem_preview = str(norm.get("stem") or "")[:24]
                    all_warnings.append(f"块{idx + 1}：解析含 A/B/C/D 编号罗列 — {stem_preview}")
                all_questions.append(norm)

    fallback_error = api_error or "未能从文档中识别任何题目"

    if not all_questions and not all_warnings:
        return {
            "ok": False,
            "error": fallback_error,
            "questions": [],
            "warnings": [],
            "raw_blocks": raw_blocks,
        }

    return {
        "ok": bool(all_questions),
        "error": "" if all_questions else fallback_error,
        "questions": all_questions,
        "warnings": all_warnings,
        "raw_blocks": raw_blocks,
    }
