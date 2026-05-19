/** 与 mcp_server baoyu_image_cards/catalog.py 对齐，供前端展示中文 */

export const STYLE_LABELS: Record<string, string> = {
  cute: "甜美可爱，经典小红书少女风",
  fresh: "清新自然，干净通透",
  warm: "温暖亲切，生活感",
  bold: "高对比醒目，强提醒",
  minimal: "极简留白，高级感",
  retro: "复古怀旧，潮流感",
  pop: "高饱和潮流，吸睛",
  notion: "手绘线稿知识风，理性克制",
  chalkboard: "彩色粉笔黑板，教学感",
  "study-notes": "仿真手写笔记，蓝笔红批",
  "screen-print": "丝网海报，大色块",
  "sketch-notes": "手绘教育信息图，马卡龙奶油底",
};

export const LAYOUT_LABELS: Record<string, string> = {
  sparse: "1–2 个要点，封面冲击力强",
  balanced: "3–4 个要点，常规信息密度",
  dense: "5–8 个要点，知识卡",
  list: "清单 / 排行 4–7 项",
  comparison: "左右对比",
  flow: "流程 / 时间线 3–6 步",
  mindmap: "中心发散 4–8 枝",
  quadrant: "四象限",
};

export const PALETTE_LABELS: Record<string, string> = {
  macaron: "奶油底 + 马卡龙分区色",
  warm: "暖桃大地色，生活情感",
  neon: "深紫底霓虹色，强能量感",
};

export function styleLabel(id: string, apiLabel?: string): string {
  const key = String(id || "").trim();
  if (!key) return "跟随 Preset";
  return apiLabel?.trim() || STYLE_LABELS[key] || key;
}

export function layoutLabel(id: string, apiLabel?: string): string {
  const key = String(id || "").trim();
  if (!key) return "跟随 Preset";
  return apiLabel?.trim() || LAYOUT_LABELS[key] || key;
}

export function paletteLabel(id: string, apiLabel?: string): string {
  const key = String(id || "").trim();
  if (!key) return "默认（随风格）";
  return apiLabel?.trim() || PALETTE_LABELS[key] || key;
}
