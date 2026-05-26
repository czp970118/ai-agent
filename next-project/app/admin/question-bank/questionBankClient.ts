import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";

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
  questionType: string;
  confidence: number | null;
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
  file: File | null,
  category: string,
  answerFile?: File | null,
): Promise<UploadExtractResult> {
  const form = new FormData();
  if (file) {
    form.append("file", file);
  }
  form.append("category", category);
  if (answerFile) {
    form.append("answer_file", answerFile);
  }
  const res = await fetch(questionsUrl("/import/upload"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(await parseError(res, "上传失败"));
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
  usage?: QuestionBankUsageFilter;
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
  if (params?.usage && params.usage !== "all") q.set("usage", params.usage);
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
    items: data.items || [],
    total: data.total || 0,
    usedTotal: data.usedTotal ?? 0,
    unusedTotal: data.unusedTotal ?? 0,
  };
}

export async function recallQuestions(input?: {
  count?: number;
  excludeIds?: string[];
  category?: string;
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
    }),
  });
}

export async function confirmQuestionImport(
  importId: string,
  itemIds?: string[],
): Promise<{
  inserted: number;
  skippedDuplicates: number;
  duplicateStems: string[];
}> {
  return qbFetch(`/import/${importId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(itemIds?.length ? { item_ids: itemIds } : {}),
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
