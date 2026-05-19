"use client";

import { useEffect, useId, useRef, useState } from "react";

export type CoverSelectOption = {
  value: string;
  label: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: CoverSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

export default function CoverSelect({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "请选择",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const display = selected?.label ?? placeholder;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={rootRef} className={`relative mt-1 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm text-slate-900 shadow-sm transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-white dark:text-slate-900"
      >
        <span className="min-w-0 flex-1 truncate">{display}</span>
        <span
          className={`shrink-0 text-[10px] text-slate-400 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▼
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-[200] mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-white"
        >
          {options.map((opt) => {
            const on = opt.value === value;
            return (
              <li key={opt.value || "__empty"} role="option" aria-selected={on}>
                <button
                  type="button"
                  className={`flex w-full px-2.5 py-2 text-left text-xs leading-snug transition ${
                    on
                      ? "bg-rose-50 font-medium text-rose-800"
                      : "text-slate-800 hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  {on ? <span className="mr-1.5 text-rose-600">✓</span> : null}
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
