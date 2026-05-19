"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MessageReference } from "@/app/assistant/utils/types";
import DraftStreamCreation, { type StreamAdoptMeta } from "../../DraftStreamCreation";
import {
  coverFromWork,
  coverToWorkPatch,
  emptyCreativeCover,
  type CreativeCoverState,
} from "../../creativeCover";
import { useMaterialCache } from "../../useMaterialCache";
import {
  CreativeWork,
  deleteWork,
  getWork,
  PLATFORM_META,
  updateWork,
  type WorkStatus,
} from "../../workStorage";

function buildStoredPrompt(meta: StreamAdoptMeta) {
  const a = meta.promptLine.trim();
  const b = meta.promptStyleName.trim();
  if (a && b) return `${a}\n模板：${b}`;
  if (a) return a;
  if (b) return `模板：${b}`;
  return "";
}

export default function WorkEditorClient() {
  const params = useParams();
  const router = useRouter();
  const workId = params.workId as string;

  const [work, setWork] = useState<CreativeWork | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [body, setBody] = useState("");
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<WorkStatus>("draft");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { materialCache, fetchLinkedNotes, loadNextMaterialBatch, resetMaterialCache } =
    useMaterialCache();
  const [cover, setCover] = useState<CreativeCoverState>(emptyCreativeCover);

  const isXhs = useMemo(() => work?.platform === "xhs", [work]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setHydrated(false);
      setLoadError(null);
      try {
        const w = await getWork(workId);
        if (cancelled) return;
        if (!w) {
          setWork(null);
          router.replace("/admin/creative-center?missing=1");
          setHydrated(true);
          return;
        }
        setWork(w);
        setTitle(w.title);
        setPrompt(w.prompt);
        setBody(w.body);
        setDomain(w.domain || "旅游");
        setStatus(w.status);
        setCover(coverFromWork(w));
      } catch (e) {
        if (!cancelled) {
          setWork(null);
          setLoadError(e instanceof Error ? e.message : "加载失败");
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workId, router]);

  const handleAdoptStream = useCallback(
    async (content: string, refs: MessageReference[], meta: StreamAdoptMeta) => {
      void refs;
      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const first = lines[0] ?? "";
      const nextPrompt = buildStoredPrompt(meta);
      let nextTitle = title;
      if (!title.trim() || title === "未命名作品") {
        if (first.length > 0 && first.length <= 60) nextTitle = first;
      }
      setDomain(meta.domain);
      setPrompt(nextPrompt);
      setBody(content);
      setTitle(nextTitle);
      try {
        const updated = await updateWork(workId, {
          title: nextTitle,
          prompt: nextPrompt,
          body: content,
          domain: meta.domain,
          status,
        });
        setWork(updated);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "自动保存失败");
      }
    },
    [title, status, workId],
  );

  const persist = useCallback(
    async (
      patch?: Partial<{
        title: string;
        prompt: string;
        body: string;
        domain: string;
        status: WorkStatus;
        cover: CreativeCoverState;
      }>,
    ) => {
      const c = patch?.cover ?? cover;
      if (!c.path.trim()) {
        throw new Error("请先上传或生成封面图");
      }
      await updateWork(workId, {
        title: patch?.title ?? title,
        prompt: patch?.prompt ?? prompt,
        body: patch?.body ?? body,
        domain: patch?.domain ?? domain,
        status: patch?.status ?? status,
        ...coverToWorkPatch(c),
      });
      const w = await getWork(workId);
      if (w) setWork(w);
    },
    [workId, title, prompt, body, domain, status, cover],
  );

  const onSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await persist();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!window.confirm("确定删除该作品？不可恢复。")) return;
    try {
      await deleteWork(workId);
      router.push("/admin/creative-center");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "删除失败");
    }
  };

  if (!hydrated) {
    return <div className="text-sm text-slate-500 dark:text-slate-400">加载中…</div>;
  }

  if (hydrated && !work && !loadError) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400">正在返回创作中心…</div>
    );
  }

  if (loadError || !work) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400">
        {loadError ?? "无法加载作品。"}{" "}
        <a
          href="/admin/creative-center"
          className="font-medium text-slate-700 underline dark:text-slate-300"
        >
          返回创作中心
        </a>
      </div>
    );
  }

  const topSlot = (
    <label className="block text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-200">作品名称</span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none ring-rose-200/30 focus-visible:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:ring-rose-500/20"
      />
    </label>
  );

  const footerSlot = (
    <>
      {saveError ? (
        <p className="max-w-full self-end text-sm text-red-600 dark:text-red-400" role="alert">
          {saveError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
        >
          删除
        </button>
      </div>
      <p className="text-xs text-slate-400">作品保存在服务端数据库。</p>
    </>
  );

  return (
    <div className="w-full max-w-none">
      <header className="mb-8 flex flex-wrap items-center gap-3 border-b border-slate-200 pb-6 dark:border-slate-800">
        <Link
          href="/admin/creative-center"
          className="shrink-0 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          ← 创作中心
        </Link>
        <span className="text-slate-300 dark:text-slate-600" aria-hidden>
          |
        </span>
        <h1 className="min-w-0 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {title.trim() || "未命名作品"}
        </h1>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${PLATFORM_META[work.platform].chipClass}`}
        >
          {PLATFORM_META[work.platform].label}
        </span>
      </header>

      {isXhs ? (
        <DraftStreamCreation
          key={workId}
          workId={workId}
          initialDomain={work.domain}
          domain={domain}
          onDomainChange={setDomain}
          onAdopt={handleAdoptStream}
          topSlot={topSlot}
          materialCache={materialCache}
          onLoadNextMaterialBatch={() => void loadNextMaterialBatch()}
          cover={cover}
          onCoverChange={setCover}
          workTitle={title}
          body={body}
          onBodyChange={setBody}
          draftStatus={status}
          onDraftStatusChange={setStatus}
          footerSlot={footerSlot}
          onStreamSuccess={fetchLinkedNotes}
          onStreamStart={() => {
            setStatus("draft");
            resetMaterialCache();
            setCover(emptyCreativeCover());
          }}
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
          className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/40 sm:p-5"
        >
          {topSlot}
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              使用的提示词
            </span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">领域</span>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <div className="shrink-0">
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-400">状态</span>
              <div
                className="mt-1 flex rounded-lg border border-slate-200 bg-slate-50/80 p-0.5 dark:border-slate-700 dark:bg-slate-950/50"
                role="radiogroup"
                aria-label="作品状态"
              >
                {(["draft", "ready"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => setStatus(s)}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      status === s
                        ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                        : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    {s === "draft" ? "草稿" : "已定稿"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">正文</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="在此撰写或粘贴正文…"
              className="mt-1 min-h-[280px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          {footerSlot}
        </form>
      )}
    </div>
  );
}
