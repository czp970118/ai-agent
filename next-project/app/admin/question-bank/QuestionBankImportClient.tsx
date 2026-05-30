"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";
import CategorySelect from "./CategorySelect";
import RealExamFields from "./RealExamFields";
import ConfirmAlertDialog from "./ConfirmAlertDialog";
import ImportFileField from "./ImportFileField";
import TagInput from "./TagInput";
import {
  formatRealExamSummary,
  questionHasRealExamMeta,
  realExamKindNeedsRegion,
  realExamKindsLabel,
} from "./realExam";
import {
  confirmQuestionImport,
  fetchExtractedText,
  fetchQuestionImportConfig,
  parseQuestionImport,
  pasteQuestionExtract,
  patchImportItem,
  reparseImport,
  uploadQuestionExtract,
  type QuestionImportConfig,
  type QuestionImportItem,
  type QuestionImportMeta,
} from "./questionBankClient";

const CATEGORIES = ["公基", "行测", "时政", "面试", "未分类"];

type ImportMode = "upload" | "paste";

type PendingConfirm =
  | { kind: "parse" }
  | { kind: "reparse" }
  | { kind: "confirm"; count: number };

function optionsToText(opts: string[]): string {
  return opts.join("\n");
}

function textToOptions(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function validateImportFiles(
  selected: File[],
  allowedExts: string[],
  maxBytes: number,
): string | null {
  for (const file of selected) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!allowedExts.includes(ext)) {
      return `「${file.name}」仅支持 .docx`;
    }
    if (file.size > maxBytes) {
      return `「${file.name}」超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`;
    }
  }
  return null;
}

