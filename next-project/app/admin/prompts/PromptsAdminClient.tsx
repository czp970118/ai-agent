"use client";

import { Pagination, Table, TagGroup } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";

type StyleRow = {
  id: string;
  name: string;
  body?: string;
  body_preview?: string;
};

type CategoryRow = {
  id: string;
  name: string;
  styles: StyleRow[];
};

type AgentOption = "xiaohongshu" | "cases";
const ALL_AGENTS: AgentOption[] = ["xiaohongshu", "cases"];
const ROWS_PER_PAGE = 10;
const columns = [
  { id: "name", name: "名称" },
  { id: "content", name: "内容" },
  { id: "agent", name: "Agent" },
  { id: "type", name: "类型" },
  { id: "style", name: "风格" },
  { id: "actions", name: "操作" },
] as const;

type PromptRow = {
  rowId: string;
  styleId: string;
  categoryId: string;
  name: string;
  content: string;
  agent: AgentOption;
  type: string;
  style: string;
};

function getMcpBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
}

export default function PromptsAdminClient() {
  const [userId, setUserId] = useState("admin");
  const [categoriesByAgent, setCategoriesByAgent] = useState<Record<AgentOption, CategoryRow[]>>({
    xiaohongshu: [],
    cases: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ name: "", type: "", style: "", agent: "" });
  const [page, setPage] = useState(1);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [selectedRow, setSelectedRow] = useState<PromptRow | null>(null);
  const [editStyleName, setEditStyleName] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId.trim()) return;
    setLoading(true);
    setError("");
    try {
      const responses = await Promise.all(
        ALL_AGENTS.map((agentName) =>
          fetch(
            `${getMcpBaseUrl()}/chat/prompt-library?user_id=${encodeURIComponent(userId.trim())}&agent=${encodeURIComponent(
              agentName
            )}&include_body=true`
          ).then(async (res) => {
            if (!res.ok) throw new Error(await res.text());
            const data = (await res.json()) as { categories?: CategoryRow[] };
            return [agentName, Array.isArray(data.categories) ? data.categories : []] as const;
          })
        )
      );
      setCategoriesByAgent({
        xiaohongshu: responses.find((item) => item[0] === "xiaohongshu")?.[1] ?? [],
        cases: responses.find((item) => item[0] === "cases")?.[1] ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const promptRows = useMemo<PromptRow[]>(() => {
    const rows: PromptRow[] = [];
    for (const agentName of ALL_AGENTS) {
      for (const category of categoriesByAgent[agentName]) {
        for (const style of category.styles) {
          rows.push({
            rowId: `${agentName}:${style.id}`,
            styleId: style.id,
            categoryId: category.id,
            name: style.name,
            content: style.body ?? style.body_preview ?? "",
            agent: agentName,
            type: category.name,
            style: style.name,
          });
        }
      }
    }
    return rows;
  }, [categoriesByAgent]);

  const filteredRows = useMemo(() => {
    const nameTerm = filters.name.trim().toLowerCase();
    const typeTerm = filters.type.trim().toLowerCase();
    const styleTerm = filters.style.trim().toLowerCase();
    const agentTerm = filters.agent.trim().toLowerCase();
    return promptRows.filter((row) => {
      if (nameTerm && !row.name.toLowerCase().includes(nameTerm) && !row.content.toLowerCase().includes(nameTerm)) return false;
      if (typeTerm && !row.type.toLowerCase().includes(typeTerm)) return false;
      if (styleTerm && !row.style.toLowerCase().includes(styleTerm)) return false;
      if (agentTerm && !row.agent.toLowerCase().includes(agentTerm)) return false;
      return true;
    });
  }, [filters, promptRows]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * ROWS_PER_PAGE;
    return filteredRows.slice(start, start + ROWS_PER_PAGE);
  }, [filteredRows, page]);
  const pages = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  async function deleteStyle(row: PromptRow) {
    if (!userId.trim()) return;
    if (!window.confirm("确定删除该风格吗？")) return;
    const res = await fetch(
      `${getMcpBaseUrl()}/chat/prompt-library/styles/${encodeURIComponent(row.styleId)}?user_id=${encodeURIComponent(
        userId.trim()
      )}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    if (selectedRow?.styleId === row.styleId) setSelectedRow(null);
    await loadData();
  }

  async function saveStyleEdit() {
    if (!selectedRow || !userId.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/styles/${encodeURIComponent(selectedRow.styleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId.trim(),
          name: editStyleName.trim(),
          body: editBody,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={ui.page}>
      <h1 className={ui.title}>提示词管理</h1>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-950/30">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">用户ID</span>
            <input
              className={`${ui.input} w-[260px]`}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="user_id"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">名称检索</span>
            <input
              className={`${ui.input} w-[260px]`}
              value={filters.name}
              onChange={(e) => setFilters((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="名称或内容关键字"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">类型检索</span>
            <input
              className={`${ui.input} w-[220px]`}
              value={filters.type}
              onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
              placeholder="分类名称"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">风格检索</span>
            <input
              className={`${ui.input} w-[220px]`}
              value={filters.style}
              onChange={(e) => setFilters((prev) => ({ ...prev, style: e.target.value }))}
              placeholder="风格名称"
            />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">Agent检索</span>
            <input
              className={`${ui.input} w-[180px]`}
              value={filters.agent}
              onChange={(e) => setFilters((prev) => ({ ...prev, agent: e.target.value }))}
              placeholder="xiaohongshu / cases"
            />
          </label>
          <div className="ml-auto">
            <div className="flex items-center gap-2">
              <button className={ui.buttonPrimary} onClick={() => void loadData()}>
                搜索
              </button>
              <button className={ui.buttonSecondary} onClick={() => setError("创建功能待接入具体分类/风格创建流程")}>
                创建
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <Table className={ui.tableWrap}>
          <Table.ScrollContainer>
            <Table.Content aria-label="提示词表格" className="min-w-[1080px]">
              <Table.Header columns={columns}>
                {(column) => (
                  <Table.Column isRowHeader={column.id === "name"} className="whitespace-nowrap">
                    {column.name}
                  </Table.Column>
                )}
              </Table.Header>
              <Table.Body>
                {pagedRows.map((row) => (
                  <Table.Row key={row.rowId}>
                    <Table.Cell className="whitespace-nowrap">{row.name}</Table.Cell>
                    <Table.Cell>
                      <p className="max-w-[460px] overflow-hidden text-xs text-slate-600 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                        {row.content || "-"}
                      </p>
                    </Table.Cell>
                    <Table.Cell>
                      <TagGroup className="flex gap-1">
                        <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {row.agent}
                        </span>
                      </TagGroup>
                    </Table.Cell>
                    <Table.Cell>
                      <TagGroup className="flex gap-1">
                        <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {row.type}
                        </span>
                      </TagGroup>
                    </Table.Cell>
                    <Table.Cell>
                      <TagGroup className="flex gap-1">
                        <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {row.style}
                        </span>
                      </TagGroup>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          className={ui.buttonSecondary}
                          onClick={() => {
                            setDetailMode("view");
                            setSelectedRow(row);
                            setEditStyleName(row.style);
                            setEditBody(row.content);
                          }}
                        >
                          详情
                        </button>
                        <button
                          className={ui.buttonPrimary}
                          onClick={() => {
                            setDetailMode("edit");
                            setSelectedRow(row);
                            setEditStyleName(row.style);
                            setEditBody(row.content);
                          }}
                        >
                          编辑
                        </button>
                        <button
                          className={ui.buttonDanger}
                          onClick={() => {
                            setSelectedRow(row);
                            void deleteStyle(row);
                          }}
                        >
                          删除
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
                第 {page}/{totalPages} 页，共 {filteredRows.length} 条
              </Pagination.Summary>
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous isDisabled={page === 1} onPress={() => setPage((prev) => Math.max(1, prev - 1))}>
                    <Pagination.PreviousIcon />
                    上一页
                  </Pagination.Previous>
                </Pagination.Item>
                {pages.map((item) => (
                  <Pagination.Item key={item}>
                    <Pagination.Link isActive={item === page} onPress={() => setPage(item)}>
                      {item}
                    </Pagination.Link>
                  </Pagination.Item>
                ))}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={page === totalPages}
                    onPress={() => setPage((prev) => Math.min(totalPages, prev + 1))}
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
      {selectedRow ? (
        <div className={`mt-4 ${ui.panel}`}>
          <div className="mb-3 flex items-center justify-between">
            <p className={ui.sectionTitle}>{detailMode === "view" ? "提示词详情" : "编辑提示词"}</p>
            <button className={ui.buttonSecondary} onClick={() => setSelectedRow(null)}>
              关闭
            </button>
          </div>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">风格名称</span>
              <input
                className={ui.input}
                value={editStyleName}
                onChange={(e) => setEditStyleName(e.target.value)}
                disabled={detailMode === "view"}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">正文</span>
              <textarea
                className={`min-h-[220px] ${ui.textarea}`}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                disabled={detailMode === "view"}
              />
            </label>
            <div className="flex gap-2">
              <TagGroup>
                <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {selectedRow.agent}
                </span>
              </TagGroup>
              <TagGroup>
                <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {selectedRow.type}
                </span>
              </TagGroup>
              <TagGroup>
                <span className="inline-flex whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {selectedRow.style}
                </span>
              </TagGroup>
            </div>
            {detailMode === "edit" ? (
              <div className="ml-auto">
                <button className={ui.buttonPrimary} onClick={() => void saveStyleEdit()} disabled={saving}>
                  {saving ? "保存中..." : "保存修改"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {loading ? <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">加载中...</p> : null}
      {error ? <p className={ui.error}>{error}</p> : null}
    </section>
  );
}
