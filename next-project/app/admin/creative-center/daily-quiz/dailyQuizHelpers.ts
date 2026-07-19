import type { QuestionBankItem } from "@/app/admin/question-bank/questionBankClient";
import { formatRealExamSummary } from "@/app/admin/question-bank/realExam";
import { toCoverDisplayUrl } from "../creativeCover";

export const DAILY_QUIZ_SLOT_COUNT = 5;
export const DAILY_QUIZ_RECALL_MIN = 1;
export const DAILY_QUIZ_RECALL_MAX = 20;

/** 召回时真题范围：全部 / 仅真题 / 不含真题 */
export type RecallRealExamFilter = "all" | "only" | "exclude";

export const RECALL_REAL_EXAM_OPTIONS: { id: RecallRealExamFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "only", label: "仅真题" },
  { id: "exclude", label: "不含真题" },
];

/** 题目卡科目顶栏：题库 header 常为「公基」，出图统一为「公基常识」 */
export function quizQuestionCardHeader(header: string): string {
  const h = String(header || "").trim();
  if (!h || h === "公基") return "公基常识";
  return h;
}

/** 题目卡题干：真题时在题干前加（年份+地区+考试类型） */
export function quizQuestionCardStem(
  q: Pick<QuestionBankItem, "stem" | "isRealExam" | "examYear" | "examRegion" | "examKind">,
): string {
  const stem = String(q.stem || "").trim();
  if (q.isRealExam && q.examKind) {
    const exam = formatRealExamSummary(q.examYear ?? "", q.examRegion ?? "", q.examKind);
    if (exam) return `（${exam}）${stem}`;
  }
  return stem;
}

export function optionsToText(options: string[]): string {
  return options
    .map((o) => String(o || "").trim())
    .filter(Boolean)
    .join("\n");
}

/** 答案卡展示行，如「A. 新西兰」 */
export function formatAnswerDisplay(answer: string, options: string[]): string {
  const raw = String(answer || "").trim();
  if (!raw) return "";
  const letters = raw.toUpperCase().replace(/[^A-H]/g, "");
  if (!letters) return raw;

  if (letters.length > 1) {
    const parts = letters.split("").map((letter) => {
      const opt = options.find((o) => optionLetter(o) === letter);
      return opt || letter;
    });
    return parts.join("、");
  }

  const letter = letters[0];
  const matched = options.find((o) => optionLetter(o) === letter);
  if (matched) return matched;
  return `正确答案 ${letter}`;
}

function optionLetter(opt: string): string {
  const m = String(opt || "")
    .trim()
    .match(/^([A-H])[.、．:：]/i);
  return m ? m[1].toUpperCase() : "";
}

export function emptySlotFromQuestion(q: QuestionBankItem) {
  return {
    question: q,
    questionPath: "",
    answerPath: "",
    imageVersion: 0,
    busy: null as null | "generating" | "reroll",
  };
}

/** 同一路径重复生成时追加版本参数，避免浏览器缓存旧图 */
export function toQuizImageDisplayUrl(path: string, version: number): string {
  const base = toCoverDisplayUrl(path);
  if (!base || !version) return base;
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}v=${version}`;
}

export type DailyQuizSlot = ReturnType<typeof emptySlotFromQuestion>;
