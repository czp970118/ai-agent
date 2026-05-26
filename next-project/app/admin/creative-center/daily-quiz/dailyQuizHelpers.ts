import type { QuestionBankItem } from "@/app/admin/question-bank/questionBankClient";
import { toCoverDisplayUrl } from "../creativeCover";

export const DAILY_QUIZ_SLOT_COUNT = 5;

export function optionsToText(options: string[]): string {
  return options.map((o) => String(o || "").trim()).filter(Boolean).join("\n");
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
