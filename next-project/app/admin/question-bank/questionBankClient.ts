import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";
import { pickRealExamFields } from "./realExam";

function mapQuestionBankItem(raw: Record<string, unknown>): QuestionBankItem {
  const exam = pickRealExamFields(raw);
  return {
    id: String(raw.id ?? ""),
    category: String(raw.category ?? ""),
    header: String(raw.header ?? ""),
    stem: String(raw.stem ?? ""),
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    answer: String(raw.answer ?? ""),
    explanation: String(raw.explanation ?? ""),
    extraTitle: raw.extraTitle != null ? String(raw.extraTitle) : undefined,
    extraText: raw.extraText != null ? String(raw.extraText) : undefined,
    questionType:
      raw.questionType != null ? String(raw.questionType) : undefined,
    subjectDomain:
      raw.subjectDomain != null
        ? String(raw.subjectDomain)
        : raw.subject_domain != null
          ? String(raw.subject_domain)
          : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    ...exam,
    status: String(raw.status ?? ""),
    usedAt:
      raw.usedAt != null
        ? String(raw.usedAt)
        : raw.used_at != null
          ? String(raw.used_at)
          : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

function questionsUrl(path: string): string {
  const root = `${getMcpBaseUrl().replace(/\/+$/, "")}/chat/questions`;
  const p = path.trim();
  if (!p) return root;
  if (p.startsWith("?")) return `${root}${p}`;
  return `${root}${p.startsWith("/") ? p : `/${p}`}`;
}

export type QuestionImportMeta = {
  id: string;
  filename: string;
  category: string;
  status: string;
  extractError: string;
  parseError: string;
  questionCount: number;
  confirmedCount: number;
  warnings: string[];
  createdAt: string;
};

export type QuestionImportItem = {
  id: string;
  importId: string;
  rowIndex: number;
  header: string;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  extraTitle: string;
  extraText: string;
  category: string;
  subjectDomain?: string;
  questionType: string;
  confidence: number | null;
  isRealExam?: boolean;
  examYear?: string;
  examRegion?: string;
  examKind?: string;
  examSourceRaw?: string;
  selected: boolean;
  edited: boolean;
};

export type QuestionImportConfig = {
  allowedExtensions: string[];
  maxUploadBytes: number;
  hint: string;
};

export type QuestionBankItem = {
  id: string;
  category: string;
  header: string;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  extraTitle?: string;
  extraText?: string;
  questionType?: string;
  subjectDomain?: string;
  tags?: string[];
  isRealExam?: boolean;
  examYear?: string;
  examRegion?: string;
  examKind?: string;
  status: string;
  usedAt?: string;
  createdAt: string;
};

async function parseError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) return fallback;
  try {
    const data = JSON.parse(text) as { detail?: unknown };
    const d = data.detail;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "message" in d) {
      return String((d as { message: string }).message);
    }
    return text;
  } catch {
    return text;
  }
}

export async function getQuestionBankItem(questionId: string): Promise<QuestionBankItem> {
  const data = await qbFetch<{ ok?: boolean; item: Record<string, unknown> }>(
    `/${encodeURIComponent(questionId)}`,
  );
  if (!data?.item) {
    throw new Error("题目不存在");
  }
  return mapQuestionBankItem(data.item);
}

export async function qbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(questionsUrl(path), {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `${res.status} ${res.statusText}`));
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function fetchQuestionImportConfig(): Promise<QuestionImportConfig> {
  const data = await qbFetch<{ ok: boolean } & QuestionImportConfig>("/import/config");
  return {
    allowedExtensions: data.allowedExtensions || [".docx"],
    maxUploadBytes: Number(data.maxUploadBytes) || 20 * 1024 * 1024,
    hint: String(data.hint || ""),
  };
}

export type ExtractTextPreview = {
  questionText: string;
  answerText: string;
  questionCharCount: number;
  answerCharCount: number;
  questionTruncated: boolean;
  answerTruncated: boolean;
  questionFormat: string;
  answerFormat: string;
  charCount: number;
  estimatedLlmCalls: number;
  extractedTextTruncated: boolean;
  /** @deprecated 合并预览，请用 questionText / answerText */
  extractedText?: string;
};

export type UploadExtractResult = {
  ok: boolean;
  import: QuestionImportMeta;
  hasAnswerVolume?: boolean;
  items: QuestionImportItem[];
  warnings: string[];
  error?: string;
} & ExtractTextPreview;

export type ParseImportResult = {
  ok: boolean;
  import: QuestionImportMeta;
  items: QuestionImportItem[];
  warnings: string[];
  error?: string;
};

export async function uploadQuestionExtract(
  files: File[],
  category: string,
): Promise<UploadExtractResult> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  form.append("category", category);
  const res = await fetch(questionsUrl("/import/upload"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(await parseError(res, "上传失败"));
  }
  return res.json();
}

export async function pasteQuestionExtract(input: {
  category: string;
  text: string;
}): Promise<UploadExtractResult> {
  const res = await fetch(questionsUrl("/import/paste"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: input.category,
      question_text: input.text,
      answer_text: "",
    }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, "提交失败"));
  }
  return res.json();
}

