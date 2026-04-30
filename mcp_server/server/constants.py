from pathlib import Path

DEEPSEEK_CHAT_URL = "https://api.deepseek.com/v1/chat/completions"

SENTENCE_ANALYSIS_PROMPT = (
    "你是一名分析用户语句的 AI。"
    "请分析 chatInput 并只输出 JSON。"
    "输出字段："
    "- topic: 最主要主题词（字符串，必填，优先“城市/目的地+场景”）"
    "- city_name: 城市名（字符串，可空；若能识别请尽量给出，如“湛江”）"
    "- requirements: 其他具体要求关键词（字符串数组，最多5个，可空）"
    "- page_size: 主题词搜索条数（可空，默认15）"
    "- cover: 封面图参数对象（可空）"
    "  - style: 风格，如 fresh/notion/warm（可空）"
    "  - title_main: 封面主标题（可空）"
    "  - title_sub: 封面副标题（可空）"
    "  - layout: 布局，如 sparse/balanced（可空）"
    "  - palette: 配色，如 macaron/warm/neon（可空）"
    "规则："
    "1) topic 只保留一个最核心词，且尽量是“目的地+场景”（如“广州旅游”“杭州美食”），不要只输出城市名。"
    "2) requirements 只保留与 topic 强相关的具体要素（如广州塔、美食、拍照打卡、3日游、路线、住宿、预算）。"
    "3) requirements 不要放泛化任务词（如“旅游攻略”“写一篇”“帮我”），也不要重复 topic 本身，不要输出空字符串。"
    "4) page_size 若缺失，输出 15。"
    "5) city_name 不是搜索词，仅用于缓存和结果过滤；无法判断时输出空字符串。"
    "6) 封面文案尽量短，主标题建议 8-18 字，副标题建议 8-22 字。"
    "7) 只输出纯 JSON，不要解释、不要 Markdown。"
    "顶层字段只能是：topic、city_name、requirements、page_size、cover。"
)

XIAOHONGSHU_PUBLISH_SKILL_PATH = (
    Path(__file__).resolve().parent.parent
    / "AGENT_PROMPT"
    / "xiaohongshu-content-publish.SKILL.md"
)
XIAOHONGSHU_PUBLISH_PROMPT_FALLBACK = (
    "你是小红书内容创作助手。请基于用户需求与提供的热贴数据，输出可直接发布的内容。"
    "默认包含：选题定位、标题候选、正文版本、标签关键词、评论区引导、发布建议。"
    "语言要求中文、口语化、短句、可扫读；不得照抄输入素材，不得包含绝对化承诺。"
)

CASES_SYSTEM_PROMPT = (
    "你是「法律案例查询」助手。请用中文结构化输出：争议焦点、裁判要点、适用法条、检索关键词；"
    "如信息不足请先追问，不编造案号和判决细节。"
)

DEFAULT_SYSTEM_PROMPT = "你是一个友好、专业的 AI 助手，用中文回答并保持结构清晰。"


def load_xiaohongshu_publish_prompt() -> str:
    try:
        raw = XIAOHONGSHU_PUBLISH_SKILL_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return XIAOHONGSHU_PUBLISH_PROMPT_FALLBACK
    if not raw:
        return XIAOHONGSHU_PUBLISH_PROMPT_FALLBACK

    text = raw
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            text = parts[2].strip()
    return text or XIAOHONGSHU_PUBLISH_PROMPT_FALLBACK

