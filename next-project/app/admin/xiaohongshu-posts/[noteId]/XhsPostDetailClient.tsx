"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminFormStyles as ui } from "../../components/formStyles";

type NoteDetail = {
  note_id: string;
  title: string;
  url: string;
  content_text: string;
  used_count: number;
  updated_at: string;
  tags: string[];
};

function getMcpBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://127.0.0.1";
}

export default function XhsPostDetailClient({ noteId }: { noteId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "view" ? "view" : "edit";
  const readonly = mode === "view";
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  const normalizedTags = useMemo(
    () =>
      tags
        .map((item) => item.trim())
        .filter(Boolean),
    [tags]
  );

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${getMcpBaseUrl()}/search/cache/notes/${encodeURIComponent(noteId)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { item?: NoteDetail };
      if (!data.item) throw new Error("帖子不存在");
      setNote(data.item);
      setTitle(data.item.title || "");
      setContent(data.item.content_text || "");
      setTags(data.item.tags ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function saveNote() {
    if (readonly) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${getMcpBaseUrl()}/search/cache/notes/${encodeURIComponent(noteId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content_text: content.trim(), tags: normalizedTags }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function removeTag(index: number) {
    setTags((prev) => prev.filter((_, i) => i !== index));
  }

  function addTag() {
    const value = newTag.trim();
    if (!value) return;
    setTags((prev) => [...prev, value]);
    setNewTag("");
  }

  return (
    <section className={ui.page}>
      <div className="mb-4">
        <button className={ui.buttonSecondary} type="button" onClick={() => router.push("/admin/xiaohongshu-posts")}>
          返回列表
        </button>
      </div>

      {loading ? <p className={ui.hint}>加载中...</p> : null}
      {error ? <p className={ui.error}>{error}</p> : null}

      {note ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNote();
          }}
        >
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{readonly ? "帖子详情" : "编辑帖子"}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">仅标题、正文、标签可编辑</p>
              </div>
              <div className="flex gap-2" aria-label="统计信息">
                <span className="inline-flex whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  使用 {note.used_count}
                </span>
                <span className="inline-flex whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  更新 {note.updated_at || "-"}
                </span>
              </div>
            </div>
            <div className="grid gap-5 p-5">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">帖子 ID（只读）</span>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {note.note_id}
                  </p>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">链接（只读）</span>
                  <a
                    href={note.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-sky-700 underline-offset-2 hover:underline dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300"
                    title={note.url}
                  >
                    {note.url}
                  </a>
                </label>
              </div>

              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">标题</span>
                <input
                  className={ui.input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="标题"
                  disabled={readonly}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">正文</span>
                <textarea
                  rows={22}
                  className={`min-h-[560px] ${ui.textarea}`}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="内容"
                  disabled={readonly}
                />
              </label>
              <div>
                <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">标签</p>
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                  {tags.length ? (
                    <div aria-label="可编辑标签列表" className="mb-3 flex flex-wrap gap-2">
                      {tags.map((item, index) => (
                        <span
                          key={`${index}-${item}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                        >
                          {item}
                          {!readonly ? (
                            <button
                              type="button"
                              onClick={() => removeTag(index)}
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-400 p-0 text-[10px] leading-none text-white transition hover:bg-rose-500"
                            >
                              ×
                            </button>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className={`${ui.hint} mb-3`}>暂无标签</p>
                  )}

                  {!readonly ? (
                    <div className="flex items-center gap-2">
                      <input
                        className={ui.input}
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        placeholder="输入新标签"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addTag();
                          }
                        }}
                      />
                      <button className={ui.buttonSecondary} type="button" onClick={addTag}>
                        新增标签
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {!readonly ? (
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <button className={ui.buttonSecondary} type="button" onClick={() => router.push("/admin/xiaohongshu-posts")}>
                取消
              </button>
              <button className={ui.buttonPrimary} type="submit" disabled={saving}>
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