export default function QuestionBankImportClient() {
  const router = useRouter();
  const [importMode, setImportMode] = useState<ImportMode>("upload");
  const [category, setCategory] = useState("公基");
  const [files, setFiles] = useState<File[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [importMeta, setImportMeta] = useState<QuestionImportMeta | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [questionFormat, setQuestionFormat] = useState("");
  const [answerFormat, setAnswerFormat] = useState("");
  const [questionCharCount, setQuestionCharCount] = useState(0);
  const [answerCharCount, setAnswerCharCount] = useState(0);
  const [questionTruncated, setQuestionTruncated] = useState(false);
  const [answerTruncated, setAnswerTruncated] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [estimatedLlmCalls, setEstimatedLlmCalls] = useState(0);
  const [items, setItems] = useState<QuestionImportItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<QuestionImportItem>>({});
  const [importConfig, setImportConfig] = useState<QuestionImportConfig | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [importTags, setImportTags] = useState<string[]>([]);
  const [importIsRealExam, setImportIsRealExam] = useState(false);
  const [importExamKind, setImportExamKind] = useState("");
  const [importExamYear, setImportExamYear] = useState("");
  const [importExamRegion, setImportExamRegion] = useState("");

  useEffect(() => {
    fetchQuestionImportConfig()
      .then(setImportConfig)
      .catch(() =>
        setImportConfig({
          allowedExtensions: [".docx"],
          maxUploadBytes: 20 * 1024 * 1024,
          hint: "仅支持 .docx",
        }),
      );
  }, []);

  const allowedExts = importConfig?.allowedExtensions ?? [".docx"];

  const hasExtracted = importMeta?.status === "text_extracted";
  const hasParsed = items.length > 0 || importMeta?.status === "parsed" || importMeta?.status === "parse_failed";

  const selectedCount = useMemo(
    () => items.filter((it) => it.selected).length,
    [items],
  );

  const showAnswerPreview = answerText.length > 0 || answerCharCount > 0;
  const hasExtractedText = questionCharCount > 0 || answerCharCount > 0;
  const canParse = hasExtracted && hasExtractedText && !uploading && !parsing;
  const canSubmitUpload = files.length > 0;
  const canSubmitPaste = pasteText.trim().length > 0;
  const canSubmit = importMode === "upload" ? canSubmitUpload : canSubmitPaste;
  const canConfirm =
    importMeta?.status === "parsed" && selectedCount > 0 && !uploading && !parsing && !confirming;

  const applyExtractPreview = (res: Record<string, unknown>) => {
    const legacy = String(res.extractedText ?? "");
    const qText = String(res.questionText ?? res.question_text ?? legacy);
    const aText = String(res.answerText ?? res.answer_text ?? "");
    setQuestionText(qText);
    setAnswerText(aText);
    setQuestionCharCount(Number(res.questionCharCount ?? res.question_char_count ?? qText.length) || 0);
    setAnswerCharCount(Number(res.answerCharCount ?? res.answer_char_count ?? aText.length) || 0);
    setQuestionTruncated(Boolean(res.questionTruncated ?? res.question_truncated));
    setAnswerTruncated(Boolean(res.answerTruncated ?? res.answer_truncated));
    setQuestionFormat(String(res.questionFormat ?? res.question_format ?? ""));
    setAnswerFormat(String(res.answerFormat ?? res.answer_format ?? ""));
    setCharCount(Number(res.charCount ?? res.char_count) || 0);
    setEstimatedLlmCalls(Number(res.estimatedLlmCalls ?? res.estimated_llm_calls) || 0);
  };

  const resetBatch = () => {
    setImportMeta(null);
    setQuestionText("");
    setAnswerText("");
    setQuestionFormat("");
    setAnswerFormat("");
    setQuestionCharCount(0);
    setAnswerCharCount(0);
    setQuestionTruncated(false);
    setAnswerTruncated(false);
    setCharCount(0);
    setEstimatedLlmCalls(0);
    setItems([]);
    setWarnings([]);
    setImportTags([]);
    setImportIsRealExam(false);
    setImportExamKind("");
    setImportExamYear("");
    setImportExamRegion("");
    setEditingId(null);
    setEditDraft({});
  };

  const startNewImport = () => {
    resetBatch();
    setPasteText("");
    setFiles([]);
    setSuccessMessage("");
    setError("");
  };

  const handleSubmitContent = useCallback(async () => {
    if (importMode === "upload") {
      if (!files.length) {
        setError("请至少选择一个 .docx 文件");
        return;
      }
      const maxBytes = importConfig?.maxUploadBytes ?? 20 * 1024 * 1024;
      const err = validateImportFiles(files, allowedExts, maxBytes);
      if (err) {
        setError(err);
        return;
      }
    } else if (!pasteText.trim()) {
      setError("请粘贴文案内容");
      return;
    }

    setUploading(true);
    setError("");
    resetBatch();
    try {
      const res =
        importMode === "upload"
          ? await uploadQuestionExtract(files, category)
          : await pasteQuestionExtract({
              category,
              text: pasteText,
            });
      setImportMeta(res.import);
      applyExtractPreview(res as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : importMode === "upload" ? "提取失败" : "提交失败");
    } finally {
      setUploading(false);
    }
  }, [
    importMode,
    files,
    category,
    pasteText,
    allowedExts,
    importConfig?.maxUploadBytes,
  ]);

  const runParse = useCallback(async () => {
    if (!importMeta?.id) return;
    setParsing(true);
    setError("");
    setItems([]);
    setWarnings([]);
    try {
      const res = await parseQuestionImport(importMeta.id);
      setImportMeta(res.import);
      setItems(res.items || []);
      setWarnings(res.warnings || []);
      if (!res.ok && res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 结构化失败");
    } finally {
      setParsing(false);
    }
  }, [importMeta?.id]);

  const runReparse = useCallback(async () => {
    if (!importMeta?.id) return;
    setParsing(true);
    setError("");
    try {
      const res = await reparseImport(importMeta.id);
      setImportMeta(res.import);
      setItems(res.items || []);
      setWarnings(res.warnings || []);
      if (!res.ok && res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新结构化失败");
    } finally {
      setParsing(false);
    }
  }, [importMeta?.id]);

  const handleParse = () => {
    setPendingConfirm({ kind: "parse" });
  };

  const handleReparse = () => {
    setPendingConfirm({ kind: "reparse" });
  };

  const handleReloadText = useCallback(async () => {
    if (!importMeta?.id) return;
    setUploading(true);
    setError("");
    try {
      const res = await fetchExtractedText(importMeta.id);
      applyExtractPreview(res as unknown as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载全文失败");
    } finally {
      setUploading(false);
    }
  }, [importMeta?.id]);

  const toggleSelected = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, selected: !it.selected } : it)),
    );
  };

  const startEdit = (it: QuestionImportItem) => {
    setEditingId(it.id);
    setEditDraft({
      header: it.header,
      stem: it.stem,
      options: it.options,
      answer: it.answer,
      explanation: it.explanation,
      extraTitle: it.extraTitle,
      extraText: it.extraText,
      category: it.category,
      subjectDomain: it.subjectDomain,
    });
  };

  const saveEdit = async () => {
    if (!importMeta?.id || !editingId) return;
    setError("");
    try {
      const opts = editDraft.options
        ? Array.isArray(editDraft.options)
          ? editDraft.options
          : textToOptions(String(editDraft.options))
        : undefined;
      const item = await patchImportItem(importMeta.id, editingId, {
        ...editDraft,
        options: opts,
      });
      setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
      setEditingId(null);
      setEditDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  const runConfirm = async () => {
    if (!importMeta?.id) return;
    const selected = items.filter((it) => it.selected);
    if (!selected.length) {
      setError("请至少勾选一道题");
      return;
    }
    setConfirming(true);
    setError("");
    try {
      const res = await confirmQuestionImport(importMeta.id, selected.map((it) => it.id), {
        tags: importTags,
        isRealExam: importIsRealExam,
        examYear: importExamYear.trim(),
        examRegion: importExamRegion.trim(),
        examKind: importExamKind,
      });
      const examSummary = importIsRealExam
        ? formatRealExamSummary(importExamYear.trim(), importExamRegion.trim(), importExamKind)
        : "";
      setSuccessMessage(
        `成功入库 ${res.inserted} 题${
          res.skippedDuplicates ? `，跳过重复 ${res.skippedDuplicates} 题` : ""
        }${examSummary ? `，${examSummary}` : ""}${
          importTags.length ? `，标签：${importTags.join("、")}` : ""
        }`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认入库失败");
    } finally {
      setConfirming(false);
    }
  };

  const handleConfirm = () => {
    const selected = items.filter((it) => it.selected);
    if (!selected.length) {
      setError("请至少勾选一道题");
      return;
    }
    if (importIsRealExam) {
      if (!importExamKind) {
        setError(`真题须选择考试类型：${realExamKindsLabel()}`);
        return;
      }
      if (!importExamYear.trim()) {
        setError("真题须填写年份");
        return;
      }
      if (realExamKindNeedsRegion(importExamKind) && !importExamRegion.trim()) {
        setError(`${importExamKind}须填写省份`);
        return;
      }
    }
    setPendingConfirm({ kind: "confirm", count: selected.length });
  };

  const confirmDialogProps = useMemo(() => {
    if (!pendingConfirm) return null;
    if (pendingConfirm.kind === "parse") {
      return {
        title: "开始 AI 结构化",
        message:
          estimatedLlmCalls <= 1
            ? "将把题目卷与答案卷合并全文发给 DeepSeek 做结构化。是否继续？"
            : `将调用 DeepSeek 约 ${estimatedLlmCalls} 次，把文字结构化为题目。是否继续？`,
        confirmLabel: "继续",
        status: "warning" as const,
      };
    }
    if (pendingConfirm.kind === "reparse") {
      return {
        title: "重新 AI 结构化",
        message:
          estimatedLlmCalls <= 1
            ? "将重新把合并全文发给 DeepSeek 结构化。是否继续？"
            : `将重新调用 DeepSeek 约 ${estimatedLlmCalls} 次。是否继续？`,
        confirmLabel: "继续",
        status: "warning" as const,
      };
    }
    return {
      title: "确认入库",
      message: `确认将 ${pendingConfirm.count} 道题入库？`,
      confirmLabel: "确认入库",
      status: "accent" as const,
    };
  }, [pendingConfirm, estimatedLlmCalls]);

  const handleConfirmDialogAction = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm;
    setPendingConfirm(null);
    if (action.kind === "parse") {
      await runParse();
    } else if (action.kind === "reparse") {
      await runReparse();
    } else {
      await runConfirm();
    }
  };

  const submitLabel =
    importMode === "upload"
      ? uploading
        ? "提取中…"
        : "上传并提取文字"
      : uploading
        ? "提交中…"
        : "提交文案";

  return (
    <div className={ui.page}>
      <div className="mb-4">
        <Link href="/admin/question-bank" className={`${ui.hint} hover:underline`}>
          ← 返回题库列表
        </Link>
        <h1 className={`${ui.title} mt-2`}>导入题库</h1>
        <p className={`mt-1 ${ui.hint}`}>
          {importConfig?.hint || "加载配置中…"}
        </p>
      </div>

      <section className={`${ui.panel} mb-6 space-y-4`}>
        <p className={ui.sectionTitle}>1. 导入内容</p>

        <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
          {(
            [
              ["upload", "上传文件"],
              ["paste", "粘贴文案"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={uploading || parsing}
              className={
                importMode === mode
                  ? `${ui.buttonPrimary} rounded-md px-3 py-1.5 text-sm`
                  : `${ui.buttonSecondary} border-0 bg-transparent px-3 py-1.5 text-sm shadow-none hover:bg-slate-100 dark:hover:bg-slate-800`
              }
              onClick={() => {
                setImportMode(mode);
                setError("");
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={`${ui.panel} space-y-3`}>
          <p className={ui.sectionTitle}>真题配置</p>
          <label
            className={`flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200 ${
              uploading || parsing ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={importIsRealExam}
              disabled={uploading || parsing}
              onChange={(e) => {
                const checked = e.target.checked;
                setImportIsRealExam(checked);
                if (!checked) {
                  setImportExamKind("");
                  setImportExamYear("");
                  setImportExamRegion("");
                }
              }}
            />
            <span>本批为真题</span>
          </label>
          {importIsRealExam ? (
            <RealExamFields
              examKind={importExamKind}
              examYear={importExamYear}
              examRegion={importExamRegion}
              disabled={uploading || parsing}
              onExamKindChange={setImportExamKind}
              onExamYearChange={setImportExamYear}
              onExamRegionChange={setImportExamRegion}
            />
          ) : (
            <p className={`${ui.hint} m-0`}>
              未开启时，若粘贴内容含「📌真题来源」行，解析后仍会按每题来源自动标注真题并入库；无来源行则按普通题入库。
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <CategorySelect
            label="默认分类"
            aria-label="默认分类"
            value={category}
            onChange={setCategory}
            disabled={uploading || parsing}
            options={CATEGORIES.map((c) => ({ id: c, label: c }))}
          />

          <button
            type="button"
            className={`${ui.buttonPrimary} ${ui.controlH} shrink-0 self-end`}
            disabled={uploading || parsing || !canSubmit}
            onClick={() => void handleSubmitContent()}
          >
            {submitLabel}
          </button>
        </div>

        {importMode === "upload" ? (
          <ImportFileField
            label="选择 .docx 文件（可多选）"
            disabled={uploading || parsing}
            files={files}
            onChange={setFiles}
          />
        ) : null}

        {importMode === "paste" ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">粘贴内容</p>
            <textarea
              className={`${ui.textarea} min-h-[16rem] font-mono text-xs leading-relaxed`}
              disabled={uploading || parsing}
              placeholder="在此粘贴题目、选项、答案或解析等完整文案…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
          </div>
        ) : null}

        {importMeta ? (
          <p className={ui.hint}>
            批次 {importMeta.id.slice(0, 8)}… · 状态 {importMeta.status} · {importMeta.filename}
            {charCount > 0 ? ` · 共 ${charCount.toLocaleString()} 字` : ""}
            {estimatedLlmCalls > 1 ? ` · 预计 DeepSeek ${estimatedLlmCalls} 次` : ""}
            {answerCharCount > 0 ? " · 已合并题目卷+解析卷" : ""}
          </p>
        ) : null}

        <p className={ui.hint}>
          {importMode === "upload"
            ? "可一次选择多个 .docx，系统将按顺序合并内容；若恰好 2 个文件，则第一个为题目卷、第二个为解析卷。超长卷会自动分批调用 DeepSeek。"
            : "将完整文案粘贴到文本框，提交后可直接进行 AI 结构化。"}
        </p>

        {importMeta?.extractError ? (
          <p className={ui.error}>提取失败：{importMeta.extractError}</p>
        ) : null}
      </section>

      {hasExtracted ? (
        <section className={`${ui.panel} mb-6 space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={ui.sectionTitle}>2. 提取结果预览（未调用 AI）</p>
            <div className="flex flex-wrap gap-2">
              {questionTruncated || answerTruncated ? (
                <button
                  type="button"
                  className={ui.buttonSecondary}
                  disabled={uploading}
                  onClick={() => void handleReloadText()}
                >
                  刷新预览
                </button>
              ) : null}
              <button
                type="button"
                className={ui.buttonPrimary}
                disabled={!canParse}
                onClick={handleParse}
              >
                {parsing
                  ? "AI 结构化中…"
                  : estimatedLlmCalls <= 1
                    ? "开始 AI 结构化"
                    : `开始 AI 结构化（约 ${estimatedLlmCalls} 次）`}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                题目卷
                {questionFormat ? (
                  <span className={`ml-2 ${ui.badge}`}>{questionFormat.replace(".", "").toUpperCase()}</span>
                ) : null}
              </p>
              <span className={ui.hint}>{questionCharCount.toLocaleString()} 字</span>
            </div>
            {questionTruncated ? (
              <p className={ui.hint}>题目卷仅展示前 {questionText.length.toLocaleString()} 字；AI 结构化使用完整文本。</p>
            ) : null}
            <textarea
              className={`${ui.textarea} max-h-[22rem] min-h-[10rem] font-mono text-xs leading-relaxed`}
              readOnly
              placeholder={
                questionCharCount > 0
                  ? undefined
                  : answerCharCount > 0
                    ? "（未上传题目卷）"
                    : "（未提取到文字，请检查 docx 内容）"
              }
              value={questionText}
            />
          </div>

          {showAnswerPreview ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  答案/解析卷
                  {answerFormat ? (
                    <span className={`ml-2 ${ui.badge}`}>{answerFormat.replace(".", "").toUpperCase()}</span>
                  ) : null}
                </p>
                <span className={ui.hint}>{answerCharCount.toLocaleString()} 字</span>
              </div>
              {answerTruncated ? (
                <p className={ui.hint}>答案卷仅展示前 {answerText.length.toLocaleString()} 字；AI 结构化使用完整文本。</p>
              ) : null}
              <textarea
                className={`${ui.textarea} max-h-[22rem] min-h-[10rem] font-mono text-xs leading-relaxed`}
                readOnly
                value={answerText}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {importMeta?.parseError ? (
        <p className={`${ui.error} mb-4`}>AI 结构化失败：{importMeta.parseError}</p>
      ) : null}

      {warnings.length > 0 ? (
        <section className={`${ui.panel} mb-6`}>
          <p className={ui.sectionTitle}>结构化提示</p>
          <ul className={`list-disc pl-5 ${ui.hint}`}>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? <p className={`${ui.error} mb-4`}>{error}</p> : null}

      {hasParsed && items.length > 0 ? (
        <section className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className={ui.sectionTitle}>3. 题目预览并入库（已选 {selectedCount} / {items.length}）</p>
            <div className="flex gap-2">
              {importMeta?.status === "parse_failed" ? (
                <button
                  type="button"
                  className={ui.buttonSecondary}
                  disabled={parsing}
                  onClick={handleReparse}
                >
                  重新结构化
                </button>
              ) : null}
              <button
                type="button"
                className={ui.buttonPrimary}
                disabled={!canConfirm}
                onClick={handleConfirm}
              >
                {confirming ? "入库中…" : "确认入库"}
              </button>
            </div>
          </div>

          <TagInput
            label="入库标签（选填，可多选）"
            hint="例如：19年、国考。本次入库的题目将统一打上这些标签。"
            tags={importTags}
            disabled={confirming}
            onChange={setImportTags}
          />

          <div className="space-y-4">
            {items.map((it) => (
              <article
                key={it.id}
                className={`${ui.panel} ${it.selected ? "" : "opacity-60"}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={it.selected}
                    onChange={() => toggleSelected(it.id)}
                  />
                  <span className={ui.badge}>{it.category}</span>
                  {it.subjectDomain ? (
                    <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                      {it.subjectDomain}
                    </span>
                  ) : null}
                  {questionHasRealExamMeta(it) && it.examKind ? (
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      {formatRealExamSummary(
                        it.examYear ?? "",
                        it.examRegion ?? "",
                        it.examKind,
                      )}
                    </span>
                  ) : null}
                  <span className={ui.badge}>{it.header}</span>
                  <span className={ui.hint}>答案 {it.answer}</span>
                  {editingId !== it.id ? (
                    <button
                      type="button"
                      className={ui.buttonSecondary}
                      onClick={() => startEdit(it)}
                    >
                      编辑
                    </button>
                  ) : null}
                </div>

                {editingId === it.id ? (
                  <div className="space-y-2">
                    <input
                      className={`${ui.input} w-full`}
                      value={editDraft.header ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, header: e.target.value }))}
                    />
                    <input
                      className={`${ui.input} w-full`}
                      placeholder="领域，如：历史、地理"
                      value={editDraft.subjectDomain ?? ""}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, subjectDomain: e.target.value }))
                      }
                    />
                    <textarea
                      className={ui.textarea}
                      rows={3}
                      value={editDraft.stem ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, stem: e.target.value }))}
                    />
                    <textarea
                      className={ui.textarea}
                      rows={4}
                      value={
                        Array.isArray(editDraft.options)
                          ? optionsToText(editDraft.options)
                          : optionsToText(it.options)
                      }
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, options: textToOptions(e.target.value) }))
                      }
                    />
                    <input
                      className={ui.input}
                      value={editDraft.answer ?? ""}
                      onChange={(e) => setEditDraft((d) => ({ ...d, answer: e.target.value }))}
                    />
                    <textarea
                      className={ui.textarea}
                      rows={2}
                      value={editDraft.explanation ?? ""}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, explanation: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <button type="button" className={ui.buttonPrimary} onClick={() => void saveEdit()}>
                        保存
                      </button>
                      <button
                        type="button"
                        className={ui.buttonSecondary}
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft({});
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-slate-800 dark:text-slate-200">{it.stem}</p>
                    <ul className={`mt-2 ${ui.hint}`}>
                      {it.options.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                    {it.explanation ? (
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                        答案卡解析：{it.explanation}
                      </p>
                    ) : null}
                    {it.extraText ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-500 whitespace-pre-line">
                        {it.extraTitle || "拓展"}
                        {it.extraText}
                      </p>
                    ) : null}
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {hasParsed && items.length === 0 && importMeta?.status === "parse_failed" ? (
        <p className={ui.hint}>结构化未得到题目，可检查上方提取文字后点击「重新结构化」。</p>
      ) : null}

      {confirmDialogProps ? (
        <ConfirmAlertDialog
          open={pendingConfirm != null}
          title={confirmDialogProps.title}
          message={confirmDialogProps.message}
          confirmLabel={confirmDialogProps.confirmLabel}
          status={confirmDialogProps.status}
          busy={parsing || confirming}
          onOpenChange={(open) => {
            if (!open) setPendingConfirm(null);
          }}
          onConfirm={() => void handleConfirmDialogAction()}
        />
      ) : null}

      <ConfirmAlertDialog
        open={Boolean(successMessage)}
        title="入库成功"
        message={successMessage}
        confirmLabel="返回题库列表"
        cancelLabel="继续导入"
        status="success"
        onOpenChange={(open) => {
          if (!open) setSuccessMessage("");
        }}
        onCancel={startNewImport}
        onConfirm={() => {
          setSuccessMessage("");
          router.push("/admin/question-bank");
        }}
      />
    </div>
  );
}
