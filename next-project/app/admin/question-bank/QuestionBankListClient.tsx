"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";
import CategorySelect from "./CategorySelect";
import { formatQuestionUsedAt, isQuestionUsed } from "./questionBankFormat";
import {
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

export default function QuestionBankListClient() {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [total, setTotal] = useState(0);
  const [usedTotal, setUsedTotal] = useState(0);
  const [unusedTotal, setUnusedTotal] = useState(0);
  const [category, setCategory] = useState("");
  const [usage, setUsage] = useState<QuestionBankUsageFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listQuestionBank({
        category: category || undefined,
        usage,
        limit: 200,
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
  }, [category, usage]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <label className="block text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">使用状态</span>
          <select
            value={usage}
            onChange={(e) => setUsage(e.target.value as QuestionBankUsageFilter)}
            disabled={loading}
            className={`${ui.input} mt-1 w-32`}
            aria-label="使用状态筛选"
          >
            {USAGE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`${ui.buttonSecondary} ${ui.controlH} shrink-0 self-end`}
          onClick={() => void load()}
          disabled={loading}
        >
          刷新
        </button>
      </div>

      {error ? <p className={ui.error}>{error}</p> : null}

      <p className={`${ui.hint} mb-3`}>
        {loading ? "加载中…" : `当前筛选共 ${total} 题`}
      </p>

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead className={ui.tableHeader}>
            <tr>
              <th className="px-3 py-2">分类</th>
              <th className="px-3 py-2">标题</th>
              <th className="px-3 py-2">题干</th>
              <th className="px-3 py-2">答案</th>
              <th className="px-3 py-2">使用状态</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const used = isQuestionUsed(row.usedAt);
              const usedLabel = formatQuestionUsedAt(row.usedAt);
              return (
                <tr key={row.id} className={ui.tableRow}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={ui.badge}>{row.category || "—"}</span>
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
                </tr>
              );
            })}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  暂无题目，请先
                  <Link href="/admin/question-bank/import" className="mx-1 underline">
                    导入 Word
                  </Link>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
