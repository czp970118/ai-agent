"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pagination } from "@heroui/react";
import { adminFormStyles as ui } from "../components/formStyles";
import CategorySelect from "./CategorySelect";
import ConfirmAlertDialog from "./ConfirmAlertDialog";
import PaginationPageSizeSelect from "./PaginationPageSizeSelect";
import QuestionBankEditDialog from "./QuestionBankEditDialog";
import { formatQuestionUsedAt, isQuestionUsed } from "./questionBankFormat";
import { formatRealExamSummary, questionHasRealExamMeta } from "./realExam";
import {
  deleteQuestionBank,
  deleteQuestionBankBatch,
  listQuestionBank,
  type QuestionBankItem,
  type QuestionBankUsageFilter,
} from "./questionBankClient";

const CATEGORIES = ["", "公基", "行测", "时政", "面试", "未分类"];

const USAGE_OPTIONS: { id: QuestionBankUsageFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "unused", label: "未使用" },
  { id: "used", label: "已使用" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type PendingDelete = { kind: "one"; id: string } | { kind: "batch"; ids: string[] };

export default function QuestionBankListClient() {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [total, setTotal] = useState(0);
  const [usedTotal, setUsedTotal] = useState(0);
  const [unusedTotal, setUnusedTotal] = useState(0);
  const [category, setCategory] = useState("");
  const [usage, setUsage] = useState<QuestionBankUsageFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("");
  const [appliedUsage, setAppliedUsage] = useState<QuestionBankUsageFilter>("all");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<QuestionBankItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchKey, setSearchKey] = useState(0);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const pageIds = useMemo(() => items.map((it) => it.id), [items]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listQuestionBank({
        category: appliedCategory || undefined,
        usage: appliedUsage,
        keyword: appliedKeyword || undefined,
        limit,
        offset,
      });
      setItems(data.items);
      setTotal(data.total);
      setUsedTotal(data.usedTotal);
      setUnusedTotal(data.unusedTotal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [appliedCategory, appliedUsage, appliedKeyword, limit, offset, searchKey]);

  const handleSearch = () => {
    setAppliedCategory(category);
    setAppliedUsage(usage);
    setAppliedKeyword(keyword);
    setOffset(0);
    setSearchKey((k) => k + 1);
  };

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      if (pendingDelete.kind === "one") {
        await deleteQuestionBank(pendingDelete.id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(pendingDelete.id);
          return next;
        });
      } else {
        await deleteQuestionBankBatch(pendingDelete.ids);
        setSelectedIds(new Set());
      }
      setPendingDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const deleteDialogMessage =
    pendingDelete?.kind === "one"
      ? "确认删除这道题目？此操作不可恢复。"
      : `确认删除选中的 ${pendingDelete?.ids.length ?? 0} 道题目？此操作不可恢复。`;

  const pages = useMemo(() => {
    const maxButtons = 7;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const start = Math.max(1, Math.min(page - 3, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, i) => start + i);
  }, [page, totalPages]);

  return (
    <div className={ui.page}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={ui.title}>考公题库</h1>
          <p className={`mt-1 ${ui.hint}`}>
            已入库 {usedTotal + unusedTotal} 题（未使用 {unusedTotal} · 已使用 {usedTotal}
            ）。每日一题导出发布后，题目将标记为已使用且不再参与召回。
          </p>
        </div>
        <Link
          href="/admin/question-bank/import"
          className={`${ui.buttonPrimary} ${ui.controlH} inline-flex items-center`}
        >
          导入题库
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <CategorySelect
          label="分类筛选"
          aria-label="分类筛选"
          value={category || "__all__"}
          onChange={(v) => setCategory(v === "__all__" ? "" : v)}
          disabled={loading}
          options={CATEGORIES.map((c) => ({
            id: c || "__all__",
            label: c || "全部",
          }))}
        />
        <CategorySelect
          label="使用状态"
          aria-label="使用状态筛选"
          value={usage}
          onChange={(v) => setUsage(v as QuestionBankUsageFilter)}
          disabled={loading}
          options={USAGE_OPTIONS.map((opt) => ({ id: opt.id, label: opt.label }))}
        />
        <div className="flex min-w-[10rem] shrink-0 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <span className="whitespace-nowrap font-medium text-slate-500 dark:text-slate-400">
            关键字
          </span>
          <input
            type="text"
            placeholder="搜索题干/标题/解析…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            className={`${ui.inputControl} ${ui.controlH} w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm placeholder-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:placeholder-slate-500`}
          />
        </div>
        <button
          type="button"
          className={`${ui.buttonPrimary} ${ui.controlH} shrink-0 self-end`}
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? "搜索中…" : "搜索"}
        </button>
        {selectedCount > 0 ? (
          <button
            type="button"
            className={`${ui.buttonDanger} ${ui.controlH} shrink-0 self-end`}
            disabled={loading || deleting}
            onClick={() => setPendingDelete({ kind: "batch", ids: Array.from(selectedIds) })}
          >
            批量删除（{selectedCount}）
          </button>
        ) : null}
      </div>

      {error ? <p className={ui.error}>{error}</p> : null}

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead className={ui.tableHeader}>
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="全选本页"
                  checked={allPageSelected}
                  disabled={loading || items.length === 0}
                  onChange={toggleSelectAllPage}
                />
              </th>
              <th className="px-3 py-2">分类</th>
              <th className="px-3 py-2">真题</th>
              <th className="px-3 py-2">领域</th>
              <th className="px-3 py-2">标签</th>
              <th className="px-3 py-2">标题</th>
              <th className="px-3 py-2">题干</th>
              <th className="px-3 py-2">答案</th>
              <th className="px-3 py-2">使用状态</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const used = isQuestionUsed(row.usedAt);
              const usedLabel = formatQuestionUsedAt(row.usedAt);
              return (
                <tr key={row.id} className={ui.tableRow}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      disabled={loading}
                      aria-label={`选择题目 ${row.stem.slice(0, 20)}`}
                      onChange={() => toggleSelect(row.id)}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={ui.badge}>{row.category || "—"}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {questionHasRealExamMeta(row) ? (
                      <span className={ui.badge} title="真题来源">
                        {formatRealExamSummary(
                          row.examYear ?? "",
                          row.examRegion ?? "",
                          row.examKind ?? "",
                        )}
                      </span>
                    ) : (
                      <span className={ui.hint}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.subjectDomain ? (
                      <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                        {row.subjectDomain}
                      </span>
                    ) : (
                      <span className={ui.hint}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-[12rem] flex-wrap gap-1">
                      {(row.tags ?? []).length ? (
                        (row.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className={ui.hint}>—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-400">
                    {row.header}
                  </td>
                  <td className="max-w-md px-3 py-2 text-slate-800 dark:text-slate-200">
                    <p className="line-clamp-2">{row.stem}</p>
                  </td>
                  <td className="px-3 py-2 font-medium">{row.answer}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {used ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex w-fit rounded-md bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          已使用
                        </span>
                        {usedLabel ? (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {usedLabel}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="inline-flex rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                        未使用
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={ui.buttonSecondary}
                        disabled={loading || deleting}
                        onClick={() => setEditingItem(row)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className={ui.buttonDanger}
                        disabled={loading || deleting}
                        onClick={() => setPendingDelete({ kind: "one", id: row.id })}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                  暂无题目，请先
                  <Link href="/admin/question-bank/import" className="mx-1 underline">
                    导入题库
                  </Link>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination size="sm" className="mt-4 w-full flex-wrap items-center justify-between gap-3">
        <Pagination.Summary className="flex flex-wrap items-center gap-3">
          <PaginationPageSizeSelect
            value={limit}
            options={PAGE_SIZE_OPTIONS}
            disabled={loading}
            onChange={(n) => {
              setLimit(n);
              setOffset(0);
            }}
          />
          <span className={ui.hint}>
            {loading
              ? "加载中…"
              : total > 0
                ? `第 ${page}/${totalPages} 页，共 ${total} 条`
                : "共 0 条"}
          </span>
        </Pagination.Summary>
        {total > 0 ? (
          <Pagination.Content>
            <Pagination.Item>
              <Pagination.Previous
                isDisabled={page <= 1 || loading}
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
                isDisabled={page >= totalPages || loading}
                onPress={() => setOffset((v) => v + limit)}
              >
                下一页
                <Pagination.NextIcon />
              </Pagination.Next>
            </Pagination.Item>
          </Pagination.Content>
        ) : null}
      </Pagination>

      <QuestionBankEditDialog
        open={Boolean(editingItem)}
        item={editingItem}
        busy={loading}
        onClose={() => setEditingItem(null)}
        onSaved={(item) => {
          setItems((prev) => prev.map((row) => (row.id === item.id ? item : row)));
        }}
      />

      {pendingDelete ? (
        <ConfirmAlertDialog
          open
          title="确认删除"
          message={deleteDialogMessage}
          confirmLabel="删除"
          status="danger"
          confirmClassName={ui.buttonDanger}
          busy={deleting}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          onConfirm={() => void runDelete()}
        />
      ) : null}
    </div>
  );
}
