"use client";

import { useRef } from "react";
import { adminFormStyles as ui } from "../components/formStyles";

const DOCX_ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type ImportFileFieldProps = {
  label: string;
  disabled?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
};

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeFiles(existing: File[], incoming: File[]): File[] {
  const map = new Map<string, File>();
  for (const file of [...existing, ...incoming]) {
    map.set(fileKey(file), file);
  }
  return Array.from(map.values());
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImportFileField({
  label,
  disabled,
  files,
  onChange,
}: ImportFileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePick = (next: FileList | null) => {
    if (!next?.length) return;
    onChange(mergeFiles(files, Array.from(next)));
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    onChange([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="w-full space-y-2 text-sm text-slate-700 dark:text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`${ui.hint} ${ui.toolbarLabel}`}>{label}</span>
        {files.length > 0 ? (
          <button
            type="button"
            disabled={disabled}
            className="text-xs text-rose-600 hover:text-rose-500 dark:text-rose-400"
            onClick={clearAll}
          >
            清空全部
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={DOCX_ACCEPT}
        multiple
        disabled={disabled}
        className="hidden"
        onChange={(e) => handlePick(e.target.files)}
      />

      <div
        className={`rounded-xl border border-dashed p-3 ${
          files.length
            ? "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-950/40"
            : "border-slate-300 bg-slate-50/80 dark:border-slate-600 dark:bg-slate-900/40"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            className={`${ui.buttonSecondary} shrink-0 text-xs`}
            onClick={() => inputRef.current?.click()}
          >
            选择文件
          </button>
          <span className={ui.hint}>
            {files.length
              ? `已选 ${files.length} 个文件，可继续添加`
              : "支持多选 .docx，按选择顺序合并"}
          </span>
        </div>

        {files.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {files.map((file, index) => (
              <li
                key={fileKey(file)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60"
              >
                <span className={`${ui.badge} shrink-0 tabular-nums`}>{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm text-slate-800 dark:text-slate-100"
                    title={file.name}
                  >
                    {file.name}
                  </p>
                  <p className={ui.hint}>{formatFileSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`移除 ${file.name}`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  onClick={() => removeFile(index)}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
