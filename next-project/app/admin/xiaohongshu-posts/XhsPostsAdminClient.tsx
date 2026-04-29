"use client";

import { Pagination, Table } from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TagGroup } from "@heroui/react";
import { adminFormStyles as ui } from "../components/formStyles";

type NoteRow = {
  note_id: string;
  title: string;
  url: string;
  image_list?: string[];
  content_text: string;
  like_count?: number | string;
  collect_count?: number | string;
  comment_count?: number | string;
  updated_at: string;
  used_count: number;
  tags: string[];
  domains?: string[];
  query_terms?: string[];
  last_used_at?: string;
};

const DOMAIN_OPTIONS = ["旅游", "考公", "穿搭", "吃喝", "职场", "健身", "情感"] as const;
const SORT_OPTIONS = [
  { value: "", label: "默认" },
  { value: "like_count", label: "点赞数（高到低）" },
  { value: "collect_count", label: "收藏数（高到低）" },
  { value: "comment_count", label: "评论数（高到低）" },
] as const;

const columns = [
  { id: "image", name: "图片" },
  { id: "title", name: "标题" },
  { id: "content_text", name: "内容" },
  { id: "domains", name: "领域" },
  { id: "origin_metrics", name: "原帖数据" },
  { id: "tags", name: "标签" },
  { id: "used_count", name: "使用次数" },
  { id: "updated_at", name: "更新时间" },
  { id: "actions", name: "操作" },
] as const;

function getMcpBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://127.0.0.1";
}

function formatDateDay(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.slice(0, 10);
}

function toMetricNumber(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "0";
  return String(Math.trunc(num));
}

function domainTagClass(domain: string): string {
  const colorMap: Record<string, string> = {
    旅游: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
    考公: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    穿搭: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
    吃喝: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
    职场: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
    健身: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
    情感: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  };
  return (
    colorMap[domain] ||
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
  );
}

