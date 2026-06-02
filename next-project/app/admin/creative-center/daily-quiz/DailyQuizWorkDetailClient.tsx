"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getQuestionBankItem,
  type QuestionBankItem,
} from "@/app/admin/question-bank/questionBankClient";
import { formatRealExamSummary } from "@/app/admin/question-bank/realExam";
import {
  formatAnswerDisplay,
  optionsToText,
  quizQuestionCardStem,
} from "./dailyQuizHelpers";
import {
  mergeSlotsWithRefQuestionIds,
  parseDailyQuizBody,
} from "./parseDailyQuizBody";
import {
  CreativeWork,
  getWork,
  PLATFORM_META,
} from "../workStorage";

function formatTime(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SlotView = {
  index: number;
  questionId: string;
  stemFallback: string;
  optionsFallback: string[];
  answerFallback: string;
  explanationFallback: string;
  question: QuestionBankItem | null;
  loadError: string | null;
};

function metaRow(label: string, value: string) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-slate-900 dark:text-slate-100">{value || "—"}</dd>
    </div>
  );
}

export default function DailyQuizWorkDetailClient() {
  const params = useParams();
  const workId = params.workId as string;

  const [work, setWork] = useState<CreativeWork | null>(null);
  const [slots, setSlots] = useState<SlotView[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const parsed = useMemo(
    () => parseDailyQuizBody(work?.body ?? ""),
    [work?.body],
  );

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
          setLoadError("作品不存在");
          setHydrated(true);
          return;
        }
        setWork(w);
        const refPaths = [
          w.coverPath ?? "",
          ...(w.coverRefUrls ?? []),
        ];
        const bodySlots = mergeSlotsWithRefQuestionIds(
          parseDailyQuizBody(w.body).slots,
          refPaths,
        );
        const initial: SlotView[] = bodySlots.map((s) => ({
          index: s.index,
          questionId: s.questionId,
          stemFallback: s.stem,
          optionsFallback: s.options,
          answerFallback: s.answer,
          explanationFallback: s.explanation,
          question: null,
          loadError: null,
        }));
        setSlots(initial);

        await Promise.all(
          initial.map(async (slot, i) => {
            if (!slot.questionId) return;
            try {
              const item = await getQuestionBankItem(slot.questionId);
              if (cancelled) return;
              setSlots((prev) =>
                prev.map((row, idx) =>
                  idx === i ? { ...row, question: item, loadError: null } : row,
                ),
              );
            } catch (e) {
              if (cancelled) return;
              const msg = e instanceof Error ? e.message : "题目加载失败";
              setSlots((prev) =>
                prev.map((row, idx) =>
                  idx === i ? { ...row, loadError: msg } : row,
                ),
              );
            }
          }),
        );
      } catch (e) {
        if (!cancelled) {
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
  }, [workId]);

  if (!hydrated) {
    return <div className="text-sm text-slate-500 dark:text-slate-400">加载中…</div>;
  }

  if (loadError || !work) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400">
        {loadError ?? "无法加载作品。"}{" "}
        <Link
          href="/admin/creative-center"
          className="font-medium text-slate-700 underline dark:text-slate-300"
        >
          返回创作中心
        </Link>
      </div>
    );
  }

  const platform = PLATFORM_META[work.platform];

  return (
    <div className="mx-auto max-w-3xl">
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
          每日一题 · 详情
        </h1>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${platform.chipClass}`}
        >
          {platform.label}
        </span>
        <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
          已定稿
        </span>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/40">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">作品信息</h2>
        <dl className="mt-4 space-y-2.5">
          {metaRow("标题", work.title.trim() || "未命名")}
          {metaRow("创建时间", formatTime(work.createdAt))}
          {metaRow("更新时间", formatTime(work.updatedAt))}
          {metaRow("分类", work.domain.trim())}
          {metaRow("题目数", String(parsed.slots.length || slots.length))}
        </dl>
        {parsed.summary ? (
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{parsed.summary}</p>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
          引用题目
        </h2>
        {slots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800">
            未解析到题目内容
          </p>
        ) : (
          <ol className="space-y-4">
            {slots.map((slot) => (
              <li
                key={`${slot.index}-${slot.questionId || slot.stemFallback}`}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40"
              >
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  第 {slot.index} 题
                  {slot.questionId ? (
                    <span className="ml-2 font-normal text-slate-400">ID {slot.questionId}</span>
                  ) : null}
                </p>

                {slot.loadError ? (
                  <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{slot.loadError}</p>
                ) : null}

                {slot.question ? (
                  <QuestionBlock item={slot.question} />
                ) : (
                  <FallbackQuestionBlock
                    stem={slot.stemFallback}
                    options={slot.optionsFallback}
                    answer={slot.answerFallback}
                    explanation={slot.explanationFallback}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function FallbackQuestionBlock({
  stem,
  options,
  answer,
  explanation,
}: {
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
}) {
  const optionsText = optionsToText(options);
  const answerLine = formatAnswerDisplay(answer, options);

  return (
    <div className="mt-3 space-y-3 text-sm text-slate-800 dark:text-slate-200">
      <p className="whitespace-pre-wrap leading-relaxed">{stem || "（无题干）"}</p>
      {optionsText ? (
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
          {optionsText}
        </pre>
      ) : null}
      <p>
        <span className="font-medium text-slate-600 dark:text-slate-400">答案：</span>
        {answerLine || "—"}
      </p>
      {explanation.trim() ? (
        <p className="whitespace-pre-wrap leading-relaxed text-slate-600 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">解析：</span>
          {explanation.trim()}
        </p>
      ) : null}
    </div>
  );
}

function QuestionBlock({ item }: { item: QuestionBankItem }) {
  const stem = quizQuestionCardStem(item);
  const optionsText = optionsToText(item.options);
  const answerLine = formatAnswerDisplay(item.answer, item.options);
  const exam =
    item.isRealExam && item.examKind
      ? formatRealExamSummary(item.examYear ?? "", item.examRegion ?? "", item.examKind)
      : "";

  return (
    <div className="mt-3 space-y-3 text-sm text-slate-800 dark:text-slate-200">
      <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
        {item.category ? <span>{item.category}</span> : null}
        {item.header ? <span>{item.header}</span> : null}
        {item.subjectDomain ? <span>{item.subjectDomain}</span> : null}
        {exam ? <span>{exam}</span> : null}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed">{stem}</p>
      {optionsText ? (
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
          {optionsText}
        </pre>
      ) : null}
      <p>
        <span className="font-medium text-slate-600 dark:text-slate-400">答案：</span>
        {answerLine || item.answer.trim() || "—"}
      </p>
      {item.explanation.trim() ? (
        <p className="whitespace-pre-wrap leading-relaxed text-slate-600 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">解析：</span>
          {item.explanation.trim()}
        </p>
      ) : null}
      {item.extraText?.trim() ? (
        <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-400">
          {item.extraTitle?.trim() ? (
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {item.extraTitle.trim()}：
            </span>
          ) : null}
          {item.extraText.trim()}
        </p>
      ) : null}
    </div>
  );
}
