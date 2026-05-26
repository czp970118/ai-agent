"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { adminFormStyles as ui } from "@/app/admin/components/formStyles";
import {
  recallQuestions,
  type QuestionBankItem,
} from "@/app/admin/question-bank/questionBankClient";
import {
  renderQuizAnswerCard,
  renderQuizQuestionCard,
} from "../creativeCover";
import { exportDailyQuizZip } from "./dailyQuizExport";
import { publishDailyQuiz } from "./dailyQuizPublish";
import {
  DAILY_QUIZ_SLOT_COUNT,
  emptySlotFromQuestion,
  formatAnswerDisplay,
  optionsToText,
  toQuizImageDisplayUrl,
  type DailyQuizSlot,
} from "./dailyQuizHelpers";
import {
  QuizCardThumbnail,
  QuizImagePreviewModal,
  type QuizPreviewImage,
} from "./QuizImagePreview";

async function generateQuizPair(
  index: number,
  q: QuestionBankItem,
  slotWorkId: (index: number, questionId: string) => string,
) {
  const workId = slotWorkId(index, q.id);
  const questionPath = await renderQuizQuestionCard({
    workId,
    header: q.header.trim() || "公基常识",
    question: q.stem.trim(),
    optionsText: optionsToText(q.options),
  });
  const answerPath = await renderQuizAnswerCard({
    workId,
    header: "答案解析",
    answer: formatAnswerDisplay(q.answer, q.options),
    explanation: q.explanation.trim(),
    extraTitle: q.extraTitle?.trim() || "",
    extraText: q.extraText?.trim() || "",
  });
  return { questionPath, answerPath };
}

