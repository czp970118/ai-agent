"use client";

import { useEffect } from "react";

export type QuizPreviewImage = { src: string; alt: string };

function MagnifyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path d="M8.5 3a5.5 5.5 0 1 0 3.895 9.395l3.083 3.083a1 1 0 0 0 1.415-1.414l-3.083-3.083A5.5 5.5 0 0 0 8.5 3Zm-3.5 5.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z" />
    </svg>
  );
}

export function QuizImagePreviewModal({
  image,
  onClose,
}: {
  image: QuizPreviewImage | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image, onClose]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25"
        onClick={onClose}
      >
        关闭
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.alt}
        className="max-h-[95vh] max-w-[95vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function QuizCardThumbnail({
  src,
  alt,
  label,
  onPreview,
}: {
  src: string;
  alt: string;
  label: string;
  onPreview: () => void;
}) {
  return (
    <figure className="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/40">
      <figcaption className="mb-1 text-[11px] text-slate-500">{label}</figcaption>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="mx-auto max-h-64 w-full cursor-zoom-in rounded object-contain"
          onClick={onPreview}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
          className="absolute right-2 bottom-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-black/75"
          aria-label={`放大查看${label}`}
        >
          <MagnifyIcon />
          放大
        </button>
      </div>
    </figure>
  );
}
