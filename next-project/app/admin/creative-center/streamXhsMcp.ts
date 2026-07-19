import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";
import { getSessionUserId } from "@/app/assistant/utils/sessionUserId";
import type {
  MessageReference,
  MessageSearchMeta,
  McpStreamEvent,
} from "@/app/assistant/utils/types";

export function parseSseChunk(chunk: string): McpStreamEvent[] {
  const blocks = chunk.split("\n\n");
  const events: McpStreamEvent[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim() || "message";
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (!dataLines.length) continue;
    const joined = dataLines.join("\n");
    let data: unknown = joined;
    try {
      data = JSON.parse(joined);
    } catch {
      // keep as string
    }
    events.push({ event, data });
  }
  return events;
}

export function normalizeReferences(data: unknown): MessageReference[] {
  if (!Array.isArray(data)) return [];
  const refs: MessageReference[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const title = String((item as { title?: unknown }).title ?? "").trim();
    const url = String((item as { url?: unknown }).url ?? "").trim();
    if (!url) continue;
    refs.push({ title: title || url, url });
  }
  return refs;
}

export function normalizeSearchMeta(data: unknown): MessageSearchMeta | undefined {
  if (!data || typeof data !== "object") return undefined;
  const raw = data as { query_count?: unknown; query_terms?: unknown };
  const queryCount = Number(raw.query_count);
  const queryTerms = Array.isArray(raw.query_terms)
    ? raw.query_terms
        .map((x) => String(x ?? "").trim())
        .filter((x) => !!x)
        .slice(0, 8)
    : [];
  return {
    queryCount: Number.isFinite(queryCount)
      ? Math.max(0, Math.trunc(queryCount))
      : queryTerms.length,
    queryTerms,
  };
}

export type StreamXhsOptions = {
  userPrompt: string;
  workflow: Record<string, unknown>;
  signal: AbortSignal;
  /** Called with accumulated assistant text on each delta */
  onDelta: (fullText: string) => void;
};

export async function streamXhsPostGeneration(opts: StreamXhsOptions): Promise<{
  content: string;
  references: MessageReference[];
  searchMeta?: MessageSearchMeta;
  coverImagePath?: string;
}> {
  const wf: Record<string, unknown> = { ...opts.workflow, user_id: getSessionUserId() };

  const res = await fetch(`${getMcpBaseUrl()}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: "xiaohongshu",
      workflow: wf,
      messages: [{ role: "user", content: opts.userPrompt }],
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `流式请求失败(${res.status})`);
  }
  if (!res.body) {
    throw new Error("服务器未返回可读取的流");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let lastReferences: MessageReference[] = [];
  let lastSearchMeta: MessageSearchMeta | undefined;
  let coverImagePath = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const events = parseSseChunk(`${part}\n\n`);
      for (const evt of events) {
        if (evt.event === "delta") {
          const piece =
            typeof evt.data === "object" &&
            evt.data &&
            "content" in evt.data &&
            typeof (evt.data as { content?: unknown }).content === "string"
              ? String((evt.data as { content: string }).content)
              : "";
          if (!piece) continue;
          content += piece;
          opts.onDelta(content);
        } else if (evt.event === "error") {
          const message =
            typeof evt.data === "object" &&
            evt.data &&
            "error" in evt.data &&
            typeof (evt.data as { error?: unknown }).error === "string"
              ? String((evt.data as { error: string }).error)
              : "流式生成失败";
          throw new Error(message);
        } else if (evt.event === "end") {
          const endContent =
            typeof evt.data === "object" &&
            evt.data &&
            "content" in evt.data &&
            typeof (evt.data as { content?: unknown }).content === "string"
              ? String((evt.data as { content: string }).content)
              : "";
          const endRefs =
            typeof evt.data === "object" && evt.data && "references" in evt.data
              ? normalizeReferences((evt.data as { references?: unknown }).references)
              : [];
          const endSearchMeta =
            typeof evt.data === "object" && evt.data && "search_meta" in evt.data
              ? normalizeSearchMeta((evt.data as { search_meta?: unknown }).search_meta)
              : undefined;
          const endCoverImagePath =
            typeof evt.data === "object" &&
            evt.data &&
            "cover_image" in evt.data &&
            typeof (evt.data as { cover_image?: unknown }).cover_image === "object" &&
            (evt.data as { cover_image: { ok?: unknown; image_path?: unknown } }).cover_image &&
            (evt.data as { cover_image: { ok?: unknown; image_path?: unknown } }).cover_image.ok ===
              true &&
            typeof (evt.data as { cover_image: { image_path?: unknown } }).cover_image
              .image_path === "string"
              ? String((evt.data as { cover_image: { image_path: string } }).cover_image.image_path)
              : "";
          const endCoverImageError =
            typeof evt.data === "object" &&
            evt.data &&
            "cover_image" in evt.data &&
            typeof (evt.data as { cover_image?: unknown }).cover_image === "object" &&
            (evt.data as { cover_image: { ok?: unknown; error?: unknown } }).cover_image &&
            (evt.data as { cover_image: { ok?: unknown; error?: unknown } }).cover_image.ok ===
              false &&
            typeof (evt.data as { cover_image: { error?: unknown } }).cover_image.error === "string"
              ? String((evt.data as { cover_image: { error: string } }).cover_image.error)
              : "";

          let finalContent = (endContent || content || "").trim() || "没有收到回复。";
          if (endCoverImagePath) {
            coverImagePath = endCoverImagePath;
            finalContent = `${finalContent}\n\n封面图已生成`;
          } else if (endCoverImageError) {
            finalContent = `${finalContent}\n\n封面图生成失败：${endCoverImageError}`;
          }
          content = finalContent;
          lastReferences = endRefs;
          lastSearchMeta = endSearchMeta;
          opts.onDelta(finalContent);
        }
      }
    }
  }

  return {
    content: content.trim() || "没有收到回复。",
    references: lastReferences,
    searchMeta: lastSearchMeta,
    coverImagePath: coverImagePath || undefined,
  };
}
