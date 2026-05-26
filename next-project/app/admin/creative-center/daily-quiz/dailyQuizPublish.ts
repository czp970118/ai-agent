import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";
import type { CreativeWork } from "../workStorage";
import type { DailyQuizSlot } from "./dailyQuizHelpers";

function publishUrl(): string {
  return `${getMcpBaseUrl().replace(/\/+$/, "")}/chat/questions/daily-quiz/publish`;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text) as { detail?: unknown };
    const d = data.detail;
    if (typeof d === "string") return d;
    return text;
  } catch {
    return text;
  }
}

export async function publishDailyQuiz(input: {
  workId: string;
  title?: string;
  category?: string;
  slots: DailyQuizSlot[];
}): Promise<{ work: CreativeWork; marked: number }> {
  const res = await fetch(publishUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      work_id: input.workId,
      title: input.title,
      category: input.category ?? "",
      slots: input.slots.map((s) => ({
        question_id: s.question.id,
        stem: s.question.stem,
        question_path: s.questionPath,
        answer_path: s.answerPath,
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, "发布失败"));
  }
  const data = (await res.json()) as {
    work?: CreativeWork;
    marked?: number;
  };
  if (!data.work?.id) {
    throw new Error("发布成功但未返回作品信息");
  }
  return { work: data.work, marked: data.marked ?? 0 };
}
