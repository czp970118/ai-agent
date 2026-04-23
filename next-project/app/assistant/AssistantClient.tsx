"use client";

import React, { useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Checkbox,
  Input,
  ListBox,
  ListBoxItem,
  Select,
  TextArea,
} from "@heroui/react";
import DOMPurify from "isomorphic-dompurify";
import { AGENTS, type AgentId, agentUi } from "./agents";
import MessageContent, { isLikelyHtmlFragment } from "./MessageContent";
import mockWorkflowFixture from "@/mock.json";

/** 非安全上下文（如 http://局域网IP）下无 randomUUID，需降级 */
function createClientId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 14)}`;
}

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type WorkflowStatusEvent = {
  jobId: string;
  status: "pending" | "running" | "done" | "failed";
  progress?: number;
  message?: string;
  result?: unknown;
  error?: string;
};

type Props = {
  agentId: AgentId;
};

type McpStreamEvent = {
  event: string;
  data: unknown;
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

/** 单条复制到剪贴板用的纯文本（HTML 类内容会抽取可见文字） */
function messageContentAsPlainText(msg: Message): string {
  if (msg.role === "user") return msg.content;
  if (isLikelyHtmlFragment(msg.content)) {
    const safe = DOMPurify.sanitize(msg.content, { USE_PROFILES: { html: true } });
    if (typeof document !== "undefined") {
      const div = document.createElement("div");
      div.innerHTML = safe;
      return (div.textContent ?? div.innerText ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return safe
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return msg.content;
}

/** 非 https / 非安全上下文下 Clipboard API 不可用，用 execCommand 回退 */
function copyPlainTextViaExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText =
    "position:fixed;left:0;top:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:0";
  document.body.appendChild(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
  return ok;
}

async function writePlainTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 回退（权限被拒、部分 WebView 等）
    }
  }
  return copyPlainTextViaExecCommand(text);
}

export default function AssistantClient({ agentId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const skipN8nDev = searchParams.get("dev") === "true";
  const isXHS = agentId === "xiaohongshu";
  const uiColor = isXHS ? "danger" : "success";
  const fieldThemeClass = isXHS
    ? "bg-rose-50/70 border-rose-200 dark:bg-slate-800 dark:border-slate-700"
    : "bg-teal-50/60 border-teal-200 dark:bg-slate-800 dark:border-slate-700";
  const checkboxActiveClass = isXHS
    ? "data-[selected=true]:border-rose-500 data-[selected=true]:bg-rose-500"
    : "data-[selected=true]:border-teal-500 data-[selected=true]:bg-teal-500";
  const ui = agentUi[agentId];

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("帮我写一篇越南河内3天旅游攻略");
  const [standardMode, setStandardMode] = useState(false);
  const [topic, setTopic] = useState("");
  const [requirements, setRequirements] = useState("");
  const [autoImage, setAutoImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  /** 当前请求的中止；点击「停止」时 abort，用于 fetch / SSE / mock 等待 */
  const inFlightAbortRef = useRef<AbortController | null>(null);
  /** 小红书流式回复时正在更新的助手气泡 id，停止时写入「已停止」 */
  const streamingAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyMessageTimerRef.current) clearTimeout(copyMessageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function copyMessageCard(msg: Message) {
    let text = messageContentAsPlainText(msg).trim();
    if (!text) {
      text = msg.content.trim();
    }
    if (!text) return;

    const ok = await writePlainTextToClipboard(text);
    if (!ok) return;

    if (copyMessageTimerRef.current) clearTimeout(copyMessageTimerRef.current);
    setCopiedMessageId(msg.id);
    copyMessageTimerRef.current = setTimeout(() => {
      setCopiedMessageId(null);
      copyMessageTimerRef.current = null;
    }, 2000);
  }

  function upsertAssistantMessage(id: string, content: string) {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) {
        return [...prev, { id, role: "assistant", content }];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], content };
      return next;
    });
  }

  function getMcpBaseUrl(): string {
    const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
    if (env) return env.replace(/\/+$/, "");
    return "http://127.0.0.1:8000";
  }

  function parseSseChunk(chunk: string): McpStreamEvent[] {
    const blocks = chunk.split("\n\n");
    const events: McpStreamEvent[] = [];
    for (const block of blocks) {
      const lines = block.split("\n");
      let event = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }
      if (!dataLines.length) continue;
      const joined = dataLines.join("\n");
      let data: unknown = joined;
      try {
        data = JSON.parse(joined);
      } catch {
        // 保持文本原样
      }
      events.push({ event, data });
    }
    return events;
  }

  async function runMcpStreamChat(
    conversationForChat: Message[],
    workflowPayload: Record<string, unknown> | null,
    assistantMessageId: string,
    signal: AbortSignal
  ) {
    const res = await fetch(`${getMcpBaseUrl()}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: agentId,
        workflow: workflowPayload ?? {},
        messages: conversationForChat.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `流式请求失败(${res.status})`);
    }
    if (!res.body) {
      throw new Error("服务器未返回可读取的流");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const events = parseSseChunk(`${part}\n\n`);
        for (const evt of events) {
          if (evt.event === "delta") {
            const piece =
              typeof evt.data === "object" &&
              evt.data &&
              "content" in evt.data &&
              typeof (evt.data as { content?: unknown }).content === "string"
                ? String((evt.data as { content: string }).content)
                : "";
            if (!piece) continue;
            content += piece;
            upsertAssistantMessage(assistantMessageId, content);
          } else if (evt.event === "error") {
            const message =
              typeof evt.data === "object" &&
              evt.data &&
              "error" in evt.data &&
              typeof (evt.data as { error?: unknown }).error === "string"
                ? String((evt.data as { error: string }).error)
                : "流式生成失败";
            throw new Error(message);
          } else if (evt.event === "end") {
            if (!content.trim()) {
              const fallback =
                typeof evt.data === "object" &&
                evt.data &&
                "content" in evt.data &&
                typeof (evt.data as { content?: unknown }).content === "string"
                  ? String((evt.data as { content: string }).content)
                  : "没有收到回复。";
              upsertAssistantMessage(assistantMessageId, fallback);
            }
          }
        }
      }
    }
  }

  function formatWorkflowFinalResult(result: unknown): string {
    if (typeof result === "string") return result;
    if (result === undefined || result === null) return "任务已完成。";
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return "任务已完成，但结果无法序列化显示。";
    }
  }

  async function runWorkflowWithSse(
    payload: Record<string, unknown>,
    assistantMessageId: string,
    signal: AbortSignal
  ) {
    const startRes = await fetch("/api/workflow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const startData = await startRes.json();
    if (!startRes.ok) {
      throw new Error(startData.error ?? "启动流程失败");
    }

    const jobId = String(startData.jobId ?? "").trim();
    if (!jobId) {
      throw new Error("流程未返回 jobId");
    }

    upsertAssistantMessage(assistantMessageId, `任务已提交（${jobId}），开始监听执行进度...`);

    await new Promise<void>((resolve, reject) => {
      let done = false;
      const es = new EventSource(
        `/api/workflow/stream?jobId=${encodeURIComponent(jobId)}`
      );

      const finish = () => {
        signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        if (done) return;
        done = true;
        es.close();
        finish();
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);

      const safeParse = (raw: string): unknown => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      };

      const failAndClose = (message: string) => {
        if (done) return;
        done = true;
        es.close();
        finish();
        reject(new Error(message));
      };

      es.addEventListener("connected", () => {
        if (signal.aborted) return;
        upsertAssistantMessage(assistantMessageId, `任务 ${jobId} 已连接，等待状态更新...`);
      });

      es.addEventListener("status", (evt) => {
        if (signal.aborted) return;
        const data = safeParse((evt as MessageEvent).data) as WorkflowStatusEvent | null;
        if (!data) return;
        const tip = data.message?.trim() || "流程执行中...";
        const progressText =
          typeof data.progress === "number" ? ` (${Math.round(data.progress)}%)` : "";
        upsertAssistantMessage(
          assistantMessageId,
          `任务状态：${data.status}${progressText}\n${tip}`
        );
      });

      es.addEventListener("end", (evt) => {
        if (done) return;
        done = true;
        const data = safeParse((evt as MessageEvent).data) as WorkflowStatusEvent | null;
        es.close();
        finish();

        if (!data) {
          upsertAssistantMessage(assistantMessageId, "任务结束，但未收到有效结果。");
          resolve();
          return;
        }

        if (data.status === "failed") {
          reject(new Error(data.error || data.message || "流程执行失败"));
          return;
        }

        const finalText = formatWorkflowFinalResult(data.result);
        upsertAssistantMessage(assistantMessageId, finalText);
        resolve();
      });

      es.addEventListener("timeout", (evt) => {
        const data = safeParse((evt as MessageEvent).data) as { error?: string } | null;
        failAndClose(data?.error || "流程监听超时，请稍后重试");
      });

      es.addEventListener("error", () => {
        if (done) return;
        failAndClose("SSE 连接中断，请稍后重试");
      });
    });
  }

  async function runWorkflowWithMockDev(assistantMessageId: string, signal: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        window.clearTimeout(id);
        signal.removeEventListener("abort", onAbort);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const id = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, 1500);
      signal.addEventListener("abort", onAbort);
    });

    const row = Array.isArray(mockWorkflowFixture)
      ? (mockWorkflowFixture[0] as WorkflowStatusEvent | undefined)
      : undefined;
    if (!row) {
      throw new Error("mock.json 为空或格式不正确");
    }
    if (row.status === "failed") {
      throw new Error(row.error || row.message || "模拟流程失败");
    }
    const finalText = formatWorkflowFinalResult(row.result);
    upsertAssistantMessage(assistantMessageId, finalText);
  }

  async function executeAgentRun(
    conversationForChat: Message[],
    workflowPayload: Record<string, unknown> | null,
    workflowPromptText: string,
    signal: AbortSignal
  ): Promise<void> {
    const assistantMessageId = createClientId();
    streamingAssistantIdRef.current = assistantMessageId;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content:
          isXHS && skipN8nDev
            ? "开发模式（?dev=true）：已跳过 n8n，约 3 秒后返回 mock.json 中的模拟结果…"
            : "正在生成...",
      },
    ]);

    if (isXHS && skipN8nDev) {
      await runWorkflowWithMockDev(assistantMessageId, signal);
      streamingAssistantIdRef.current = null;
      return;
    }

    await runMcpStreamChat(
      conversationForChat,
      workflowPayload ?? { agent: agentId, mode: "default", prompt: workflowPromptText },
      assistantMessageId,
      signal
    );
    streamingAssistantIdRef.current = null;
  }

  async function withInFlightAbort(
    run: (signal: AbortSignal) => Promise<void>
  ): Promise<void> {
    setLoading(true);
    const controller = new AbortController();
    inFlightAbortRef.current = controller;
    const signal = controller.signal;
    try {
      await run(signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        const sid = streamingAssistantIdRef.current;
        if (sid) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === sid && m.role === "assistant"
                ? {
                    ...m,
                    content: m.content.includes("已停止")
                      ? m.content
                      : `${m.content.trimEnd()}\n\n已停止。`,
                  }
                : m
            )
          );
        }
        streamingAssistantIdRef.current = null;
        return;
      }
      const message =
        error instanceof Error ? error.message : "网络或服务器错误，请稍后重试。";
      const sid = streamingAssistantIdRef.current;
      setMessages((prev) => {
        if (sid && isXHS) {
          return prev.map((m) =>
            m.id === sid && m.role === "assistant"
              ? { ...m, content: `错误：${message}` }
              : m
          );
        }
        return [
          ...prev,
          {
            id: createClientId(),
            role: "assistant",
            content: `错误：${message}`,
          },
        ];
      });
      streamingAssistantIdRef.current = null;
    } finally {
      inFlightAbortRef.current = null;
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    let text = input.trim();
    let workflowPayload: Record<string, unknown> | null = null;
    if (isXHS && standardMode) {
      const topicValue = topic.trim();
      const requirementsValue = requirements.trim();
      if (!topicValue || !requirementsValue) return;
      text = [
        "【标准输入模式】",
        `主题：${topicValue}`,
        `主要内容：${requirementsValue}`,
        `是否自动生成图片：${autoImage ? "是" : "否"}`,
        "请按小红书笔记格式输出，包含标题、正文和可选话题标签。",
      ].join("\n");
      workflowPayload = {
        agent: agentId,
        mode: "standard",
        topic: topicValue,
        requirements: requirementsValue,
        autoImage,
        prompt: text,
      };
    } else if (isXHS) {
      workflowPayload = {
        agent: agentId,
        mode: "default",
        prompt: text,
      };
    }
    if (!text) return;

    const userMessage: Message = {
      id: createClientId(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    if (isXHS && standardMode) {
      setTopic("");
      setRequirements("");
      setAutoImage(false);
    }

    await withInFlightAbort((signal) =>
      executeAgentRun([...messages, userMessage], workflowPayload, text, signal)
    );
  }

  async function regenerateAssistantMessage(assistantId: string) {
    if (loading) return;
    const idx = messages.findIndex((m) => m.id === assistantId);
    if (idx === -1 || messages[idx]?.role !== "assistant") return;
    let prevUserIdx = -1;
    for (let j = idx - 1; j >= 0; j--) {
      if (messages[j]!.role === "user") {
        prevUserIdx = j;
        break;
      }
    }
    if (prevUserIdx === -1) return;
    const userMsg = messages[prevUserIdx]!;
    const truncated = messages.slice(0, idx);
    const workflowPayload = isXHS
      ? { agent: agentId, mode: "default", prompt: userMsg.content }
      : null;

    flushSync(() => {
      setMessages(truncated);
    });
    await withInFlightAbort((signal) =>
      executeAgentRun(truncated, workflowPayload, userMsg.content, signal)
    );
  }

  function stopInFlight() {
    inFlightAbortRef.current?.abort();
  }

  const shellGradient = `bg-gradient-to-b ${ui.shellFrom} ${ui.shellTo} ${ui.shellFromDark} ${ui.shellToDark}`;

  return (
    <div
      className={`h-dvh min-h-0 overflow-hidden ${shellGradient} flex flex-col`}
    >
      <header
        className={`shrink-0 border-b z-10 ${ui.headerBorder} ${ui.headerBg} backdrop-blur`}
      >
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 text-sm shrink-0"
          >
            ← 返回首页
          </Link>
          <p
            className={`flex-1 min-w-0 text-center text-sm sm:text-base font-semibold leading-snug ${ui.titleText}`}
          >
           {ui.badge.replace(/^任务[：:]\s*/, "")}
          </p>
          <div className="w-32 shrink-0">
            <Select
              aria-label="切换 AI"
              variant="secondary"
              selectedKey={agentId}
              onSelectionChange={(key) => {
                const nextAgent = String(key) as AgentId;
                if (nextAgent !== agentId) {
                  router.push(`/assistant/${nextAgent}`);
                }
              }}
              className="w-full"
            >
              <Select.Trigger className="w-full">
                <Select.Value className="truncate whitespace-nowrap" />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox aria-label="Agent 列表">
                  {AGENTS.map((id) => (
                    <ListBoxItem id={id} key={id}>
                      {agentUi[id].shortLabel}
                    </ListBoxItem>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>
      </header>

      <main className="flex flex-1 min-h-0 w-full max-w-3xl mx-auto flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-6 pb-2">
          {messages.length === 0 ? (
            <div className="flex min-h-full flex-1 flex-col items-center justify-center py-12 text-center">
              <div
                className={`w-14 h-14 rounded-2xl ${ui.accentIconBg} flex items-center justify-center mb-4`}
              >
                <span className="text-2xl" aria-hidden>
                  {ui.emptyEmoji}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 mb-1 font-medium">
                {ui.emptyTitle}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
                {ui.emptyHint}
              </p>
            </div>
          ) : (
            <ul className="space-y-4 pb-2">
              {messages.map((msg) => (
                <li
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 pt-2.5 pb-1 flex flex-col gap-1 ${
                      msg.role === "user"
                        ? ui.userBubble
                        : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-md"
                    }`}
                  >
                    <div className="min-w-0">
                      <MessageContent role={msg.role} content={msg.content} />
                    </div>
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
                            void regenerateAssistantMessage(msg.id);
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
                          void copyMessageCard(msg);
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
              {loading && (
                <li className="flex justify-start">
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-md px-4 py-2.5">
                    <span className="inline-flex gap-1">
                      <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
                    </span>
                  </div>
                </li>
              )}
              <div ref={listEndRef} />
            </ul>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 bg-transparent px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-5"
        >
          {isXHS && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setStandardMode((v) => !v)}
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
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="主题（必填）"
                  disabled={loading}
                  className="rounded-xl border border-slate-200/90 bg-slate-50/50 dark:border-slate-600 dark:bg-slate-800/50"
                />
                <TextArea
                  variant="secondary"
                  fullWidth
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="主要内容"
                  disabled={loading}
                  rows={3}
                  className="rounded-xl border border-slate-200/90 bg-slate-50/50 dark:border-slate-600 dark:bg-slate-800/50"
                />
                <Checkbox
                  isSelected={autoImage}
                  onChange={(selected) => setAutoImage(selected)}
                  isDisabled={loading}
                  variant="secondary"
                  className="items-center gap-2"
                >
                  <Checkbox.Control className={`h-4 w-4 rounded border border-slate-400 ${checkboxActiveClass}`}>
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
                      onPress={() => stopInFlight()}
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
                className={`relative rounded-full px-2 py-1 ${
                  isXHS
                    ? "bg-slate-50/95 dark:bg-slate-800/90"
                    : fieldThemeClass
                }`}
              >
                <Input
                  fullWidth
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={ui.placeholder}
                  disabled={loading}
                  className="bg-transparent border-none shadow-none pr-10 !outline-none !ring-0 focus:!outline-none focus:!ring-0 focus-visible:!outline-none focus-visible:!ring-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                />
                {loading ? (
                  <Button
                    type="button"
                    aria-label="停止生成"
                    onPress={() => stopInFlight()}
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
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
