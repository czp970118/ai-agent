"use client";

import { adminFormStyles as ui } from "../components/formStyles";

type DialogStatus = "default" | "accent" | "success" | "warning" | "danger";

type ConfirmAlertDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
  status?: DialogStatus;
  busy?: boolean;
  hideCancel?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel?: () => void;
};

const STATUS_ICON: Record<DialogStatus, { ring: string; glyph: string }> = {
  default: {
    ring: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    glyph: "i",
  },
  accent: {
    ring: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
    glyph: "!",
  },
  success: {
    ring: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    glyph: "✓",
  },
  warning: {
    ring: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    glyph: "!",
  },
  danger: {
    ring: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
    glyph: "!",
  },
};

export default function ConfirmAlertDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  confirmClassName,
  status = "warning",
  busy = false,
  hideCancel = false,
  onOpenChange,
  onConfirm,
  onCancel,
}: ConfirmAlertDialogProps) {
  if (!open) return null;

  const icon = STATUS_ICON[status];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      onClick={() => {
        if (!busy) onOpenChange(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3 p-4 pb-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${icon.ring}`}
            aria-hidden
          >
            {icon.glyph}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p id="confirm-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </p>
            <p
              id="confirm-dialog-message"
              className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300"
            >
              {message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          {!hideCancel ? (
            <button
              type="button"
              className={ui.buttonSecondary}
              disabled={busy}
              onClick={() => {
                onCancel?.();
                onOpenChange(false);
              }}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={confirmClassName ?? ui.buttonPrimary}
            disabled={busy}
            onClick={() => onConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
