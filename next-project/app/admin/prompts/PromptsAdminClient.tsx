"use client";

import { ListBox, ListBoxItem, Pagination, Select, Table, TagGroup } from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";

type StyleRow = {
  id: string;
  name: string;
  body?: string;
  body_preview?: string;
  is_default?: boolean;
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
  { id: "is_default", name: "默认" },
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
  isDefault: boolean;
};

const tagColorClasses = [
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
] as const;

function colorByText(text: string): string {
  const raw = String(text || "");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return tagColorClasses[hash % tagColorClasses.length]!;
}

function agentTagColor(agent: AgentOption): string {
  if (agent === "xiaohongshu") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
  }
  return "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300";
}

function getMcpBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://127.0.0.1";
}

export default function PromptsAdminClient() {
  const domainOptions = ["旅游", "考公", "穿搭", "吃喝", "职场", "健身", "情感", "自定义"];
  const [categoriesByAgent, setCategoriesByAgent] = useState<Record<AgentOption, CategoryRow[]>>({
    xiaohongshu: [],
    cases: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ name: "", type: "", agent: "" });
  const [page, setPage] = useState(1);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [selectedRow, setSelectedRow] = useState<PromptRow | null>(null);
  const [editAgent, setEditAgent] = useState<AgentOption>("xiaohongshu");
  const [editType, setEditType] = useState("");
  const [editStyleName, setEditStyleName] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editIsDefault, setEditIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createAgent, setCreateAgent] = useState<AgentOption>("xiaohongshu");
  const [createDomain, setCreateDomain] = useState("旅游");
  const [createCustomDomain, setCreateCustomDomain] = useState("");
  const [createStyle, setCreateStyle] = useState("");
  const [createBody, setCreateBody] = useState("");
  const [createIsDefault, setCreateIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const responses = await Promise.all(
        ALL_AGENTS.map((agentName) =>
          fetch(
            `${getMcpBaseUrl()}/chat/prompt-library?agent=${encodeURIComponent(agentName)}&include_body=true`
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
  }, []);

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
            isDefault: !!style.is_default,
          });
        }
      }
    }
    return rows;
  }, [categoriesByAgent]);

  const filteredRows = useMemo(() => {
    const nameTerm = filters.name.trim().toLowerCase();
    const typeTerm = filters.type.trim().toLowerCase();
    const agentTerm = filters.agent.trim().toLowerCase();
    return promptRows.filter((row) => {
      if (nameTerm && !row.name.toLowerCase().includes(nameTerm) && !row.content.toLowerCase().includes(nameTerm)) return false;
      if (typeTerm && !row.type.toLowerCase().includes(typeTerm)) return false;
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
    if (!window.confirm("确定删除该提示词吗？")) return;
    const res = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/styles/${encodeURIComponent(row.styleId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    if (selectedRow?.styleId === row.styleId) setSelectedRow(null);
    await loadData();
  }

  async function saveStyleEdit() {
    if (!selectedRow) return;
    setSaving(true);
    setError("");
    try {
      const targetAgent = editAgent;
      const targetType = editType.trim();
      const targetStyle = editStyleName.trim();
      if (!targetType) throw new Error("领域不能为空");
      if (!targetStyle) throw new Error("名称不能为空");

      const moved = targetAgent !== selectedRow.agent || targetType !== selectedRow.type;
      if (!moved) {
        const res = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/styles/${encodeURIComponent(selectedRow.styleId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: targetStyle,
            body: editBody,
            is_default: editIsDefault,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        let targetCategoryId = categoriesByAgent[targetAgent].find((item) => item.name.trim() === targetType)?.id ?? "";
        if (!targetCategoryId) {
          const categoryRes = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/categories`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agent: targetAgent,
              name: targetType,
            }),
          });
          if (!categoryRes.ok) throw new Error(await categoryRes.text());
          const categoryData = (await categoryRes.json()) as { id?: string };
          targetCategoryId = String(categoryData.id || "");
          if (!targetCategoryId) throw new Error("创建目标领域失败");
        }

        const createRes = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/styles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_id: targetCategoryId,
            name: targetStyle,
            body: editBody,
            is_default: editIsDefault,
          }),
        });
        if (!createRes.ok) throw new Error(await createRes.text());

        const deleteRes = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/styles/${encodeURIComponent(selectedRow.styleId)}`, {
          method: "DELETE",
        });
        if (!deleteRes.ok) throw new Error(await deleteRes.text());
      }
      await loadData();
      setSelectedRow(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function openCreateDialog() {
    setCreateAgent("xiaohongshu");
    setCreateDomain("旅游");
    setCreateCustomDomain("");
    setCreateStyle("");
    setCreateBody("");
    setCreateIsDefault(false);
    setCreateOpen(true);
  }

  async function submitCreatePrompt() {
    const domain = (createDomain === "自定义" ? createCustomDomain : createDomain).trim();
    if (!domain) {
      setError("请选择领域");
      return;
    }
    if (!createStyle.trim()) {
      setError("请输入名称");
      return;
    }
    if (!createBody.trim()) {
      setError("请输入提示词内容");
      return;
    }

    setCreating(true);
    setError("");
    try {
      let categoryId = categoriesByAgent[createAgent].find((item) => item.name.trim() === domain)?.id ?? "";
      if (!categoryId) {
        const categoryRes = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent: createAgent,
            name: domain,
          }),
        });
        if (!categoryRes.ok) throw new Error(await categoryRes.text());
        const categoryData = (await categoryRes.json()) as { id?: string };
        categoryId = String(categoryData.id || "");
        if (!categoryId) throw new Error("创建领域失败");
      }

      const styleRes = await fetch(`${getMcpBaseUrl()}/chat/prompt-library/styles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: categoryId,
          name: createStyle.trim(),
          body: createBody,
          is_default: createIsDefault,
        }),
      });
      if (!styleRes.ok) throw new Error(await styleRes.text());
      await loadData();
      setCreateOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={ui.page}>
      <h1 className={ui.title}>提示词管理</h1>
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-950/30">
        <div className="flex flex-wrap items-center gap-3">
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
              <button className={ui.buttonSecondary} onClick={openCreateDialog}>
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
                      <TagGroup className="inline-flex w-fit gap-1">
                        <span
                          className={`inline-flex w-fit whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] ${agentTagColor(
                            row.agent
                          )}`}
                        >
                          {row.agent}
                        </span>
                      </TagGroup>
                    </Table.Cell>
                    <Table.Cell>
                      <TagGroup className="inline-flex w-fit gap-1">
                        <span
                          className={`inline-flex w-fit whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] ${colorByText(
                            row.type
                          )}`}
                        >
                          {row.type}
                        </span>
                      </TagGroup>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center">
                        {row.isDefault ? (
                          <span className="inline-flex whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                            默认
                          </span>
                        ) : (
                          <span className="inline-flex whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                            否
                          </span>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          className={ui.buttonSecondary}
                          onClick={() => {
                            setDetailMode("view");
                            setSelectedRow(row);
                            setEditAgent(row.agent);
                            setEditType(row.type);
                            setEditStyleName(row.style);
                            setEditBody(row.content);
                            setEditIsDefault(row.isDefault);
                          }}
                        >
                          详情
                        </button>
                        <button
                          className={ui.buttonPrimary}
                          onClick={() => {
                            setDetailMode("edit");
                            setSelectedRow(row);
                            setEditAgent(row.agent);
                            setEditType(row.type);
                            setEditStyleName(row.style);
                            setEditBody(row.content);
                            setEditIsDefault(row.isDefault);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <p className={ui.sectionTitle}>{detailMode === "view" ? "提示词详情" : "编辑提示词"}</p>
              <button className={ui.buttonSecondary} onClick={() => setSelectedRow(null)}>
                关闭
              </button>
            </div>
            <div className="grid gap-3">
              <label className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-medium">设为默认提示词</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs opacity-80">同领域仅一个</span>
                  <input
                    type="checkbox"
                    checked={editIsDefault}
                    onChange={(e) => setEditIsDefault(e.target.checked)}
                    disabled={detailMode === "view"}
                  />
                </span>
              </label>
              <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Agent</span>
                {detailMode === "view" ? (
                  <input className={ui.input} value={editAgent} disabled />
                ) : (
                  <Select
                    aria-label="编辑 Agent"
                    variant="secondary"
                    selectedKey={editAgent}
                    onSelectionChange={(key) => setEditAgent(String(key) as AgentOption)}
                  >
                    <Select.Trigger className={ui.input}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox aria-label="编辑 Agent 选项">
                        <ListBoxItem id="xiaohongshu">xiaohongshu</ListBoxItem>
                        <ListBoxItem id="cases">cases</ListBoxItem>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}
              </label>
              <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">领域</span>
                <input
                  className={ui.input}
                  value={editType}
                  onChange={(e) => setEditType(e.target.value)}
                  disabled={detailMode === "view"}
                />
              </label>
              <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">名称</span>
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
                  className={`min-h-[320px] ${ui.textarea}`}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  disabled={detailMode === "view"}
                />
              </label>
              {detailMode === "edit" ? (
                <div className="ml-auto">
                  <button className={ui.buttonPrimary} onClick={() => void saveStyleEdit()} disabled={saving}>
                    {saving ? "保存中..." : "保存修改"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <p className={ui.sectionTitle}>创建提示词</p>
              <button className={ui.buttonSecondary} type="button" onClick={() => setCreateOpen(false)}>
                关闭
              </button>
            </div>
            <div className="grid gap-3">
              <label className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <span className="font-medium">设为默认提示词</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs opacity-80">同领域仅一个</span>
                  <input
                    type="checkbox"
                    checked={createIsDefault}
                    onChange={(e) => setCreateIsDefault(e.target.checked)}
                  />
                </span>
              </label>
              <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">1. 名称</span>
                <input
                  className={ui.input}
                  value={createStyle}
                  onChange={(e) => setCreateStyle(e.target.value)}
                  placeholder="例如：小红书爆款结构化"
                />
              </label>
              <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">2. 选择 Agent</span>
                <Select
                  aria-label="选择 Agent"
                  variant="secondary"
                  selectedKey={createAgent}
                  onSelectionChange={(key) => setCreateAgent(String(key) as AgentOption)}
                >
                  <Select.Trigger className={ui.input}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox aria-label="Agent 选项">
                      <ListBoxItem id="xiaohongshu">xhs</ListBoxItem>
                      <ListBoxItem id="cases">case</ListBoxItem>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </label>

              <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">3. 选择领域</span>
                <Select
                  aria-label="选择领域"
                  variant="secondary"
                  selectedKey={createDomain}
                  onSelectionChange={(key) => setCreateDomain(String(key))}
                >
                  <Select.Trigger className={ui.input}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox aria-label="领域选项">
                      {domainOptions.map((item) => (
                        <ListBoxItem id={item} key={item}>
                          {item}
                        </ListBoxItem>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </label>
              {createDomain === "自定义" ? (
                <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">自定义领域</span>
                  <input
                    className={ui.input}
                    value={createCustomDomain}
                    onChange={(e) => setCreateCustomDomain(e.target.value)}
                    placeholder="输入领域名"
                  />
                </label>
              ) : null}

              <label className="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">4. 输入提示词（Markdown）</span>
                <textarea
                  className={`min-h-[280px] font-mono ${ui.textarea}`}
                  value={createBody}
                  onChange={(e) => setCreateBody(e.target.value)}
                  placeholder={"# 角色\n你是...\n\n# 目标\n请输出...\n\n# 约束\n- ..."}
                />
              </label>

              <div className="ml-auto flex items-center gap-2">
                <button className={ui.buttonSecondary} type="button" onClick={() => setCreateOpen(false)}>
                  取消
                </button>
                <button className={ui.buttonPrimary} type="button" onClick={() => void submitCreatePrompt()} disabled={creating}>
                  {creating ? "创建中..." : "创建提示词"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {loading ? <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">加载中...</p> : null}
      {error ? <p className={ui.error}>{error}</p> : null}
    </section>
  );
}
