import React from "react";
import { Button, Checkbox, Input, TextArea } from "@heroui/react";
import type { AgentUiConfig } from "./agents";
import type { Message } from "./utils/types";

type Props = {
  isXHS: boolean;
  standardMode: boolean;
  loading: boolean;
  uiColor: "danger" | "success";
  fieldThemeClass: string;
  checkboxActiveClass: string;
  ui: AgentUiConfig;
  input: string;
  topic: string;
  requirements: string;
  autoImage: boolean;
  promptSwitchNode?: React.ReactNode;
  quotedMessage: Message | null;
  onToggleStandardMode: () => void;
  onInputChange: (value: string) => void;
  onTopicChange: (value: string) => void;
  onRequirementsChange: (value: string) => void;
  onAutoImageChange: (selected: boolean) => void;
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
  standardMode,
  loading,
  uiColor,
  fieldThemeClass,
  checkboxActiveClass,
  ui,
  input,
  topic,
  requirements,
  autoImage,
  promptSwitchNode,
  quotedMessage,
  onToggleStandardMode,
  onInputChange,
  onTopicChange,
  onRequirementsChange,
  onAutoImageChange,
  onClearQuote,
  onSubmit,
  onStop,
}: Props) {
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 bg-transparent px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-5"
    >
      {isXHS && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {promptSwitchNode}
          <button
            type="button"
            disabled={loading}
            onClick={onToggleStandardMode}
            aria-pressed={standardMode}
            className={`inline-flex items-center gap-2 rounded-[10px] border bg-white px-3.5 py-2 text-sm font-medium shadow-sm transition-colors dark:bg-slate-800 dark:shadow-none ${
              standardMode
                ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/50 dark:bg-rose-950/50 dark:text-rose-100"
                : "border-slate-200/90 text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700/60"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.75}
              stroke="currentColor"
              className="h-4 w-4 shrink-0 opacity-80"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
            标准模式
          </button>
        </div>
      )}

      <div
        className={`rounded-[22px] border border-slate-200/70 bg-white shadow-[0_2px_14px_rgba(15,23,42,0.07)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_2px_18px_rgba(0,0,0,0.35)] ${
          isXHS && standardMode ? "p-3" : "p-1.5"
        }`}
      >
        {isXHS && standardMode ? (
          <div className="space-y-2.5">
            <Input
              variant="secondary"
              fullWidth
              value={topic}
              onChange={(e) => onTopicChange(e.target.value)}
              placeholder="主题（必填）"
              disabled={loading}
              className="rounded-xl border border-slate-200/90 bg-slate-50/50 dark:border-slate-600 dark:bg-slate-800/50"
            />
            <TextArea
              variant="secondary"
              fullWidth
              value={requirements}
              onChange={(e) => onRequirementsChange(e.target.value)}
              placeholder="主要内容"
              disabled={loading}
              rows={3}
              className="rounded-xl border border-slate-200/90 bg-slate-50/50 dark:border-slate-600 dark:bg-slate-800/50"
            />
            <Checkbox
              isSelected={autoImage}
              onChange={(selected) => onAutoImageChange(selected)}
              isDisabled={loading}
              variant="secondary"
              className="items-center gap-2"
            >
              <Checkbox.Control
                className={`h-4 w-4 rounded border border-slate-400 ${checkboxActiveClass}`}
              >
                <Checkbox.Indicator className="text-white" />
              </Checkbox.Control>
              <Checkbox.Content className="text-sm text-slate-700 dark:text-slate-200">
                是否自动生成图片
              </Checkbox.Content>
            </Checkbox>
            <div className="flex justify-end pt-0.5">
              {loading ? (
                <Button
                  type="button"
                  aria-label="停止生成"
                  onPress={onStop}
                  className="min-w-[88px] rounded-full bg-slate-700 font-medium text-white hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500"
                >
                  <StopIcon className="mx-auto h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  isDisabled={!topic.trim() || !requirements.trim()}
                  className={`min-w-[88px] rounded-full font-medium ${
                    uiColor === "danger"
                      ? "bg-rose-600 text-white"
                      : "bg-teal-600 text-white"
                  }`}
                >
                  发送
                </Button>
              )}
            </div>
          </div>
        ) : (
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
        )}
      </div>
    </form>
  );
}