export default function XhsPostsAdminClient() {
  const [formValues, setFormValues] = useState<{ keyword: string; tag: string; domains: string[]; sortBy: string }>({
    keyword: "",
    tag: "",
    domains: [],
    sortBy: "",
  });
  const [filters, setFilters] = useState<{ keyword: string; tag: string; domains: string[]; sortBy: string }>({
    keyword: "",
    tag: "",
    domains: [],
    sortBy: "",
  });
  const [offset, setOffset] = useState(0);
  const [limit] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"view" | "edit">("view");
  const [activeNote, setActiveNote] = useState<NoteRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editDomains, setEditDomains] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [domainFilterOpen, setDomainFilterOpen] = useState(false);
  const [sortFilterOpen, setSortFilterOpen] = useState(false);
  const domainFilterRef = useRef<HTMLDivElement | null>(null);
  const sortFilterRef = useRef<HTMLDivElement | null>(null);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      params.set("keyword", filters.keyword.trim());
      params.set("tag", filters.tag.trim());
      params.set("sort_by", filters.sortBy.trim());
      filters.domains.forEach((domain) => params.append("domain", domain));
      const res = await fetch(`${getMcpBaseUrl()}/search/cache/notes?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { items?: NoteRow[]; total?: number };
      setNotes(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters.domains, filters.keyword, filters.sortBy, filters.tag, limit, offset]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (domainFilterRef.current && target && !domainFilterRef.current.contains(target)) {
        setDomainFilterOpen(false);
      }
      if (sortFilterRef.current && target && !sortFilterRef.current.contains(target)) {
        setSortFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

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

  function openNoteDialog(note: NoteRow, mode: "view" | "edit") {
    setDialogMode(mode);
    setActiveNote(note);
    setEditTitle(note.title || "");
    setEditContent(note.content_text || "");
    setEditTags(Array.isArray(note.tags) ? note.tags : []);
    setEditDomains(Array.isArray(note.domains) ? note.domains : []);
    setNewTag("");
    setDialogOpen(true);
  }

  function removeTag(index: number) {
    setEditTags((prev) => prev.filter((_, i) => i !== index));
  }

  function addTag() {
    const value = newTag.trim();
    if (!value) return;
    setEditTags((prev) => [...prev, value]);
    setNewTag("");
  }

  async function saveNote() {
    if (!activeNote || dialogMode !== "edit") return;
    setSaving(true);
    setError("");
    try {
      const cleanedTags = editTags.map((item) => item.trim()).filter(Boolean);
      const cleanedDomains = editDomains.map((item) => item.trim()).filter(Boolean);
      const res = await fetch(`${getMcpBaseUrl()}/search/cache/notes/${encodeURIComponent(activeNote.note_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          content_text: editContent.trim(),
          tags: cleanedTags,
          domains: cleanedDomains,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadNotes();
      setDialogOpen(false);
      setActiveNote(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={ui.page}>
      <form
        className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-950/30"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setFilters({
            keyword: formValues.keyword,
            tag: formValues.tag,
            domains: [...formValues.domains],
            sortBy: formValues.sortBy,
          });
        }}
        onReset={() => {
          const empty = { keyword: "", tag: "", domains: [] as string[], sortBy: "" };
          setFormValues(empty);
          setOffset(0);
          setFilters(empty);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">领域</span>
            <div className="relative" ref={domainFilterRef}>
              <button
                type="button"
                className={`${ui.input} inline-flex w-[260px] items-center justify-between`}
                onClick={() => setDomainFilterOpen((v) => !v)}
              >
                <span className="truncate">
                  {formValues.domains.length ? formValues.domains.join(" / ") : "全部领域"}
                </span>
                <span className="text-[10px] text-slate-400">▼</span>
              </button>
              {domainFilterOpen ? (
                <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-[260px] rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>可多选</span>
                    <button
                      type="button"
                      className="text-sky-600 hover:underline dark:text-sky-300"
                      onClick={() => setFormValues((prev) => ({ ...prev, domains: [] }))}
                    >
                      清空
                    </button>
                  </div>
                  <div className="grid gap-1">
                    {DOMAIN_OPTIONS.map((item) => {
                      const checked = formValues.domains.includes(item);
                      return (
                        <label
                          key={item}
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs ${
                            checked
                              ? domainTagClass(item)
                              : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={checked}
                            onChange={(e) =>
                              setFormValues((prev) => ({
                                ...prev,
                                domains: e.target.checked
                                  ? [...prev.domains, item]
                                  : prev.domains.filter((d) => d !== item),
                              }))
                            }
                          />
                          <span>{item}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </label>
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
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">原帖数据排序</span>
            <div className="relative" ref={sortFilterRef}>
              <button
                type="button"
                className={`${ui.input} inline-flex w-[180px] items-center justify-between`}
                onClick={() => setSortFilterOpen((v) => !v)}
              >
                <span className="truncate">
                  {SORT_OPTIONS.find((item) => item.value === formValues.sortBy)?.label || "默认"}
                </span>
                <span className="text-[10px] text-slate-400">▼</span>
              </button>
              {sortFilterOpen ? (
                <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-[190px] rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="grid gap-1">
                    {SORT_OPTIONS.map((item) => {
                      const active = formValues.sortBy === item.value;
                      return (
                        <button
                          key={item.value || "default"}
                          type="button"
                          className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${
                            active
                              ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                              : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800"
                          }`}
                          onClick={() => {
                            setFormValues((prev) => ({ ...prev, sortBy: item.value }));
                            setSortFilterOpen(false);
                          }}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
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
            <Table.Content aria-label="小红书帖子表格" className="min-w-[1420px]">
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
                      {Array.isArray(n.image_list) && n.image_list[0] ? (
                        <img
                          src={n.image_list[0]}
                          alt={n.title || n.note_id}
                          className="h-14 w-14 rounded-md border border-slate-200 object-cover dark:border-slate-700"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 text-[10px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
                          无图
                        </div>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <a
                        className="max-w-[220px] overflow-hidden font-medium text-sky-600 hover:underline [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {n.title || n.note_id}
                      </a>
                    </Table.Cell>
                    <Table.Cell>
                      <p className="max-w-[300px] overflow-hidden text-xs text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                        {n.content_text || "-"}
                      </p>
                    </Table.Cell>
                    <Table.Cell>
                      <TagGroup aria-label="领域" className="inline-flex w-fit flex-wrap gap-1">
                        {(n.domains ?? []).length ? (
                          (n.domains ?? []).map((item) => (
                            <span
                              key={item}
                              className={`inline-flex w-fit whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] ${domainTagClass(item)}`}
                            >
                              {item}
                            </span>
                          ))
                        ) : (
                          <span className="inline-flex w-fit whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                            未设置
                          </span>
                        )}
                      </TagGroup>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="min-w-[110px] grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                        <p className="flex items-center gap-1">
                          <span aria-hidden>👍</span>
                          <span>{toMetricNumber(n.like_count)}</span>
                        </p>
                        <p className="flex items-center gap-1">
                          <span aria-hidden>⭐</span>
                          <span>{toMetricNumber(n.collect_count)}</span>
                        </p>
                        <p className="flex items-center gap-1">
                          <span aria-hidden>💬</span>
                          <span>{toMetricNumber(n.comment_count)}</span>
                        </p>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <TagGroup aria-label="标签" className="inline-flex w-fit flex-wrap gap-1">
                        {(n.tags ?? []).slice(0, 3).map((item) => (
                          <span
                            key={item}
                            className="inline-flex w-fit whitespace-nowrap rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
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
                          onClick={() => openNoteDialog(n, "edit")}
                        >
                          修改
                        </button>
                        <button className={ui.buttonDanger} onClick={() => void deleteNote(n.note_id)}>
                          删除
                        </button>
                        <button
                          className={ui.buttonSecondary}
                          onClick={() => openNoteDialog(n, "view")}
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
      {dialogOpen && activeNote ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <p className={ui.sectionTitle}>{dialogMode === "edit" ? "编辑帖子" : "帖子详情"}</p>
              <button
                className={ui.buttonSecondary}
                type="button"
                onClick={() => {
                  setDialogOpen(false);
                  setActiveNote(null);
                }}
              >
                关闭
              </button>
            </div>
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">标题</span>
                <input
                  className={ui.input}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  disabled={dialogMode === "view"}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">ID（只读）</span>
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {activeNote.note_id}
                </p>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">链接（只读）</span>
                <a
                  href={activeNote.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-sky-700 underline-offset-2 hover:underline dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300"
                  title={activeNote.url}
                >
                  {activeNote.url}
                </a>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">正文</span>
                <textarea
                  className={`min-h-[560px] ${ui.textarea}`}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  disabled={dialogMode === "view"}
                />
              </label>
              <div>
                <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">领域（可多选）</p>
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                  <div className="flex flex-wrap gap-2">
                    {DOMAIN_OPTIONS.map((domain) => {
                      const checked = editDomains.includes(domain);
                      return (
                        <label
                          key={domain}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                            checked
                              ? domainTagClass(domain)
                              : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={checked}
                            disabled={dialogMode === "view"}
                            onChange={(e) => {
                              if (dialogMode === "view") return;
                              setEditDomains((prev) =>
                                e.target.checked ? [...prev, domain] : prev.filter((item) => item !== domain)
                              );
                            }}
                          />
                          <span>{domain}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">标签</p>
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                  {editTags.length ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {editTags.map((item, index) => (
                        <span
                          key={`${index}-${item}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                        >
                          {item}
                          {dialogMode === "edit" ? (
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
                  {dialogMode === "edit" ? (
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
              {dialogMode === "edit" ? (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    className={ui.buttonSecondary}
                    type="button"
                    onClick={() => {
                      setDialogOpen(false);
                      setActiveNote(null);
                    }}
                  >
                    取消
                  </button>
                  <button className={ui.buttonPrimary} type="button" onClick={() => void saveNote()} disabled={saving}>
                    {saving ? "保存中..." : "保存修改"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {loading ? <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">加载中...</p> : null}
      {error ? <p className={ui.error}>{error}</p> : null}
    </section>
  );
}
