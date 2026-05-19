import { getMcpBaseUrl } from "@/app/assistant/utils/mcpBaseUrl";

function worksUrl(path: string): string {
  const root = `${getMcpBaseUrl().replace(/\/+$/, "")}/chat/creative-works`;
  const p = path.trim();
  if (!p) return root;
  return `${root}${p.startsWith("/") ? p : `/${p}`}`;
}

export async function ccFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(worksUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
