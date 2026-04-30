import React from "react";
import { Button, Input } from "@heroui/react";
import type { AgentUiConfig } from "./agents";
import type { Message } from "./utils/types";

type Props = {
  isXHS: boolean;
  showCoverStyleOption: boolean;
  loading: boolean;
  uiColor: "danger" | "success";
  fieldThemeClass: string;
  ui: AgentUiConfig;
  input: string;
  coverStyle: string;
  coverStyleOptions: Array<{ value: string; label: string }>;
  promptSwitchNode?: React.ReactNode;
  quotedMessage: Message | null;
  onInputChange: (value: string) => void;
  onAutoImageChange: (selected: boolean) => void;
  onCoverStyleChange: (value: string) => void;
  onClearQuote: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
};

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <rect x="5.25" y="5.25" width="9.5" height="9.5" rx="1.75" />
    </svg>
  );
}

export default function AssistantComposer({
  isXHS,
  showCoverStyleOption,
  loading,
  uiColor,
  fieldThemeClass,
  ui,
  input,
  coverStyle,
  coverStyleOptions,
  promptSwitchNode,
  quotedMessage,
  onInputChange,
  onAutoImageChange,
  onCoverStyleChange,
  onClearQuote,
  onSubmit,
  onStop,
}: Props) {
  const [coverMenuOpen, setCoverMenuOpen] = React.useState(false);
  const coverMenuRef = React.useRef<HTMLDivElement | null>(null);
  const currentCoverLabel =
    coverStyleOptions.find((item) => item.value === coverStyle)?.label ?? "不生成封面";

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node | null;
      if (coverMenuRef.current && target && !coverMenuRef.current.contains(target)) {
        setCoverMenuOpen(false);
      }
    }
    if (coverMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [coverMenuOpen]);

  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 bg-transparent px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-5"
    >
      {isXHS && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {promptSwitchNode}
          {showCoverStyleOption ? (
          <div className="relative inline-flex items-center" ref={coverMenuRef}>
            <button
              type="button"
              onClick={() => setCoverMenuOpen((v) => !v)}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-slate-200/90 bg-white px-3.5 text-[10px] font-medium text-slate-800 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:shadow-none"
            >
              <span className="max-w-[88px] truncate whitespace-nowrap">{currentCoverLabel}</span>
              <span className="text-[9px] text-slate-400">▼</span>
            </button>
            {coverMenuOpen ? (
              <div className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-[120px] rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <div className="grid gap-1">
                  {coverStyleOptions.map((item) => {
                    const active = item.value === coverStyle;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={`w-full rounded-md px-2 py-1 text-left text-[11px] transition ${
                          active
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                        }`}
                        onClick={() => {
                          onCoverStyleChange(item.value);
                          onAutoImageChange(item.value !== "off");
                          setCoverMenuOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          ) : null}
        </div>
      )}

      <div
        className="rounded-[22px] border border-slate-200/70 bg-white p-1.5 shadow-[0_2px_14px_rgba(15,23,42,0.07)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_2px_18px_rgba(0,0,0,0.35)]"
      >
        <div
          className={`rounded-[20px] px-2 py-1 ${
            isXHS ? "bg-slate-50/95 dark:bg-slate-800/90" : fieldThemeClass
          }`}
        >
            {quotedMessage && (
              <div className="mb-1 rounded-lg border border-slate-200/90 bg-slate-100/75 px-3 py-2 text-left dark:border-slate-600/70 dark:bg-slate-700/35">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-300">引用消息</p>
                  <button
                    type="button"
                    onClick={onClearQuote}
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-600/60 dark:hover:text-slate-200"
                    aria-label="取消引用"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                      <path
                        fillRule="evenodd"
                        d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 11-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
                <p
                  className="text-xs leading-5 text-slate-700 dark:text-slate-200"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {quotedMessage.content}
                </p>
              </div>
            )}
            <div className="relative">
              <Input
                fullWidth
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder={ui.placeholder}
                disabled={loading}
                className="bg-transparent border-none shadow-none pr-10 !outline-none !ring-0 focus:!outline-none focus:!ring-0 focus-visible:!outline-none focus-visible:!ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSubmit(e as unknown as React.FormEvent);
                  }
                }}
              />
              {loading ? (
                <Button
                  type="button"
                  aria-label="停止生成"
                  onPress={onStop}
                  className="absolute right-1.5 top-1/2 h-8 min-w-8 w-8 -translate-y-1/2 rounded-full bg-slate-700 px-0 text-white shadow-sm hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500"
                >
                  <StopIcon className="mx-auto h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  isDisabled={!input.trim()}
                  aria-label="发送消息"
                  className={`absolute right-1.5 top-1/2 h-8 min-w-8 w-8 -translate-y-1/2 px-0 text-sm font-semibold rounded-full shadow-sm ${
                    uiColor === "danger"
                      ? "bg-rose-600 text-white"
                      : "bg-teal-600 text-white"
                  }`}
                >
                  ↑
                </Button>
              )}
            </div>
        </div>
      </div>
    </form>
  );
}
