"use client";

import { Pagination, Table } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TagGroup } from "@heroui/react";
import { adminFormStyles as ui } from "../components/formStyles";

type NoteRow = {
  note_id: string;
  title: string;
  url: string;
  content_text: string;
  like_count?: number | string;
  collect_count?: number | string;
  comment_count?: number | string;
  updated_at: string;
  used_count: number;
  tags: string[];
  query_terms?: string[];
  last_used_at?: string;
};

const columns = [
  { id: "title", name: "标题" },
  { id: "content_text", name: "内容" },
  { id: "tags", name: "标签" },
  { id: "used_count", name: "使用次数" },
  { id: "updated_at", name: "更新时间" },
  { id: "actions", name: "操作" },
] as const;

function getMcpBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
}

function formatDateDay(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.slice(0, 10);
}

export default function XhsPostsAdminClient() {
  const router = useRouter();
  const [formValues, setFormValues] = useState({ keyword: "", tag: "" });
  const [filters, setFilters] = useState({ keyword: "", tag: "" });
  const [offset, setOffset] = useState(0);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<NoteRow[]>([]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${getMcpBaseUrl()}/search/cache/notes?limit=${limit}&offset=${offset}&keyword=${encodeURIComponent(
          filters.keyword.trim()
        )}&tag=${encodeURIComponent(filters.tag.trim())}`
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { items?: NoteRow[]; total?: number };
      setNotes(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters.keyword, filters.tag, limit, offset]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  const pages = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  async function deleteNote(noteId: string) {
    if (!window.confirm("确定删除该帖子吗？")) return;
    const res = await fetch(`${getMcpBaseUrl()}/search/cache/notes/${encodeURIComponent(noteId)}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    await loadNotes();
  }

  return (
    <section className={ui.page}>
      <h1 className={ui.title}>小红书帖子</h1>
      <form
        className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-950/30"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setFilters({ keyword: formValues.keyword, tag: formValues.tag });
        }}
        onReset={() => {
          const empty = { keyword: "", tag: "" };
          setFormValues(empty);
          setOffset(0);
          setFilters(empty);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">内容或标题</span>
            <input
              className={`${ui.input} w-[260px]`}
              placeholder="输入关键词"
              value={formValues.keyword}
              onChange={(e) => setFormValues((prev) => ({ ...prev, keyword: e.target.value }))}
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">标签</span>
            <input
              className={`${ui.input} w-[260px]`}
              placeholder="广州旅游"
              value={formValues.tag}
              onChange={(e) => setFormValues((prev) => ({ ...prev, tag: e.target.value }))}
            />
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button type="submit" className={ui.buttonPrimary}>
              查询
            </button>
            <button type="reset" className={ui.buttonSecondary}>
              重置
            </button>
          </div>
        </div>
      </form>

      <div className="mt-4">
        <Table className={ui.tableWrap}>
          <Table.ScrollContainer>
            <Table.Content aria-label="小红书帖子表格" className="min-w-[980px]">
              <Table.Header columns={columns}>
                {(column) => (
                  <Table.Column isRowHeader={column.id === "title"} className="whitespace-nowrap">
                    {column.name}
                  </Table.Column>
                )}
              </Table.Header>
              <Table.Body>
                {notes.map((n) => (
                  <Table.Row key={n.note_id}>
                    <Table.Cell>
                      <a className="font-medium text-sky-600 hover:underline" href={n.url} target="_blank" rel="noreferrer">
                        {n.title || n.note_id}
                      </a>
                    </Table.Cell>
                    <Table.Cell>
                      <p className="max-w-[420px] overflow-hidden text-xs text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                        {n.content_text || "-"}
                      </p>
                    </Table.Cell>
                    <Table.Cell>
                      <TagGroup aria-label="标签" className="flex flex-wrap gap-1">
                        {(n.tags ?? []).slice(0, 3).map((item) => (
                          <span
                            key={item}
                            className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {item}
                          </span>
                        ))}
                      </TagGroup>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-xs text-slate-600">{n.used_count}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="whitespace-nowrap text-xs text-slate-600">{formatDateDay(n.updated_at)}</span>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          className={ui.buttonPrimary}
                          onClick={() => router.push(`/admin/xiaohongshu-posts/${encodeURIComponent(n.note_id)}?mode=edit`)}
                        >
                          修改
                        </button>
                        <button className={ui.buttonDanger} onClick={() => void deleteNote(n.note_id)}>
                          删除
                        </button>
                        <button
                          className={ui.buttonSecondary}
                          onClick={() => router.push(`/admin/xiaohongshu-posts/${encodeURIComponent(n.note_id)}?mode=view`)}
                        >
                          详情
                        </button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer>
            <Pagination size="sm">
              <Pagination.Summary>
                第 {page}/{totalPages} 页，共 {total} 条
              </Pagination.Summary>
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={page === 1}
                    onPress={() => setOffset((v) => Math.max(0, v - limit))}
                  >
                    <Pagination.PreviousIcon />
                    上一页
                  </Pagination.Previous>
                </Pagination.Item>
                {pages.map((p) => (
                  <Pagination.Item key={p}>
                    <Pagination.Link isActive={p === page} onPress={() => setOffset((p - 1) * limit)}>
                      {p}
                    </Pagination.Link>
                  </Pagination.Item>
                ))}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={page === totalPages}
                    onPress={() => setOffset((v) => Math.min((totalPages - 1) * limit, v + limit))}
                  >
                    下一页
                    <Pagination.NextIcon />
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
            </Pagination>
          </Table.Footer>
        </Table>
      </div>
      {loading ? <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">加载中...</p> : null}
      {error ? <p className={ui.error}>{error}</p> : null}
    </section>
  );
}
