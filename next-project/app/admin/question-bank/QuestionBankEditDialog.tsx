"use client";

import { useEffect, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";
import CategorySelect from "./CategorySelect";
import TagInput from "./TagInput";
import {
  patchQuestionBank,
  type QuestionBankItem,
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

type QuestionBankEditDialogProps = {
  open: boolean;
  item: QuestionBankItem | null;
  busy?: boolean;
  onClose: () => void;
  onSaved: (item: QuestionBankItem) => void;
};

export default function QuestionBankEditDialog({
  open,
  item,
  busy = false,
  onClose,
  onSaved,
}: QuestionBankEditDialogProps) {
  const [header, setHeader] = useState("");
  const [stem, setStem] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [category, setCategory] = useState("公基");
  const [subjectDomain, setSubjectDomain] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setHeader(item.header || "");
    setStem(item.stem || "");
    setOptionsText(optionsToText(item.options || []));
    setAnswer(item.answer || "");
    setExplanation(item.explanation || "");
    setCategory(item.category || "公基");
    setSubjectDomain(item.subjectDomain || "");
    setTags(item.tags ?? []);
    setError("");
  }, [item]);

  if (!open || !item) return null;

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const updated = await patchQuestionBank(item.id, {
        header,
        stem,
        options: textToOptions(optionsText),
        answer,
        explanation,
        category,
        subjectDomain,
        tags,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <p className={ui.sectionTitle}>编辑题目</p>
          <button type="button" className={ui.buttonSecondary} disabled={saving || busy} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <CategorySelect
              label="分类"
              aria-label="分类"
              value={category}
              onChange={setCategory}
              disabled={saving}
              options={CATEGORIES.map((c) => ({ id: c, label: c }))}
            />
            <label className="grid gap-1 text-sm">
              <span className={ui.hint}>领域</span>
              <input
                className={ui.input}
                value={subjectDomain}
                disabled={saving}
                placeholder="如：历史、地理"
                onChange={(e) => setSubjectDomain(e.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className={ui.hint}>标题</span>
            <input
              className={ui.input}
              value={header}
              disabled={saving}
              onChange={(e) => setHeader(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className={ui.hint}>题干</span>
            <textarea
              className={ui.textarea}
              rows={3}
              value={stem}
              disabled={saving}
              onChange={(e) => setStem(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className={ui.hint}>选项（每行一个）</span>
            <textarea
              className={ui.textarea}
              rows={4}
              value={optionsText}
              disabled={saving}
              onChange={(e) => setOptionsText(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className={ui.hint}>答案</span>
            <input
              className={ui.input}
              value={answer}
              disabled={saving}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className={ui.hint}>解析</span>
            <textarea
              className={ui.textarea}
              rows={3}
              value={explanation}
              disabled={saving}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </label>
          <TagInput
            label="标签"
            tags={tags}
            disabled={saving}
            onChange={setTags}
          />
          {error ? <p className={ui.error}>{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button type="button" className={ui.buttonSecondary} disabled={saving} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={ui.buttonPrimary}
            disabled={saving || busy}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
