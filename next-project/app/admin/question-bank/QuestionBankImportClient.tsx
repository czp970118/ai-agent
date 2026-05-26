"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";
import CategorySelect from "./CategorySelect";
import ImportFileField from "./ImportFileField";
import {
  confirmQuestionImport,
  fetchExtractedText,
  fetchQuestionImportConfig,
  parseQuestionImport,
  patchImportItem,
  reparseImport,
  uploadQuestionExtract,
  type QuestionImportConfig,
  type QuestionImportItem,
  type QuestionImportMeta,
} from "./questionBankClient";

const CATEGORIES = ["公基", "行测", "时政", "面试", "未分类"];

function optionsToText(opts: string[]): string {
  return opts.join("\n");
}

function textToOptions(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export default function QuestionBankImportClient() {
  const router = useRouter();
  const [category, setCategory] = useState("公基");
  const [file, setFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [hasAnswerVolume, setHasAnswerVolume] = useState(false);
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

  console.log('items--->', items);

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
  const canUpload = Boolean(file || answerFile);
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
    setHasAnswerVolume(aText.length > 0 || Number(res.answerCharCount ?? res.answer_char_count) > 0);
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
    setHasAnswerVolume(false);
    setItems([]);
    setWarnings([]);
  };

  const handleExtract = useCallback(async () => {
    if (!file && !answerFile) {
      setError("请至少选择题目卷或答案/解析卷之一");
      return;
    }
    const maxBytes = importConfig?.maxUploadBytes ?? 20 * 1024 * 1024;
    const checkFile = (selected: File, label: string): string | null => {
      const ext = selected.name.toLowerCase().slice(selected.name.lastIndexOf("."));
      if (!allowedExts.includes(ext)) {
        return `${label}仅支持 .docx`;
      }
      if (selected.size > maxBytes) {
        return `${label}超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`;
      }
      return null;
    };
    if (file) {
      const err = checkFile(file, "题目卷");
      if (err) {
        setError(err);
        return;
      }
    }
    if (answerFile) {
      const err = checkFile(answerFile, "答案/解析卷");
      if (err) {
        setError(err);
        return;
      }
    }
    setUploading(true);
    setError("");
    resetBatch();
    try {
      const res = await uploadQuestionExtract(file, category, answerFile);
      setImportMeta(res.import);
      applyExtractPreview(res as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提取失败");
    } finally {
      setUploading(false);
    }
  }, [file, answerFile, category, allowedExts, importConfig?.maxUploadBytes]);

  const handleParse = useCallback(async () => {
    if (!importMeta?.id) return;
    if (
      !window.confirm(
        estimatedLlmCalls <= 1
          ? "将把题目卷与答案卷合并全文发给 DeepSeek 做结构化。是否继续？"
          : `将调用 DeepSeek 约 ${estimatedLlmCalls} 次，把文字结构化为题目。是否继续？`,
      )
    ) {
      return;
    }
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
  }, [importMeta?.id, estimatedLlmCalls]);

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

  const handleReparse = useCallback(async () => {
    if (!importMeta?.id) return;
    if (
      !window.confirm(
        estimatedLlmCalls <= 1
          ? "将重新把合并全文发给 DeepSeek 结构化。是否继续？"
          : `将重新调用 DeepSeek 约 ${estimatedLlmCalls} 次。是否继续？`,
      )
    ) {
      return;
    }
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
  }, [importMeta?.id, estimatedLlmCalls]);

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

  const handleConfirm = async () => {
    if (!importMeta?.id) return;
    const selected = items.filter((it) => it.selected);
    if (!selected.length) {
      setError("请至少勾选一道题");
      return;
    }
    if (!window.confirm(`确认将 ${selected.length} 道题入库？`)) return;
    setConfirming(true);
    setError("");
    try {
      const res = await confirmQuestionImport(
        importMeta.id,
        selected.map((it) => it.id),
      );
      alert(
        `成功入库 ${res.inserted} 题${
          res.skippedDuplicates ? `，跳过重复 ${res.skippedDuplicates} 题` : ""
        }`,
      );
      router.push("/admin/question-bank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "确认入库失败");
    } finally {
      setConfirming(false);
    }
  };

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
        <p className={ui.sectionTitle}>1. 上传并提取文字</p>
        <div className="flex flex-wrap items-end gap-3">
          <CategorySelect
            label="默认分类"
            aria-label="默认分类"
            value={category}
            onChange={setCategory}
            disabled={uploading || parsing}
            options={CATEGORIES.map((c) => ({ id: c, label: c }))}
          />
          <ImportFileField
            label="题目卷（选填）"
            disabled={uploading || parsing}
            onChange={setFile}
          />
          <ImportFileField
            label="答案/解析卷（选填）"
            disabled={uploading || parsing}
            onChange={setAnswerFile}
          />
          <button
            type="button"
            className={`${ui.buttonPrimary} ${ui.controlH} shrink-0 self-end`}
            disabled={uploading || parsing || !canUpload}
            onClick={() => void handleExtract()}
          >
            {uploading ? "提取中…" : "上传并提取文字"}
          </button>
        </div>
        {(file || answerFile) && !importMeta ? (
          <p className={ui.hint}>
            已选：{file ? `题目「${file.name}」` : "（未选题目卷）"}
            {file && answerFile ? "；" : ""}
            {answerFile ? `解析「${answerFile.name}」` : file ? "（未选解析卷）" : ""}
          </p>
        ) : null}
        {importMeta ? (
          <p className={ui.hint}>
            批次 {importMeta.id.slice(0, 8)}… · 状态 {importMeta.status} · {importMeta.filename}
            {charCount > 0 ? ` · 共 ${charCount.toLocaleString()} 字` : ""}
            {estimatedLlmCalls > 1 ? ` · 预计 DeepSeek ${estimatedLlmCalls} 次` : ""}
            {hasAnswerVolume ? " · 已合并题目卷+解析卷" : ""}
          </p>
        ) : null}
        <p className={ui.hint}>
          题目卷与答案/解析卷至少上传其一，均为 .docx。超长卷会自动分批调用 DeepSeek（页面上会显示预计次数）。
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
                onClick={() => void handleParse()}
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
                  : hasAnswerVolume
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
                  onClick={() => void handleReparse()}
                >
                  重新结构化
                </button>
              ) : null}
              <button
                type="button"
                className={ui.buttonPrimary}
                disabled={!canConfirm}
                onClick={() => void handleConfirm()}
              >
                {confirming ? "入库中…" : "确认入库"}
              </button>
            </div>
          </div>

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
    </div>
  );
}
