import React from "react";
import MessageContent from "./MessageContent";
import type { Message } from "./utils/types";

type Props = {
  messages: Message[];
  loading: boolean;
  copiedMessageId: string | null;
  userBubbleClass: string;
  onCopy: (msg: Message) => void;
  onRegenerate: (assistantId: string) => void;
  listEndRef: React.RefObject<HTMLDivElement | null>;
};

export default function AssistantMessageList({
  messages,
  loading,
  copiedMessageId,
  userBubbleClass,
  onCopy,
  onRegenerate,
  listEndRef,
}: Props) {
  return (
    <ul className="space-y-4 pb-2">
      {messages.map((msg) => (
        <li
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] rounded-2xl px-4 pt-2.5 pb-1 flex flex-col gap-1 ${
              msg.role === "user"
                ? userBubbleClass
                : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-md"
            }`}
          >
            <div className="min-w-0">
              {msg.role === "assistant" && loading && msg.content.trim() === "正在搜索并总结文案..." ? (
                <div className="thinking-shimmer text-sm">正在搜索并总结文案...</div>
              ) : (
                <MessageContent role={msg.role} content={msg.content} />
              )}
            </div>
            {msg.role === "assistant" && Array.isArray(msg.references) && msg.references.length > 0 && (
              <details className="reference-panel mt-1 rounded-xl border border-slate-200/90 bg-slate-50/85 px-3 py-2 text-xs dark:border-slate-600/80 dark:bg-slate-700/35">
                <summary className="reference-summary flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                  <span className="truncate leading-relaxed">
                    搜索 {msg.searchMeta?.queryCount ?? msg.searchMeta?.queryTerms.length ?? 0} 个关键词，参考{" "}
                    {msg.references.length} 篇资料
                    {Array.isArray(msg.searchMeta?.queryTerms) && msg.searchMeta.queryTerms.length > 0
                      ? `（${msg.searchMeta.queryTerms.join("、")}）`
                      : ""}
                  </span>
                  <span
                    aria-hidden
                    className="reference-chevron inline-flex h-4 w-4 shrink-0 items-center justify-center text-slate-400"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.12l3.71-3.89a.75.75 0 111.08 1.04l-4.25 4.46a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                </summary>
                {Array.isArray(msg.searchMeta?.queryTerms) && msg.searchMeta.queryTerms.length > 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {msg.searchMeta.queryTerms.map((t) => `“${t}”`).join("、")}
                  </p>
                )}
                <ul className="mt-2 space-y-1.5 border-t border-slate-200/70 pt-2 dark:border-slate-600/70">
                  {msg.references.map((ref, idx) => (
                    <li key={`${ref.url}-${idx}`} className="leading-relaxed">
                      <span className="mr-1 text-slate-500">{idx + 1}.</span>
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-rose-600 underline dark:text-rose-400"
                      >
                        {ref.title || ref.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div
              className={`flex justify-end items-center gap-0.5 pt-1 mt-0.5 ${
                msg.role === "user"
                  ? "border-t border-white/25"
                  : "border-t border-slate-100 dark:border-slate-600/90"
              }`}
            >
              {msg.role === "assistant" && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRegenerate(msg.id);
                  }}
                  aria-label="重新生成"
                  title="重新生成"
                  className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.75}
                    stroke="currentColor"
                    className="h-4 w-4"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onCopy(msg);
                }}
                aria-label={copiedMessageId === msg.id ? "已复制" : "复制此条消息"}
                title={copiedMessageId === msg.id ? "已复制" : "复制"}
                className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors ${
                  msg.role === "user"
                    ? "text-white/75 hover:text-white hover:bg-white/15"
                    : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80"
                }`}
              >
                {copiedMessageId === msg.id ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-4 h-4"
                    aria-hidden
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-4 h-4"
                    aria-hidden
                  >
                    <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
                    <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </li>
      ))}
      <div ref={listEndRef} />
    </ul>
  );
}
