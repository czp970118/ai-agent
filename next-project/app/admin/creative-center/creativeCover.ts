import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";

const OSS_IMAGE_PREFIX = "xhs/images";

function isOssImageKey(path: string): boolean {
  const p = String(path || "").trim();
  if (!p) return false;
  const key = p.startsWith("oss:") ? p.slice(4).replace(/^\/+/, "") : p;
  return key === OSS_IMAGE_PREFIX || key.startsWith(`${OSS_IMAGE_PREFIX}/`);
}

function toOssProxyUrl(key: string): string {
  const k = String(key || "").trim();
  if (!k) return "";
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  return `${base}/chat/oss/image?key=${encodeURIComponent(k)}`;
}

export type CoverSource = "upload" | "generated" | "overlay" | "quiz";

export type CreativeCoverState = {
  path: string;
  source: CoverSource | null;
  templateId: string;
  templateName: string;
  preset: string;
  style: string;
  layout: string;
  palette: string;
  refUrls: string[];
  titleMain: string;
  titleSub: string;
};

export type CoverTemplateOption = {
  id: string;
  name: string;
  body: string;
};

export type ImageCardsCatalog = {
  styles: Array<{ id: string; label: string }>;
  layouts: Array<{ id: string; label: string }>;
  palettes: Array<{ id: string; label: string }>;
  presets: Array<{
    id: string;
    label: string;
    style: string;
    layout: string;
    palette: string | null;
    forCover: boolean;
  }>;
  coverPresetIds: string[];
  extend: Record<string, unknown>;
  workflow: { promptDir: string; coverFile: string; aspectRatio: string; skillDoc: string };
};

export const COVER_TEMPLATE_DOMAIN = "封面模版";

export function emptyCreativeCover(): CreativeCoverState {
  return {
    path: "",
    source: null,
    templateId: "",
    templateName: "",
    preset: "clean-quote",
    style: "",
    layout: "",
    palette: "",
    refUrls: [],
    titleMain: "",
    titleSub: "",
  };
}

export function coverFromWork(work: {
  coverPath?: string;
  coverSource?: string;
  coverTemplateId?: string;
  coverRefUrls?: string[];
  coverTitleMain?: string;
  coverTitleSub?: string;
}): CreativeCoverState {
  const path = String(work.coverPath || "").trim();
  const raw = String(work.coverSource || "").trim();
  const src: CoverSource | null =
    raw === "generated"
      ? "generated"
      : raw === "overlay"
        ? "overlay"
        : raw === "quiz"
          ? "quiz"
          : raw === "upload"
            ? "upload"
            : null;
  return {
    path,
    source: path ? (src ?? "upload") : null,
    templateId: String(work.coverTemplateId || ""),
    templateName: "",
    preset: "clean-quote",
    style: "",
    layout: "",
    palette: "",
    refUrls: Array.isArray(work.coverRefUrls) ? work.coverRefUrls : [],
    titleMain: String(work.coverTitleMain || ""),
    titleSub: String(work.coverTitleSub || ""),
  };
}

export function toCoverDisplayUrl(imagePath: string | undefined): string {
  const p = String(imagePath || "").trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  if (isOssImageKey(p)) return toOssProxyUrl(p.startsWith("oss:") ? p.slice(4) : p);
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  return `${base}/chat/generated-image?path=${encodeURIComponent(p)}`;
}

export function coverToWorkPatch(cover: CreativeCoverState) {
  return {
    coverPath: cover.path,
    coverSource: cover.source ?? "upload",
    coverTemplateId: cover.templateId,
    coverRefUrls: cover.refUrls,
    coverTitleMain: cover.titleMain,
    coverTitleSub: cover.titleSub,
  };
}

export async function fetchImageCardsCatalog(): Promise<ImageCardsCatalog> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/image-cards/catalog`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as ImageCardsCatalog;
}

export async function fetchCoverTemplates(): Promise<CoverTemplateOption[]> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const params = new URLSearchParams({
    agent: "xiaohongshu",
    domain: COVER_TEMPLATE_DOMAIN,
    include_body: "true",
  });
  const res = await fetch(`${base}/chat/prompt-library?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    categories?: Array<{ styles?: Array<{ id: string; name: string; body?: string }> }>;
  };
  const cats = Array.isArray(data.categories) ? data.categories : [];
  const out: CoverTemplateOption[] = [];
  for (const cat of cats) {
    for (const s of cat.styles ?? []) {
      out.push({ id: s.id, name: s.name, body: s.body ?? "" });
    }
  }
  return out;
}

export async function uploadCoverBase(workId: string, file: File): Promise<string> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `${base}/chat/creative-works/${encodeURIComponent(workId)}/cover/base/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { base_image_path?: string };
  const path = String(data.base_image_path || "").trim();
  if (!path) throw new Error("上传成功但未返回底图路径");
  return path;
}

export async function overlayWorkCover(input: {
  workId: string;
  titleMain: string;
  titleSub: string;
  baseImagePath?: string;
  baseImageUrl?: string;
}): Promise<string> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/cover/overlay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      work_id: input.workId,
      title_main: input.titleMain,
      title_sub: input.titleSub,
      base_image_path: input.baseImagePath || undefined,
      base_image_url: input.baseImageUrl || undefined,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { image_path?: string };
  const path = String(data.image_path || "").trim();
  if (!path) throw new Error("叠字成功但未返回路径");
  return path;
}

export async function uploadWorkCover(workId: string, file: File): Promise<string> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `${base}/chat/creative-works/${encodeURIComponent(workId)}/cover/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { image_path?: string };
  const path = String(data.image_path || "").trim();
  if (!path) throw new Error("上传成功但未返回路径");
  return path;
}

export async function generateWorkCover(input: {
  workId: string;
  templateStyleId?: string;
  preset?: string;
  style?: string;
  layout?: string;
  palette?: string;
  topic: string;
  content: string;
  titleMain: string;
  titleSub: string;
  referenceImageUrls: string[];
}): Promise<{ path: string; promptPath?: string }> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/cover/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      work_id: input.workId,
      template_style_id: input.templateStyleId || undefined,
      preset: input.preset || undefined,
      style: input.style || undefined,
      layout: input.layout || undefined,
      palette: input.palette || undefined,
      topic: input.topic,
      content: input.content,
      title_main: input.titleMain,
      title_sub: input.titleSub,
      reference_image_urls: input.referenceImageUrls,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    image_path?: string;
    baoyu?: { assembled_prompt_path?: string };
  };
  const path = String(data.image_path || "").trim();
  if (!path) throw new Error("生成成功但未返回路径");
  return {
    path,
    promptPath: data.baoyu?.assembled_prompt_path,
  };
}

export async function renderQuizQuestionCard(input: {
  workId: string;
  header: string;
  question: string;
  optionsText: string;
}): Promise<string> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/quiz-card/question`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      work_id: input.workId,
      header: input.header,
      question: input.question,
      options_text: input.optionsText,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { image_path?: string };
  const path = String(data.image_path || "").trim();
  if (!path) throw new Error("生成成功但未返回路径");
  return path;
}

export async function renderQuizAnswerCard(input: {
  workId: string;
  header: string;
  answer: string;
  explanation: string;
  extraTitle: string;
  extraText: string;
}): Promise<string> {
  const base = getMcpBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/quiz-card/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      work_id: input.workId,
      header: input.header,
      answer: input.answer,
      explanation: input.explanation,
      extra_title: input.extraTitle,
      extra_text: input.extraText,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { image_path?: string };
  const path = String(data.image_path || "").trim();
  if (!path) throw new Error("生成成功但未返回路径");
  return path;
}
