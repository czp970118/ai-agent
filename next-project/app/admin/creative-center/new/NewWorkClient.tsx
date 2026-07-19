"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { MessageReference } from "@/app/assistant/utils/types";
import DraftStreamCreation, { type StreamAdoptMeta } from "../DraftStreamCreation";
import { coverToWorkPatch, emptyCreativeCover, type CreativeCoverState } from "../creativeCover";
import { useMaterialCache } from "../useMaterialCache";
import { createWork, type WorkStatus } from "../workStorage";

function buildStoredPrompt(meta: StreamAdoptMeta) {
  const a = meta.promptLine.trim();
  const b = meta.promptStyleName.trim();
  if (a && b) return `${a}\n模板：${b}`;
  if (a) return a;
  if (b) return `模板：${b}`;
  return "";
}

export default function NewWorkClient() {
  const router = useRouter();
  const pendingId = useMemo(() => crypto.randomUUID(), []);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [body, setBody] = useState("");
  const [domain, setDomain] = useState("旅游");
  const [status, setStatus] = useState<WorkStatus>("draft");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { materialCache, fetchLinkedNotes, loadNextMaterialBatch, resetMaterialCache } =
    useMaterialCache();
  const [cover, setCover] = useState<CreativeCoverState>(emptyCreativeCover);

  const handleAdoptStream = useCallback(
    async (content: string, refs: MessageReference[], meta: StreamAdoptMeta) => {
      void refs;
      const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const first = lines[0] ?? "";
      setDomain(meta.domain);
      setPrompt(buildStoredPrompt(meta));
      setBody(content);
      if (!title.trim() && first.length > 0 && first.length <= 60) {
        setTitle(first);
      }
    },
    [title],
  );

  const saveWork = async () => {
    setSaveError(null);
    if (!cover.path.trim()) {
      setSaveError("请先上传或生成封面图");
      return;
    }
    setSaving(true);
    try {
      await createWork({
        id: pendingId,
        title: title.trim() || "未命名作品",
        prompt,
        body,
        domain,
        status,
        platform: "xhs",
        ...coverToWorkPatch(cover),
      });
      router.push(`/admin/creative-center/w/${pendingId}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const topSlot = (
    <label className="block text-sm">
      <span className="font-medium text-slate-700 dark:text-slate-200">作品名称</span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="填写作品名称，便于在创作中心识别"
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
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveWork()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {saving ? "保存中…" : "保存至创作中心"}
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">保存后将进入该作品的编辑页。</p>
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
          新建作品
        </h1>
      </header>

      <DraftStreamCreation
        workId={pendingId}
        domain={domain}
        onDomainChange={setDomain}
        onAdopt={handleAdoptStream}
        topSlot={topSlot}
        showMaterialPanel
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
    </div>
  );
}
