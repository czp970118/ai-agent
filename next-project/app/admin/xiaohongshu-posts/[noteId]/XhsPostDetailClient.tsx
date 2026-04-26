"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TagGroup } from "@heroui/react";
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
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
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
  const [tagsText, setTagsText] = useState("");

  const parsedTags = useMemo(
    () =>
      tagsText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [tagsText]
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
      setTagsText((data.item.tags ?? []).join(", "));
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
        body: JSON.stringify({ title: title.trim(), content_text: content.trim(), tags: parsedTags }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={ui.page}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className={ui.title}>{readonly ? "帖子详情" : "编辑帖子"}</h1>
        <button className={ui.buttonSecondary} onClick={() => router.push("/admin/xiaohongshu-posts")}>
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
          <div className={ui.panel}>
            <p className={ui.sectionTitle}>基础信息</p>
            <div className="grid gap-2">
              <input className={ui.input} value={note.note_id} disabled />
              <input className={ui.input} value={note.url} disabled />
              <input
                className={ui.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="标题"
                disabled={readonly}
              />
              <textarea
                className={`min-h-40 ${ui.textarea}`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="内容"
                disabled={readonly}
              />
              <input
                className={ui.input}
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="标签，使用英文逗号分隔"
                disabled={readonly}
              />
              <TagGroup aria-label="标签预览" className="flex flex-wrap gap-1">
                {parsedTags.map((item) => (
                  <span
                    key={item}
                    className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {item}
                  </span>
                ))}
              </TagGroup>
              <p className={ui.hint}>
                使用次数：{note.used_count} | 更新时间：{note.updated_at || "-"}
              </p>
            </div>
          </div>

          {!readonly ? (
            <div className="flex justify-end">
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
