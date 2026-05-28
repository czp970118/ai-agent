"use client";

import { KeyboardEvent, useState } from "react";
import { adminFormStyles as ui } from "../components/formStyles";

type TagInputProps = {
  label: string;
  hint?: string;
  tags: string[];
  disabled?: boolean;
  placeholder?: string;
  layout?: "default" | "toolbar";
  onChange: (tags: string[]) => void;
};

function normalizeInput(raw: string): string[] {
  return raw
    .replace(/，/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function TagInput({
  label,
  hint,
  tags,
  disabled,
  placeholder = "输入标签后按 Enter 添加",
  layout = "default",
  onChange,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const addTags = (raw: string) => {
    const next = [...tags];
    for (const tag of normalizeInput(raw)) {
      if (!next.includes(tag)) next.push(tag);
    }
    if (next.length !== tags.length) onChange(next);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draft.trim()) addTags(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  const isToolbar = layout === "toolbar";

  return (
    <div className={isToolbar ? "grid w-full gap-1" : "space-y-1"}>
      {isToolbar ? (
        <span className={`${ui.hint} ${ui.toolbarLabel}`}>{label}</span>
      ) : (
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</p>
      )}
      <div
        className={`${ui.inputControl} min-h-10 flex-wrap items-center gap-1.5 py-1.5 ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              aria-label={`移除标签 ${tag}`}
              className="rounded px-0.5 text-sky-500 hover:text-sky-700 dark:hover:text-sky-200"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          placeholder={tags.length ? "继续添加…" : placeholder}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) addTags(draft);
          }}
        />
      </div>
      {hint ? <p className={ui.hint}>{hint}</p> : null}
    </div>
  );
}