/** @deprecated 使用 uploadQuestionExtract + parseQuestionImport */
export const uploadQuestionDocx = uploadQuestionExtract;

export async function parseQuestionImport(importId: string): Promise<ParseImportResult> {
  return qbFetch(`/import/${importId}/parse`, { method: "POST" });
}

export async function fetchExtractedText(importId: string): Promise<ExtractTextPreview> {
  const data = await qbFetch<{ ok: boolean } & ExtractTextPreview>(
    `/import/${importId}/extracted-text`,
  );
  return {
    questionText: data.questionText || "",
    answerText: data.answerText || "",
    questionCharCount: data.questionCharCount ?? 0,
    answerCharCount: data.answerCharCount ?? 0,
    questionTruncated: Boolean(data.questionTruncated),
    answerTruncated: Boolean(data.answerTruncated),
    questionFormat: data.questionFormat || ".docx",
    answerFormat: data.answerFormat || "",
    charCount: data.charCount ?? 0,
    estimatedLlmCalls: data.estimatedLlmCalls ?? 0,
    extractedTextTruncated: Boolean(data.extractedTextTruncated),
    extractedText: data.extractedText,
  };
}

export type QuestionBankUsageFilter = "all" | "unused" | "used";

export async function listQuestionBank(params?: {
  category?: string;
  subjectDomain?: string;
  usage?: QuestionBankUsageFilter;
  tags?: string[];
  limit?: number;
  offset?: number;
}): Promise<{
  items: QuestionBankItem[];
  total: number;
  usedTotal: number;
  unusedTotal: number;
}> {
  const q = new URLSearchParams();
  if (params?.category) q.set("category", params.category);
  if (params?.subjectDomain) q.set("subject_domain", params.subjectDomain);
  if (params?.usage && params.usage !== "all") q.set("usage", params.usage);
  if (params?.tags?.length) q.set("tags", params.tags.join(","));
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  const suffix = q.toString() ? `?${q}` : "";
  const data = await qbFetch<{
    items: QuestionBankItem[];
    total: number;
    usedTotal?: number;
    unusedTotal?: number;
  }>(suffix);
  return {
    items: (data.items || []).map((it) =>
      mapQuestionBankItem(it as unknown as Record<string, unknown>),
    ),
    total: data.total || 0,
    usedTotal: data.usedTotal ?? 0,
    unusedTotal: data.unusedTotal ?? 0,
  };
}

export async function recallQuestions(input?: {
  count?: number;
  excludeIds?: string[];
  category?: string;
  subjectDomain?: string;
  tags?: string[];
  realExamFilter?: "all" | "only" | "exclude";
}): Promise<{
  items: QuestionBankItem[];
  requested: number;
  returned: number;
  available: number;
}> {
  return qbFetch("/recall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      count: input?.count ?? 7,
      exclude_ids: input?.excludeIds ?? [],
      category: input?.category ?? "",
      subject_domain: input?.subjectDomain ?? "",
      tags: input?.tags ?? [],
      real_exam_filter: input?.realExamFilter ?? "all",
    }),
  });
}

export type ConfirmImportOptions = {
  tags?: string[];
  isRealExam?: boolean;
  examYear?: string;
  examRegion?: string;
  examKind?: string;
};

export async function confirmQuestionImport(
  importId: string,
  itemIds?: string[],
  options?: ConfirmImportOptions,
): Promise<{
  inserted: number;
  skippedDuplicates: number;
  duplicateStems: string[];
}> {
  return qbFetch(`/import/${importId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(itemIds?.length ? { item_ids: itemIds } : {}),
      tags: options?.tags ?? [],
      is_real_exam: Boolean(options?.isRealExam),
      exam_year: options?.examYear ?? "",
      exam_region: options?.examRegion ?? "",
      exam_kind: options?.examKind ?? "",
    }),
  });
}

export async function patchImportItem(
  importId: string,
  itemId: string,
  patch: Partial<QuestionImportItem>,
): Promise<QuestionImportItem> {
  const data = await qbFetch<{ item: QuestionImportItem }>(
    `/import/${importId}/items/${itemId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  return data.item;
}

export async function reparseImport(importId: string): Promise<ParseImportResult> {
  return qbFetch(`/import/${importId}/reparse`, { method: "POST" });
}

export async function patchQuestionBank(
  questionId: string,
  patch: Partial<
    Pick<
      QuestionBankItem,
      | "header"
      | "stem"
      | "options"
      | "answer"
      | "explanation"
      | "extraTitle"
      | "extraText"
      | "category"
      | "subjectDomain"
      | "tags"
      | "isRealExam"
      | "examYear"
      | "examRegion"
      | "examKind"
    >
  >,
): Promise<QuestionBankItem> {
  const data = await qbFetch<{ item: Record<string, unknown> }>(`/${questionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return mapQuestionBankItem(data.item);
}

export async function deleteQuestionBank(questionId: string): Promise<number> {
  const data = await qbFetch<{ deleted: number }>(`/${questionId}`, {
    method: "DELETE",
  });
  return data.deleted;
}

export async function deleteQuestionBankBatch(ids: string[]): Promise<number> {
  const data = await qbFetch<{ deleted: number }>("/delete-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return data.deleted;
}
