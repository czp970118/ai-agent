/** 行测类真题常见考试来源（与后端 real_exam.py 一致） */
export const REAL_EXAM_KINDS = ["国考", "省考", "联考", "事业单位", "选调生"] as const;

export type RealExamKind = (typeof REAL_EXAM_KINDS)[number];

const EXAM_KIND_ALIASES: Record<string, RealExamKind> = {
  事业编: "事业单位",
};

const KINDS_REQUIRE_REGION = new Set<RealExamKind>(["省考", "联考", "事业单位", "选调生"]);

export function canonicalExamKind(kind: string): string {
  const k = kind.trim();
  return EXAM_KIND_ALIASES[k] ?? k;
}

export function realExamKindNeedsRegion(kind: string): boolean {
  return KINDS_REQUIRE_REGION.has(canonicalExamKind(kind) as RealExamKind);
}

export function formatRealExamSummary(year: string, region: string, kind: string): string {
  const k = canonicalExamKind(kind);
  if (!k) return "";
  const y = year.trim();
  let r = region.trim();
  if (k === "国考" && !r) r = "全国";
  if (y) return `${y}年${r}${k}`;
  return r ? `${r}${k}` : k;
}

export function realExamKindsLabel(): string {
  return REAL_EXAM_KINDS.join("、");
}

/** 列表/卡片：是否展示真题来源文案 */
export function questionHasRealExamMeta(item: {
  isRealExam?: boolean;
  examKind?: string;
}): boolean {
  return Boolean(item.isRealExam) || Boolean(String(item.examKind || "").trim());
}

/** 兼容 API 返回 camelCase / snake_case */
export function pickRealExamFields(raw: Record<string, unknown>): {
  isRealExam: boolean;
  examYear: string;
  examRegion: string;
  examKind: string;
} {
  return {
    isRealExam: Boolean(raw.isRealExam ?? raw.is_real_exam),
    examYear: String(raw.examYear ?? raw.exam_year ?? ""),
    examRegion: String(raw.examRegion ?? raw.exam_region ?? ""),
    examKind: canonicalExamKind(String(raw.examKind ?? raw.exam_kind ?? "")),
  };
}
