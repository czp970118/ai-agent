"use client";

import { adminFormStyles as ui } from "../components/formStyles";

const DOCX_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type ImportFileFieldProps = {
  label: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
};

export default function ImportFileField({
  label,
  disabled,
  onChange,
}: ImportFileFieldProps) {
  return (
    <label className="grid min-w-[14rem] flex-1 gap-1 text-sm text-slate-700 dark:text-slate-200">
      <span className={`${ui.hint} ${ui.toolbarLabel}`}>{label}</span>
      <div className={`${ui.inputControl} ${ui.toolbarControl} gap-2`}>
        <input
          type="file"
          accept={DOCX_ACCEPT}
          disabled={disabled}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-slate-700 dark:file:bg-slate-800 dark:file:text-slate-200"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
      </div>
    </label>
  );
}
