from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
VENDOR_REFS = REPO_ROOT / "mcp_server" / "vendor" / "baoyu-image-cards" / "references"
IMAGE_CARDS_ROOT = REPO_ROOT / "image-cards"


def extend_paths() -> list[Path]:
    home = Path.home()
    return [
        REPO_ROOT / ".baoyu-skills" / "baoyu-image-cards" / "EXTEND.md",
        Path.home() / ".config" / "baoyu-skills" / "baoyu-image-cards" / "EXTEND.md",
        home / ".baoyu-skills" / "baoyu-image-cards" / "EXTEND.md",
    ]
