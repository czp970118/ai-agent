export type ParsedDailyQuizSlot = {
  index: number;
  questionId: string;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
};

export type ParsedDailyQuizBody = {
  summary: string;
  slots: ParsedDailyQuizSlot[];
};

const SLOT_QID_RE = /-slot-(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function isDailyQuizWork(work: {
  coverSource?: string;
  prompt?: string;
  title?: string;
}): boolean {
  const src = String(work.coverSource || "").trim();
  if (src === "quiz") return true;
  const prompt = String(work.prompt || "");
  const title = String(work.title || "");
  return prompt.includes("每日一题") || title.includes("每日一题");
}

/** 从出图路径中解析 slot 序号 → 题库题目 ID（兼容未写入 question_id 的旧作品） */
export function questionIdsBySlotFromRefs(paths: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const raw of paths) {
    const text = String(raw || "");
    if (!text) continue;
    let m: RegExpExecArray | null;
    SLOT_QID_RE.lastIndex = 0;
    while ((m = SLOT_QID_RE.exec(text)) !== null) {
      const index = Number(m[1]);
      const qid = m[2];
      if (Number.isFinite(index) && qid) {
        map.set(index, qid);
      }
    }
  }
  return map;
}

export function parseDailyQuizBody(body: string): ParsedDailyQuizBody {
  const text = String(body || "").trim();
  if (!text) {
    return { summary: "", slots: [] };
  }

  const parts = text.split(/^## 第 (\d+) 题\s*$/m);
  let summary = "";
  const slots: ParsedDailyQuizSlot[] = [];

  if (parts.length <= 1) {
    return { summary: text, slots: [] };
  }

  summary = parts[0].trim();
  for (let i = 1; i < parts.length; i += 2) {
    const index = Number(parts[i]);
    const block = String(parts[i + 1] ?? "").trim();
    if (!block) continue;

    let questionId = "";
    let answer = "";
    let explanation = "";
    let options: string[] = [];
    const stemLines: string[] = [];
    let inExplanation = false;

    const isMetaLine = (t: string) =>
      /^question_id:/i.test(t) ||
      /^answer:/i.test(t) ||
      /^explanation:/i.test(t) ||
      /^options:/i.test(t) ||
      /^- (题目卡|答案卡)：/.test(t);

    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inExplanation) explanation += "\n";
        continue;
      }
      const qidMatch = trimmed.match(/^question_id:\s*(.+)$/i);
      if (qidMatch) {
        inExplanation = false;
        questionId = qidMatch[1].trim();
        continue;
      }
      const answerMatch = trimmed.match(/^answer:\s*(.+)$/i);
      if (answerMatch) {
        inExplanation = false;
        answer = answerMatch[1].trim();
        continue;
      }
      const explMatch = trimmed.match(/^explanation:\s*(.*)$/i);
      if (explMatch) {
        inExplanation = true;
        explanation = explMatch[1].trim();
        continue;
      }
      const optMatch = trimmed.match(/^options:\s*(.+)$/i);
      if (optMatch) {
        inExplanation = false;
        try {
          const parsed = JSON.parse(optMatch[1]) as unknown;
          if (Array.isArray(parsed)) {
            options = parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
          }
        } catch {
          // ignore
        }
        continue;
      }
      if (/^- (题目卡|答案卡)：/.test(trimmed)) {
        inExplanation = false;
        continue;
      }
      if (inExplanation) {
        explanation = explanation ? `${explanation}\n${trimmed}` : trimmed;
        continue;
      }
      if (!isMetaLine(trimmed)) {
        stemLines.push(trimmed);
      }
    }

    slots.push({
      index: Number.isFinite(index) ? index : slots.length + 1,
      questionId,
      stem: stemLines.join("\n").trim(),
      options,
      answer,
      explanation,
    });
  }

  return { summary, slots };
}

export function mergeSlotsWithRefQuestionIds(
  slots: ParsedDailyQuizSlot[],
  refPaths: string[],
): ParsedDailyQuizSlot[] {
  const bySlot = questionIdsBySlotFromRefs(refPaths);
  if (!bySlot.size) return slots;
  return slots.map((s) => ({
    ...s,
    questionId: s.questionId || bySlot.get(s.index) || "",
  }));
}
