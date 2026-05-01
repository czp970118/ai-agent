"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";

type TaskItem = {
  task_id: string;
  source: string;
  run_date: string;
  domain: string;
  city: string;
  fetch_count: number;
  time_points: string[];
  topics: string[];
  page_size: number;
  repeat_count: number;
  email_enabled: boolean;
  status: "PENDING" | "SUCCESS" | "FAILED";
  slot_results?: Record<string, string>;
  error_message?: string;
  created_at: string;
};

type TaskListResp = {
  items?: TaskItem[];
};

function generateRandomTimePoints(count: number): string[] {
  const target = Math.max(1, count);
  const picked = new Set<string>();
  while (picked.size < target) {
    const hour = 8 + Math.floor(Math.random() * 16);
    const minute = Math.floor(Math.random() * 60);
    picked.add(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return [...picked].sort((a, b) => a.localeCompare(b));
}

function getMcpBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://127.0.0.1";
}

export default function SchedulerAdminClient() {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancellingId, setCancellingId] = useState("");
  const [retryingId, setRetryingId] = useState("");
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [source, setSource] = useState("xhs");
  const [runDate, setRunDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [domain, setDomain] = useState("旅游");
  const [city, setCity] = useState("");
  const [fetchCount, setFetchCount] = useState(4);
  const [pageSize, setPageSize] = useState(20);
  const [repeatCount, setRepeatCount] = useState(2);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [timePoints, setTimePoints] = useState<string[]>(["09:00", "12:00", "15:00", "20:00"]);
  const [topics, setTopics] = useState<string[]>(["旅游攻略", "避雷指南", "美食推荐", "拍照打卡"]);
  const sourceOptions = ["xhs"];
  const domainOptions = ["旅游", "考公", "穿搭", "吃喝", "职场", "健身", "情感", "其他"];
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [domainFilterOpen, setDomainFilterOpen] = useState(false);
  const sourceFilterRef = useRef<HTMLDivElement | null>(null);
  const domainFilterRef = useRef<HTMLDivElement | null>(null);

  const taskStatusClass = useCallback((status: TaskItem["status"]) => {
    if (status === "SUCCESS")
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    if (status === "FAILED")
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${getMcpBaseUrl()}/search/scheduler/xhs/tasks?limit=200`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TaskListResp;
      setTasks(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    setTimePoints((prev) => {
      const out = [...prev];
      while (out.length < fetchCount) out.push("09:00");
      return out.slice(0, fetchCount);
    });
    setTopics((prev) => {
      const out = [...prev];
      while (out.length < fetchCount) out.push("");
      return out.slice(0, fetchCount);
    });
  }, [fetchCount]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (sourceFilterRef.current && target && !sourceFilterRef.current.contains(target)) {
        setSourceFilterOpen(false);
      }
      if (domainFilterRef.current && target && !domainFilterRef.current.contains(target)) {
        setDomainFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function createTask() {
    if (!city.trim()) {
      setError("请填写抓取城市");
      return;
    }
    if (topics.some((t) => !String(t || "").trim())) {
      setError("每个抓取次数都需要配置对应主题");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${getMcpBaseUrl()}/search/scheduler/xhs/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: source.trim() || "xhs",
          run_date: runDate,
          domain: domain.trim(),
          city: city.trim(),
          fetch_count: fetchCount,
          time_points: timePoints,
          topics,
          page_size: pageSize,
          repeat_count: repeatCount,
          email_enabled: emailEnabled,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSource("xhs");
      setDomain("旅游");
      setCity("");
      setFetchCount(4);
      setPageSize(20);
      setRepeatCount(2);
      setEmailEnabled(true);
      setRunDate(new Date().toISOString().slice(0, 10));
      setTimePoints(["09:00", "12:00", "15:00", "20:00"]);
      setTopics(["旅游攻略", "避雷指南", "美食推荐", "拍照打卡"]);
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function cancelTask(taskId: string) {
    setCancellingId(taskId);
    setError("");
    try {
      const res = await fetch(`${getMcpBaseUrl()}/search/scheduler/xhs/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失败");
    } finally {
      setCancellingId("");
    }
  }

  async function retryTask(taskId: string) {
    setRetryingId(taskId);
    setError("");
    try {
      const res = await fetch(`${getMcpBaseUrl()}/search/scheduler/xhs/tasks/${encodeURIComponent(taskId)}/retry`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重试失败");
    } finally {
      setRetryingId("");
    }
  }

  const pendingCount = useMemo(() => tasks.filter((t) => t.status === "PENDING").length, [tasks]);
  const randomizeTimePoints = useCallback(() => {
    setTimePoints(generateRandomTimePoints(fetchCount));
  }, [fetchCount]);

  return (
    <section className={ui.page}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className={ui.title}>定时任务管理</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">按实例配置抓取策略，追踪执行状态并支持失败重试。</p>
        </div>
        <button type="button" className={ui.buttonSecondary} onClick={() => void loadTasks()} disabled={loading}>
          刷新
        </button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 px-4 py-3 dark:border-slate-700 dark:from-slate-900 dark:to-slate-900/60">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">任务总数</p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{tasks.length}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-4 py-3 dark:border-amber-800 dark:from-amber-950/30 dark:to-slate-900">
          <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">待执行</p>
          <p className="mt-1 text-lg font-semibold text-amber-700 dark:text-amber-200">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3 dark:border-emerald-800 dark:from-emerald-950/30 dark:to-slate-900">
          <p className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">已完成</p>
          <p className="mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-200">
            {tasks.filter((t) => t.status === "SUCCESS").length}
          </p>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white p-4 dark:border-slate-700 dark:from-slate-900/70 dark:to-slate-900">
        <p className={ui.sectionTitle}>创建任务实例</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1">
            <span className={ui.hint}>抓取目标 Source</span>
            <div className="relative" ref={sourceFilterRef}>
              <button
                type="button"
                className={`${ui.input} inline-flex w-full items-center justify-between`}
                onClick={() => setSourceFilterOpen((v) => !v)}
              >
                <span className="truncate">{source || "请选择 Source"}</span>
                <span className="text-[10px] text-slate-400">▼</span>
              </button>
              {sourceFilterOpen ? (
                <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="grid gap-1">
                    {sourceOptions.map((item) => {
                      const active = source === item;
                      return (
                        <button
                          key={item}
                          type="button"
                          className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${
                            active
                              ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                              : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800"
                          }`}
                          onClick={() => {
                            setSource(item);
                            setSourceFilterOpen(false);
                          }}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </label>
          <label className="grid gap-1">
            <span className={ui.hint}>领域</span>
            <div className="relative" ref={domainFilterRef}>
              <button
                type="button"
                className={`${ui.input} inline-flex w-full items-center justify-between`}
                onClick={() => setDomainFilterOpen((v) => !v)}
              >
                <span className="truncate">{domain || "请选择领域"}</span>
                <span className="text-[10px] text-slate-400">▼</span>
              </button>
              {domainFilterOpen ? (
                <div className="absolute left-0 top-[calc(100%+6px)] z-20 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="grid gap-1">
                    {domainOptions.map((item) => {
                      const active = domain === item;
                      return (
                        <button
                          key={item}
                          type="button"
                          className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${
                            active
                              ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                              : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800"
                          }`}
                          onClick={() => {
                            setDomain(item);
                            setDomainFilterOpen(false);
                          }}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </label>
          <label className="grid gap-1">
            <span className={ui.hint}>执行日期</span>
            <input
              className={ui.input}
              type="date"
              value={runDate}
              onChange={(e) => setRunDate(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className={ui.hint}>城市</span>
            <input className={ui.input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="如：杭州" />
          </label>
          <label className="grid gap-1">
            <span className={ui.hint}>抓取次数</span>
            <input className={ui.input} type="number" min={1} max={24} value={fetchCount} onChange={(e) => setFetchCount(Number(e.target.value || 1))} />
          </label>
          <label className="grid gap-1">
            <span className={ui.hint}>每次抓取条数</span>
            <input
              className={ui.input}
              type="number"
              min={1}
              max={100}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value || 1))}
            />
          </label>
          <label className="grid gap-1">
            <span className={ui.hint}>每主题重复抓取次数</span>
            <input
              className={ui.input}
              type="number"
              min={1}
              max={10}
              value={repeatCount}
              onChange={(e) => setRepeatCount(Number(e.target.value || 1))}
            />
          </label>
          <div className="grid gap-1">
            <span className={ui.hint}>是否发送邮件</span>
            <button
              type="button"
              onClick={() => setEmailEnabled((prev) => !prev)}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border-slate-200 bg-white px-3 text-left transition"
              aria-pressed={emailEnabled}
            >
              <span className="text-sm text-slate-700 dark:text-slate-200">{emailEnabled ? "发送邮件通知" : "不发邮件通知"}</span>
              <span
                className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition ${
                  emailEnabled ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-600"
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-white shadow transition ${
                    emailEnabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/70">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">抓取时间点与主题（长度必须与抓取次数一致）</p>
            <button type="button" className={ui.buttonSecondary} onClick={randomizeTimePoints}>
              一键随机生成时间点
            </button>
          </div>
          <div className="grid gap-2">
            {Array.from({ length: fetchCount }, (_, idx) => (
              <div key={`slot-${idx}`} className="grid gap-2 md:grid-cols-[140px_1fr]">
                <input
                  className={ui.input}
                  type="time"
                  value={timePoints[idx] || "09:00"}
                  onChange={(e) =>
                    setTimePoints((prev) => {
                      const out = [...prev];
                      out[idx] = e.target.value;
                      return out;
                    })
                  }
                />
                <input
                  className={ui.input}
                  value={topics[idx] || ""}
                  placeholder={`第${idx + 1}次主题`}
                  onChange={(e) =>
                    setTopics((prev) => {
                      const out = [...prev];
                      out[idx] = e.target.value;
                      return out;
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className={ui.hint}>当前待执行任务：{pendingCount}</p>
          <button type="button" className={ui.buttonPrimary} onClick={() => void createTask()} disabled={creating}>
            {creating ? "创建中..." : "创建任务"}
          </button>
        </div>
      </div>

      <div className={`${ui.tableWrap} overflow-hidden`}>
        <table className={`${ui.table} min-w-[1280px]`}>
          <thead className={`${ui.tableHeader} sticky top-0 z-10`}>
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">状态</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">Source</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">执行日期</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">城市</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">领域</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">时间点</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">主题</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">进度</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">抓取设置</th>
              <th className="whitespace-nowrap px-3 py-2 text-left align-middle">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.task_id} className={ui.tableRow}>
                <td className="px-3 py-2 text-xs align-middle">
                  <span className={`inline-flex rounded-md border px-2 py-0.5 ${taskStatusClass(t.status)}`}>{t.status}</span>
                </td>
                <td className="px-3 py-2 text-xs align-middle">{t.source}</td>
                <td className="px-3 py-2 text-xs align-middle">{t.run_date || "-"}</td>
                <td className="px-3 py-2 text-xs align-middle">{t.city}</td>
                <td className="px-3 py-2 text-xs align-middle">{t.domain || "-"}</td>
                <td className="px-3 py-2 text-xs align-middle">
                  <div className="flex flex-wrap gap-1.5">
                    {(t.time_points || []).map((tp, idx) => (
                      <span
                        key={`${t.task_id}-time-${idx}`}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {tp}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs align-middle">
                  <div className="flex flex-wrap gap-1.5">
                    {(t.topics || []).map((topic, idx) => (
                      <span
                        key={`${t.task_id}-topic-${idx}`}
                        className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs align-middle">
                  {(() => {
                    const slotResults = t.slot_results && typeof t.slot_results === "object" ? t.slot_results : {};
                    const done = Array.from({ length: t.fetch_count }, (_, i) => {
                      const v = String(slotResults[String(i)] || "");
                      return v === "SUCCESS" || v === "FAILED";
                    }).filter(Boolean).length;
                    return `${done}/${t.fetch_count}`;
                  })()}
                </td>
                <td className="px-3 py-2 text-xs align-middle">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800">
                      次数 {t.fetch_count}
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800">
                      条数 {t.page_size}
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800">
                      重复 {t.repeat_count}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs align-middle">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={ui.buttonDanger}
                      disabled={t.status !== "PENDING" || cancellingId === t.task_id}
                      onClick={() => void cancelTask(t.task_id)}
                    >
                      {cancellingId === t.task_id ? "取消中..." : "取消任务"}
                    </button>
                    <button
                      type="button"
                      className={ui.buttonSecondary}
                      disabled={t.status !== "FAILED" || retryingId === t.task_id}
                      onClick={() => void retryTask(t.task_id)}
                    >
                      {retryingId === t.task_id ? "重试中..." : "重试失败项"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!tasks.length ? (
              <tr>
                <td className="px-3 py-3 text-xs text-slate-500 align-middle" colSpan={10}>
                  暂无任务实例
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {loading ? <p className="mt-3 text-xs text-slate-500">加载中...</p> : null}
      {error ? <p className={ui.error}>{error}</p> : null}
    </section>
  );
}
