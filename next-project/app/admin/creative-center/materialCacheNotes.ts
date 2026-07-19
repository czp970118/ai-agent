import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";
import type { MessageReference } from "@/app/assistant/utils/types";

export type MaterialCacheNote = {
  note_id: string;
  title: string;
  url: string;
  image_list?: string[];
};

function mcpBase(): string {
  return getMcpBaseUrl().replace(/\/+$/, "");
}

/** 从缓存项中解析出可展示的配图 URL（兼容字符串、已代理路径、WB_DFT 对象） */
export function coerceMaterialImageSrc(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  const o = item as Record<string, unknown>;
  for (const key of ["url", "image_url", "src", "origin_url"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const infoList = o.info_list;
  if (Array.isArray(infoList)) {
    for (const info of infoList) {
      if (!info || typeof info !== "object") continue;
      const row = info as Record<string, unknown>;
      if (String(row.image_scene || "") === "WB_DFT") {
        const u = String(row.url || "").trim();
        if (u) return u;
      }
    }
    for (const info of infoList) {
      if (!info || typeof info !== "object") continue;
      const u = String((info as Record<string, unknown>).url || "").trim();
      if (u) return u;
    }
  }
  return "";
}

export function extractMaterialImageUrls(imageList: unknown): string[] {
  if (!Array.isArray(imageList)) return [];
  const out: string[] = [];
  for (const item of imageList) {
    const url = coerceMaterialImageSrc(item);
    if (url) out.push(url);
  }
  return out;
}

export function noteIdFromReferenceUrl(url: string): string {
  const u = String(url || "").split("?")[0];
  const m = u.match(/\/([0-9a-f]{24})(?:\b|\/|$)/i);
  return m?.[1] ?? "";
}

/** 解析为可在 <img src> 中使用的最终地址（避免对已代理 URL 二次包装） */
export function resolveMaterialImageDisplayUrl(raw: string): string {
  const src = String(raw || "").trim();
  if (!src) return "";
  const base = mcpBase();

  if (src.includes("/search/xhs-image-proxy")) {
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith("/")) return `${base}${src}`;
    return src;
  }

  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  if (src.startsWith("/")) return `${base}${src}`;
  if (src.startsWith("//")) return `https:${src}`;
  if (!/^https?:\/\//i.test(src)) return "";

  try {
    const host = new URL(src).hostname.toLowerCase();
    if (host.endsWith("xhscdn.com")) {
      return `${base}/search/xhs-image-proxy?url=${encodeURIComponent(src)}`;
    }
  } catch {
    return "";
  }
  return src;
}

/** @deprecated 使用 resolveMaterialImageDisplayUrl */
export function toProxyMaterialImageUrl(src: string): string {
  return resolveMaterialImageDisplayUrl(src);
}

export function materialImageKey(noteId: string, src: string, index: number): string {
  return `${noteId}:${index}:${src}`;
}

export type MaterialGalleryImage = {
  key: string;
  src: string;
  displayUrl: string;
  noteId: string;
  noteTitle: string;
  noteUrl: string;
};

/** 将缓存帖子列表打平为可轮播的配图序列（与素材区缩略图顺序一致） */
export function buildMaterialGalleryImages(
  notes: MaterialCacheNote[],
  maxPerNote = 18,
): MaterialGalleryImage[] {
  const out: MaterialGalleryImage[] = [];
  for (const n of notes) {
    const imgs = extractMaterialImageUrls(n.image_list);
    imgs.slice(0, maxPerNote).forEach((src, idx) => {
      const displayUrl = resolveMaterialImageDisplayUrl(src);
      if (!displayUrl) return;
      out.push({
        key: materialImageKey(n.note_id, src, idx),
        src,
        displayUrl,
        noteId: n.note_id,
        noteTitle: n.title || "（无标题）",
        noteUrl: n.url,
      });
    });
  }
  return out;
}

function normalizeCacheNote(note: MaterialCacheNote & { image_list?: unknown }): MaterialCacheNote {
  return {
    ...note,
    image_list: extractMaterialImageUrls(note.image_list),
  };
}

export const MATERIAL_CACHE_PAGE_SIZE = 12;

export type MaterialCacheQuery = {
  keyword: string;
  domain?: string;
  cityName?: string;
};

export type MaterialCacheFetchResult = {
  items: MaterialCacheNote[];
  hint: string;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

function buildFetchHint(
  items: MaterialCacheNote[],
  total: number,
  pageOffset: number,
  pageLimit: number,
): string {
  const withImages = items.filter((n) => (n.image_list?.length ?? 0) > 0).length;
  const pageNum = Math.floor(pageOffset / Math.max(pageLimit, 1)) + 1;
  if (items.length > 0) {
    return withImages > 0
      ? `第 ${pageNum} 批：本页 ${items.length} 条帖子（共 ${total} 条），其中 ${withImages} 条含配图。`
      : `第 ${pageNum} 批：本页 ${items.length} 条帖子，但暂无可用配图 URL（可点开标题查看原帖）。`;
  }
  return pageOffset > 0
    ? "没有更多缓存帖子了，可调整检索词或垂类后重新生成。"
    : "缓存中暂无匹配的帖子，可调整检索词或垂类后重新生成。";
}

async function fetchMaterialCachePage(
  query: MaterialCacheQuery,
  offset: number,
  limit: number,
): Promise<MaterialCacheFetchResult> {
  const base = mcpBase();
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("keyword", query.keyword.trim());
  if (query.domain?.trim()) params.append("domain", query.domain.trim());
  if (query.cityName?.trim()) params.set("city_name", query.cityName.trim());
  const empty = (hint: string): MaterialCacheFetchResult => ({
    items: [],
    hint,
    total: 0,
    offset,
    limit,
    hasMore: false,
  });
  try {
    const res = await fetch(`${base}/search/cache/notes?${params.toString()}`);
    if (!res.ok) {
      return empty("缓存列表请求失败，仍可使用上方 MCP 参考链接。");
    }
    const data = (await res.json()) as {
      items?: Array<MaterialCacheNote & { image_list?: unknown }>;
      total?: number;
      offset?: number;
      limit?: number;
    };
    const items = (Array.isArray(data.items) ? data.items : []).map(normalizeCacheNote);
    const total = typeof data.total === "number" ? data.total : items.length;
    const pageOffset = typeof data.offset === "number" ? data.offset : offset;
    const pageLimit = typeof data.limit === "number" ? data.limit : limit;
    const hasMore = pageOffset + items.length < total;
    return {
      items,
      hint: buildFetchHint(items, total, pageOffset, pageLimit),
      total,
      offset: pageOffset,
      limit: pageLimit,
      hasMore,
    };
  } catch {
    return empty("拉取缓存列表异常，仍可使用 MCP 参考链接。");
  }
}

function matchNotesByReferences(
  items: MaterialCacheNote[],
  references: MessageReference[],
): MaterialCacheNote[] {
  const refIds = new Set(references.map((r) => noteIdFromReferenceUrl(r.url)).filter(Boolean));
  if (refIds.size === 0) return [];
  return items.filter((n) => refIds.has(n.note_id));
}

/** 按检索词 / 垂类 / 城市分页拉取缓存帖子，供素材区展示配图 */
export async function fetchMaterialCacheNotes(
  query: MaterialCacheQuery,
  options?: { offset?: number; limit?: number; references?: MessageReference[] },
): Promise<MaterialCacheFetchResult> {
  const limit = options?.limit ?? MATERIAL_CACHE_PAGE_SIZE;
  const offset = options?.offset ?? 0;
  const references = options?.references ?? [];

  const result = await fetchMaterialCachePage(query, offset, limit);

  if (offset > 0 || result.items.length > 0) {
    return result;
  }

  if (query.keyword) {
    const relaxed = await fetchMaterialCachePage(
      { keyword: "", domain: query.domain, cityName: query.cityName },
      0,
      limit,
    );
    if (relaxed.items.length > 0) return relaxed;
  }

  if (references.length > 0) {
    const refIds = new Set(references.map((r) => noteIdFromReferenceUrl(r.url)).filter(Boolean));
    if (refIds.size > 0) {
      const broad = await fetchMaterialCachePage(
        { keyword: "", domain: query.domain, cityName: query.cityName },
        0,
        50,
      );
      let matched = matchNotesByReferences(broad.items, references);
      if (matched.length === 0 && query.domain) {
        const noDomain = await fetchMaterialCachePage({ keyword: "" }, 0, 50);
        matched = matchNotesByReferences(noDomain.items, references);
      }
      if (matched.length > 0) {
        const withImages = matched.filter((n) => (n.image_list?.length ?? 0) > 0).length;
        return {
          items: matched,
          hint:
            withImages > 0
              ? `已从缓存匹配 ${matched.length} 条参考帖子，其中 ${withImages} 条含配图。`
              : `已从缓存匹配 ${matched.length} 条参考帖子，但暂无可用配图 URL（可点开标题查看原帖）。`,
          total: matched.length,
          offset: 0,
          limit,
          hasMore: false,
        };
      }
    }
  }

  return result;
}
