"""baoyu-image-cards skill 对接：目录、提示词组装、封面出图。"""

from .catalog import get_catalog
from .generator import generate_baoyu_cover

__all__ = ["get_catalog", "generate_baoyu_cover"]
