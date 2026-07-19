"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CreativeWork, listWorks, PLATFORM_META } from "./workStorage";

function formatRelative(ts: number) {
  const d = Date.now() - ts;
  if (d < 60_000) return "刚刚";
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}

const STATUS_LABEL: Record<CreativeWork["status"], string> = {
  draft: "草稿",
  ready: "已定稿",
};

export default function CreativeCenterHubClient() {
  const searchParams = useSearchParams();
  const missing = searchParams.get("missing") === "1";

  const [works, setWorks] = useState<CreativeWork[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      const list = await listWorks();
      setWorks(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "加载作品失败");
      setWorks([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setHydrated(true);
    })();
  }, [refresh]);

  if (!hydrated) {
    return <div className="text-sm text-slate-500 dark:text-slate-400">加载中…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            创作中心
          </h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600 dark:text-slate-400">
            此处展示已保存的作品（含草稿）。选择创作方式开始新作品；数据由 MCP 服务写入 SQLite。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 self-end sm:self-start">
          <Link
            href="/admin/creative-center/daily-quiz"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60"
          >
            每日一题
          </Link>
          <Link
            href="/admin/creative-center/new"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            流式创作
          </Link>
        </div>
      </header>

      <section className="mb-8 grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/creative-center/daily-quiz"
          className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 transition-colors hover:border-amber-300 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 dark:hover:border-amber-800"
        >
          <p className="font-medium text-amber-950 dark:text-amber-100">每日一题</p>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
            从题库选题或手动填写，生成题目卡 + 答案解析卡两张图。
          </p>
        </Link>
        <Link
          href="/admin/creative-center/new"
          className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-600"
        >
          <p className="font-medium text-slate-900 dark:text-slate-100">流式创作</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            AI 生成正文，配合封面、素材与提示词模板。
          </p>
        </Link>
      </section>

      {loadError ? (
        <p
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {missing ? (
        <p
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
          role="alert"
        >
          该作品不存在或已删除，请从下方列表返回或新建创作。
        </p>
      ) : null}

      {works.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/20 dark:text-slate-400">
          暂无作品。上方选择「每日一题」或「流式创作」开始。
        </p>
      ) : (
        <section aria-labelledby="works-heading">
          <h2
            id="works-heading"
            className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200"
          >
            全部作品
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {works.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/admin/creative-center/w/${w.id}`}
                  className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-600"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {w.title.trim() || "未命名作品"}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${PLATFORM_META[w.platform].chipClass}`}
                    >
                      {PLATFORM_META[w.platform].label}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {STATUS_LABEL[w.status]}
                    </span>
                    {w.domain ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {w.domain}
                      </span>
                    ) : null}
                  </div>
                  {w.prompt.trim() ? (
                    <p className="mt-2 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">
                      {w.prompt}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">未记录提示词</p>
                  )}
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-500">
                    更新 · {formatRelative(w.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