export default function DailyQuizClient() {
  const sessionWorkId = useMemo(() => crypto.randomUUID(), []);
  const [category, setCategory] = useState("");
  const [slots, setSlots] = useState<DailyQuizSlot[]>([]);
  const [recalling, setRecalling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [publishInfo, setPublishInfo] = useState<{ workId: string; marked: number } | null>(
    null,
  );
  const [previewImage, setPreviewImage] = useState<QuizPreviewImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slotWorkId = useCallback(
    (index: number, questionId: string) =>
      `${sessionWorkId}-slot-${index}-${questionId}`,
    [sessionWorkId],
  );

  const updateSlot = useCallback(
    (index: number, patch: Partial<DailyQuizSlot>) => {
      setSlots((prev) =>
        prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  const recallBatch = useCallback(
    async (count: number, excludeIds: string[]) => {
      const data = await recallQuestions({
        count,
        excludeIds,
        category: category.trim(),
      });
      return data.items;
    },
    [category],
  );

  const onRecallAll = useCallback(async () => {
    setRecalling(true);
    setError(null);
    try {
      const items = await recallBatch(DAILY_QUIZ_SLOT_COUNT, []);
      setSlots(items.map((q) => emptySlotFromQuestion(q)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "召回失败");
    } finally {
      setRecalling(false);
    }
  }, [recallBatch]);

  const onRerollSlot = useCallback(
    async (index: number) => {
      const excludeIds = slots.map((s) => s.question.id);
      updateSlot(index, { busy: "reroll" });
      setError(null);
      try {
        const items = await recallBatch(1, excludeIds);
        const next = items[0];
        if (!next) throw new Error("没有可替换的题目");
        updateSlot(index, {
          question: next,
          questionPath: "",
          answerPath: "",
          imageVersion: 0,
          busy: null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "重新召回失败");
        updateSlot(index, { busy: null });
      }
    },
    [recallBatch, slots, updateSlot],
  );

  const onGeneratePair = useCallback(
    async (index: number) => {
      updateSlot(index, { busy: "generating", questionPath: "", answerPath: "" });
      setError(null);
      try {
        const q = slots[index]?.question;
        if (!q) throw new Error("题目不存在");
        const { questionPath, answerPath } = await generateQuizPair(index, q, slotWorkId);
        updateSlot(index, {
          questionPath,
          answerPath,
          imageVersion: Date.now(),
          busy: null,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "图片生成失败");
        updateSlot(index, { busy: null });
      }
    },
    [slotWorkId, slots, updateSlot],
  );

  const onGenerateAllImages = useCallback(async () => {
    if (!slots.length) return;
    setError(null);
    for (let i = 0; i < slots.length; i += 1) {
      await onGeneratePair(i);
    }
  }, [onGeneratePair, slots]);

  const generatedCount = slots.filter((s) => s.questionPath && s.answerPath).length;
  const allImagesReady =
    slots.length > 0 &&
    generatedCount === slots.length &&
    !slots.some((s) => s.busy);

  const onExportAll = useCallback(async () => {
    setExporting(true);
    setError(null);
    setPublishInfo(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const { work, marked } = await publishDailyQuiz({
        workId: sessionWorkId,
        title: `每日一题 ${stamp}`,
        category: category.trim(),
        slots,
      });
      await exportDailyQuizZip(slots);
      setPublishInfo({ workId: work.id, marked });
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出发布失败");
    } finally {
      setExporting(false);
    }
  }, [category, sessionWorkId, slots]);

  return (
    <div className="mx-auto max-w-5xl">
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
          每日一题
        </h1>
      </header>

      <section className={`${ui.page} mb-6`}>
        <p className={`${ui.hint} mb-4`}>
          水墨底图答题卡 / 答案解析卡，程序排版（非 AI 生图）。从题库召回未使用过的题目，生成双图后导出即视为准备发布：题目将标记为已使用，并保存到创作中心作品列表。
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">分类筛选</span>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="留空表示全部分类"
              className={`${ui.input} mt-1 w-40`}
            />
          </label>
          <button
            type="button"
            disabled={recalling || slots.some((s) => s.busy)}
            onClick={() => void onRecallAll()}
            className={`${ui.buttonPrimary} bg-amber-500 hover:bg-amber-600 dark:bg-amber-500 dark:text-white dark:hover:bg-amber-600`}
          >
            {recalling ? "召回中…" : `召回 ${DAILY_QUIZ_SLOT_COUNT} 道题`}
          </button>
          {slots.length > 0 ? (
            <button
              type="button"
              disabled={recalling || slots.some((s) => s.busy)}
              onClick={() => void onGenerateAllImages()}
              className={ui.buttonSecondary}
            >
              一键生成全部
            </button>
          ) : null}
        </div>
        {slots.length > 0 ? (
          <p className={`${ui.hint} mt-3`}>
            已召回 {slots.length} 题 · 双图齐全 {generatedCount}/{slots.length}
          </p>
        ) : null}
      </section>

      {publishInfo ? (
        <p
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
          role="status"
        >
          已导出 ZIP，{publishInfo.marked} 道题已标记为已使用。
          <Link
            href={`/admin/creative-center/w/${publishInfo.workId}`}
            className="ml-1 font-medium underline hover:no-underline"
          >
            查看创作中心作品
          </Link>
          <span className="mx-1">·</span>
          <Link
            href="/admin/creative-center"
            className="font-medium underline hover:no-underline"
          >
            返回列表
          </Link>
        </p>
      ) : null}

      {error ? (
        <p className={`${ui.error} mb-4`} role="alert">
          {error}
        </p>
      ) : null}

      {slots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-12 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/20 dark:text-slate-400">
          点击「召回 {DAILY_QUIZ_SLOT_COUNT} 道题」从题库加载内容
        </p>
      ) : (
        <>
          <ul className="space-y-4 pb-4">
            {slots.map((slot, index) => (
              <SlotCard
                key={`${slot.question.id}-${index}`}
                index={index}
                slot={slot}
                onGenerate={() => void onGeneratePair(index)}
                onReroll={() => void onRerollSlot(index)}
                onPreview={setPreviewImage}
              />
            ))}
          </ul>
          {allImagesReady ? (
            <footer className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:-mx-0 sm:rounded-xl sm:border sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={`${ui.hint} m-0`}>
                  全部 {slots.length} 题双图已就绪。导出将下载 ZIP，并标记题目已使用、保存至创作中心。
                </p>
                <button
                  type="button"
                  disabled={exporting || slots.some((s) => s.busy)}
                  onClick={() => void onExportAll()}
                  className={`${ui.buttonPrimary} bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-700`}
                >
                  {exporting ? "导出并发布中…" : "导出并发布"}
                </button>
              </div>
            </footer>
          ) : null}
        </>
      )}
      <QuizImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}

function SlotCard({
  index,
  slot,
  onGenerate,
  onReroll,
  onPreview,
}: {
  index: number;
  slot: DailyQuizSlot;
  onGenerate: () => void;
  onReroll: () => void;
  onPreview: (image: QuizPreviewImage) => void;
}) {
  const { question, questionPath, answerPath, imageVersion, busy } = slot;
  const disabled = busy !== null;
  const hasImages = Boolean(questionPath && answerPath);

  return (
    <li className={ui.page}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              第 {index + 1} 题
            </span>
            {question.category ? (
              <span className={ui.badge}>{question.category}</span>
            ) : null}
            {question.header ? (
              <span className={ui.badge}>{question.header}</span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-slate-800 dark:text-slate-200">{question.stem}</p>
          <ul className={`mt-2 ${ui.hint}`}>
            {question.options.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            答案：{formatAnswerDisplay(question.answer, question.options)}
          </p>
          {question.explanation ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
              解析：{question.explanation}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onGenerate}
          className={`${ui.buttonPrimary} bg-amber-500 hover:bg-amber-600 dark:bg-amber-500 dark:text-white dark:hover:bg-amber-600`}
        >
          {busy === "generating"
            ? "生成中…"
            : hasImages
              ? "重新生成双图"
              : "生成答题卡与解析图"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onReroll}
          className={ui.buttonSecondary}
        >
          {busy === "reroll" ? "召回中…" : "重新召回"}
        </button>
      </div>

      {questionPath || answerPath ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {questionPath ? (
            <QuizCardThumbnail
              src={toQuizImageDisplayUrl(questionPath, imageVersion)}
              alt={`第 ${index + 1} 题题目卡`}
              label="题目卡"
              onPreview={() =>
                onPreview({
                  src: toQuizImageDisplayUrl(questionPath, imageVersion),
                  alt: `第 ${index + 1} 题题目卡`,
                })
              }
            />
          ) : null}
          {answerPath ? (
            <QuizCardThumbnail
              src={toQuizImageDisplayUrl(answerPath, imageVersion)}
              alt={`第 ${index + 1} 题答案卡`}
              label="答案解析卡"
              onPreview={() =>
                onPreview({
                  src: toQuizImageDisplayUrl(answerPath, imageVersion),
                  alt: `第 ${index + 1} 题答案卡`,
                })
              }
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
