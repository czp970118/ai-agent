import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
EXTEND_PATH = REPO_ROOT / ".baoyu-skills" / "baoyu-image-cards" / "EXTEND.md"
Z_IMAGE_SCRIPT = REPO_ROOT / "scripts" / "z-image-turbo.sh"


def _topic_slug(topic: str) -> str:
    slug = topic.strip().lower()
    slug = re.sub(r"[^a-z0-9\-_\u4e00-\u9fff]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug or "xhs-cover"


def _read_extend_defaults() -> dict[str, str]:
    defaults = {"style": "notion", "layout": "sparse", "palette": "macaron"}
    if not EXTEND_PATH.is_file():
        return defaults
    text = EXTEND_PATH.read_text(encoding="utf-8")
    for line in text.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        key = k.strip()
        val = v.strip().strip('"').strip("'")
        if key == "preferred_style" and val:
            defaults["style"] = val
        elif key == "preferred_layout" and val:
            defaults["layout"] = val
        elif key == "preferred_palette" and val and val != "none":
            defaults["palette"] = val
    return defaults


def _pick_title_sub(content: str, fallback: str) -> str:
    lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
    for line in lines:
        if len(line) <= 28 and not line.startswith("#"):
            return line
    return fallback


def generate_xhs_cover_image(
    *,
    topic: str,
    content: str,
    workflow: dict[str, Any] | None = None,
) -> dict[str, Any]:
    wf = workflow or {}
    if not bool(wf.get("generate_cover_image")):
        return {"ok": False, "skipped": True, "reason": "generate_cover_image disabled"}
    if not Z_IMAGE_SCRIPT.is_file():
        return {"ok": False, "error": f"missing script: {Z_IMAGE_SCRIPT}"}
    if not os.getenv("DASHSCOPE_API_KEY", "").strip():
        return {"ok": False, "error": "missing DASHSCOPE_API_KEY"}

    defaults = _read_extend_defaults()
    cover_cfg = wf.get("cover") if isinstance(wf.get("cover"), dict) else {}
    style = str(cover_cfg.get("style") or defaults["style"]).strip()
    layout = str(cover_cfg.get("layout") or defaults["layout"]).strip()
    palette = str(cover_cfg.get("palette") or defaults["palette"]).strip()
    title_main = str(cover_cfg.get("title_main") or topic).strip()
    title_sub = str(cover_cfg.get("title_sub") or _pick_title_sub(content, "复习路径与实操经验")).strip()

    slug = str(cover_cfg.get("slug") or _topic_slug(topic))
    base_dir = REPO_ROOT / "image-cards" / slug
    prompt_dir = base_dir / "prompts"
    prompt_dir.mkdir(parents=True, exist_ok=True)
    out_path = base_dir / f"01-cover-{slug}.png"
    prompt_path = prompt_dir / f"01-cover-{slug}.md"

    if prompt_path.exists():
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        prompt_path.rename(prompt_dir / f"01-cover-{slug}-backup-{ts}.md")
    if out_path.exists():
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        out_path.rename(base_dir / f"01-cover-{slug}-backup-{ts}.png")

    prompt = (
        "请生成一张小红书竖版封面图。\n"
        f"- 主题：{topic}\n"
        f"- 风格：{style}\n"
        f"- 布局：{layout}\n"
        f"- 配色：{palette}\n"
        f"- 主标题：{title_main}\n"
        f"- 副标题：{title_sub}\n"
        "- 视觉：干净、信息明确、大留白，手机端一眼读懂。\n"
        "- 元素：书本、打卡日历、对勾清单。\n"
        "- 避免：人物写实脸、复杂背景、文字过多。\n"
    )
    prompt_path.write_text(prompt, encoding="utf-8")

    size = str(cover_cfg.get("size") or os.getenv("DASHSCOPE_IMAGE_SIZE", "1024*1536")).strip()
    proc = subprocess.run(
        ["bash", str(Z_IMAGE_SCRIPT), prompt, str(out_path), size],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return {
            "ok": False,
            "error": (proc.stderr or proc.stdout or "generate failed").strip()[-1000:],
            "prompt_path": str(prompt_path),
        }
    return {
        "ok": True,
        "prompt_path": str(prompt_path),
        "image_path": str(out_path),
        "style": style,
        "layout": layout,
        "palette": palette,
    }
