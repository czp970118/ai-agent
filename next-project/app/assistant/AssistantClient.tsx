"use client";

import React, { useCallback, useState, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListBox, ListBoxItem, Select } from "@heroui/react";
import { AGENTS, type AgentId, agentUi } from "./agents";
import AssistantComposer from "./AssistantComposer";
import AssistantMessageList from "./AssistantMessageList";
import { copyMessageToClipboard } from "./utils/clipboard";
import { getMcpBaseUrl } from "./utils/mcpBaseUrl";
import { getSessionUserId } from "./utils/sessionUserId";
import type {
  McpStreamEvent,
  Message,
  MessageReference,
  MessageSearchMeta,
} from "./utils/types";

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

type Props = {
  agentId: AgentId;
};

export default function AssistantClient({ agentId }: Props) {
  const router = useRouter();
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
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [hydratingSession, setHydratingSession] = useState(true);
  const [input, setInput] = useState("");
  const [standardMode, setStandardMode] = useState(false);
  const [topic, setTopic] = useState("");
  const [requirements, setRequirements] = useState("");
  const [autoImage, setAutoImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  /** 当前请求的中止；点击「停止」时 abort，用于 fetch / SSE */
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
    const ok = await copyMessageToClipboard(msg);
    if (!ok) return;

    if (copyMessageTimerRef.current) clearTimeout(copyMessageTimerRef.current);
    setCopiedMessageId(msg.id);
    copyMessageTimerRef.current = setTimeout(() => {
      setCopiedMessageId(null);
      copyMessageTimerRef.current = null;
    }, 2000);
  }

  const normalizeReferences = useCallback((data: unknown): MessageReference[] => {
    if (!Array.isArray(data)) return [];
    const refs: MessageReference[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const title = String((item as { title?: unknown }).title ?? "").trim();
      const url = String((item as { url?: unknown }).url ?? "").trim();
      if (!url) continue;
      refs.push({ title: title || url, url });
    }
    return refs;
  }, []);

  const normalizeSearchMeta = useCallback((data: unknown): MessageSearchMeta | undefined => {
    if (!data || typeof data !== "object") return undefined;
    const raw = data as { query_count?: unknown; query_terms?: unknown };
    const queryCount = Number(raw.query_count);
    const queryTerms = Array.isArray(raw.query_terms)
      ? raw.query_terms
          .map((x) => String(x ?? "").trim())
          .filter((x) => !!x)
          .slice(0, 8)
      : [];
    return {
      queryCount: Number.isFinite(queryCount) ? Math.max(0, Math.trunc(queryCount)) : queryTerms.length,
      queryTerms,
    };
  }, []);

  function upsertAssistantMessage(
    id: string,
    content: string,
    references?: MessageReference[],
    searchMeta?: MessageSearchMeta
  ) {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) {
        return [...prev, { id, role: "assistant", content, references }];
      }
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        content,
        references: references ?? next[idx]?.references,
        searchMeta: searchMeta ?? next[idx]?.searchMeta,
      };
      return next;
    });
  }

  const normalizeStoredMessages = useCallback((data: unknown): Message[] => {
    if (!Array.isArray(data)) return [];
    const out: Message[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const row = item as {
        id?: unknown;
        role?: unknown;
        content?: unknown;
        meta?: unknown;
      };
      const role = String(row.role ?? "").trim();
      if (role !== "user" && role !== "assistant") continue;
      const content = String(row.content ?? "");
      const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
      const refs =
        "references" in meta
          ? normalizeReferences((meta as { references?: unknown }).references)
          : [];
      const searchMeta =
        "search_meta" in meta
          ? normalizeSearchMeta((meta as { search_meta?: unknown }).search_meta)
          : undefined;
      out.push({
        id: String(row.id ?? createClientId()),
        role,
        content,
        references: refs.length ? refs : undefined,
        searchMeta,
      });
    }
    return out;
  }, [normalizeReferences, normalizeSearchMeta]);

  const resolveSession = useCallback(
    async (forceNew: boolean): Promise<string> => {
      const uid = getSessionUserId();
      const res = await fetch(`${getMcpBaseUrl()}/chat/conversations/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: uid,
          agent: agentId,
          force_new: forceNew,
        }),
      });
      if (!res.ok) {
        throw new Error(`会话初始化失败(${res.status})`);
      }
      const payload = (await res.json()) as {
        conversation?: { id?: string };
      };
      const nextConversationId = String(payload.conversation?.id ?? "").trim();
      if (!nextConversationId) {
        throw new Error("会话初始化失败：缺少 conversation_id");
      }
      setConversationId(nextConversationId);
      return nextConversationId;
    },
    [agentId]
  );

  const loadSessionMessages = useCallback(
    async (userId: string) => {
      const conversationsRes = await fetch(
        `${getMcpBaseUrl()}/chat/conversations?user_id=${encodeURIComponent(userId)}&agent=${encodeURIComponent(
          agentId
        )}&limit=100`
      );
      if (!conversationsRes.ok) {
        throw new Error(`历史会话加载失败(${conversationsRes.status})`);
      }
      const conversationsPayload = (await conversationsRes.json()) as {
        conversations?: Array<{ id?: unknown; last_active_at?: unknown }>;
      };
      const cutoffTs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentConversationIds = Array.isArray(conversationsPayload.conversations)
        ? conversationsPayload.conversations
            .filter((row) => {
              const lastActiveAt = String(row?.last_active_at ?? "");
              const ts = Date.parse(lastActiveAt);
              return Number.isFinite(ts) && ts >= cutoffTs;
            })
            .map((row) => String(row.id ?? "").trim())
            .filter((id) => !!id)
        : [];

      if (!recentConversationIds.length) {
        setMessages([]);
        return;
      }

      const messageRows: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        meta?: unknown;
        createdAt: number;
      }> = [];

      for (const conversationId of recentConversationIds) {
        const res = await fetch(
          `${getMcpBaseUrl()}/chat/conversations/${encodeURIComponent(conversationId)}/messages`
        );
        if (!res.ok) {
          throw new Error(`历史消息加载失败(${res.status})`);
        }
        const payload = (await res.json()) as {
          messages?: Array<{
            id?: unknown;
            role?: unknown;
            content?: unknown;
            meta?: unknown;
            created_at?: unknown;
          }>;
        };
        if (!Array.isArray(payload.messages)) continue;
        for (const row of payload.messages) {
          const role = String(row.role ?? "").trim();
          if (role !== "user" && role !== "assistant") continue;
          messageRows.push({
            id: String(row.id ?? createClientId()),
            role,
            content: String(row.content ?? ""),
            meta: row.meta,
            createdAt: Date.parse(String(row.created_at ?? "")) || 0,
          });
        }
      }

      messageRows.sort((a, b) => a.createdAt - b.createdAt);
      setMessages(
        normalizeStoredMessages(
          messageRows.map((row) => ({
            id: row.id,
            role: row.role,
            content: row.content,
            meta: row.meta,
          }))
        )
      );
    },
    [agentId, normalizeStoredMessages]
  );

  async function persistMessages(
    nextConversationId: string,
    rows: Array<{
      role: "user" | "assistant";
      content: string;
      meta?: Record<string, unknown>;
    }>
  ) {
    if (!rows.length) return;
    await fetch(
      `${getMcpBaseUrl()}/chat/conversations/${encodeURIComponent(nextConversationId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: rows }),
      }
    );
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
  ): Promise<{
    content: string;
    references: MessageReference[];
    searchMeta?: MessageSearchMeta;
  }> {
    const wf: Record<string, unknown> = { ...(workflowPayload ?? {}) };
    wf.user_id = getSessionUserId();

    const res = await fetch(`${getMcpBaseUrl()}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: agentId,
        workflow: wf,
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
    let lastReferences: MessageReference[] = [];
    let lastSearchMeta: MessageSearchMeta | undefined;

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
            const endContent =
              typeof evt.data === "object" &&
              evt.data &&
              "content" in evt.data &&
              typeof (evt.data as { content?: unknown }).content === "string"
                ? String((evt.data as { content: string }).content)
                : "";
            const endRefs =
              typeof evt.data === "object" &&
              evt.data &&
              "references" in evt.data
                ? normalizeReferences((evt.data as { references?: unknown }).references)
                : [];
            const endSearchMeta =
              typeof evt.data === "object" && evt.data && "search_meta" in evt.data
                ? normalizeSearchMeta((evt.data as { search_meta?: unknown }).search_meta)
                : undefined;

            const finalContent = (endContent || content || "").trim() || "没有收到回复。";
            upsertAssistantMessage(assistantMessageId, finalContent, endRefs, endSearchMeta);
            content = finalContent;
            lastReferences = endRefs;
            lastSearchMeta = endSearchMeta;
          }
        }
      }
    }
    return {
      content: content.trim() || "没有收到回复。",
      references: lastReferences,
      searchMeta: lastSearchMeta,
    };
  }

  async function executeAgentRun(
    conversationForChat: Message[],
    workflowPayload: Record<string, unknown> | null,
    signal: AbortSignal
  ): Promise<{
    content: string;
    references: MessageReference[];
    searchMeta?: MessageSearchMeta;
  }> {
    const assistantMessageId = createClientId();
    streamingAssistantIdRef.current = assistantMessageId;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "正在搜索并总结文案...",
      },
    ]);

    const generated = await runMcpStreamChat(
      conversationForChat,
      workflowPayload ?? {
        agent: agentId,
        mode: "default",
        prompt: conversationForChat[conversationForChat.length - 1]?.content ?? "",
      },
      assistantMessageId,
      signal
    );
    streamingAssistantIdRef.current = null;
    return generated;
  }

  async function withInFlightAbort<T>(
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T | null> {
    setLoading(true);
    const controller = new AbortController();
    inFlightAbortRef.current = controller;
    const signal = controller.signal;
    try {
      return await run(signal);
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
        return null;
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
      return null;
    } finally {
      inFlightAbortRef.current = null;
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      setHydratingSession(true);
      try {
        const uid = getSessionUserId();
        const nextConversationId = await resolveSession(false);
        if (cancelled) return;
        if (!nextConversationId) return;
        await loadSessionMessages(uid);
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "会话恢复失败，请稍后重试。";
        setMessages([
          {
            id: createClientId(),
            role: "assistant",
            content: `错误：${message}`,
          },
        ]);
      } finally {
        if (!cancelled) {
          setHydratingSession(false);
        }
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [loadSessionMessages, resolveSession]);

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
    const quoted = quotedMessage;
    const messageForModel =
      quoted && quoted.content.trim()
        ? `【引用消息】\n${quoted.content.trim()}\n\n【我的补充】\n${text}`
        : text;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setQuotedMessage(null);
    if (isXHS && standardMode) {
      setTopic("");
      setRequirements("");
      setAutoImage(false);
    }

    const generated = await withInFlightAbort((signal) =>
      executeAgentRun(
        [
          ...messages,
          {
            ...userMessage,
            content: messageForModel,
          },
        ],
        workflowPayload,
        signal
      )
    );
    if (!generated || !conversationId) return;
    try {
      await persistMessages(conversationId, [
        { role: "user", content: userMessage.content },
        {
          role: "assistant",
          content: generated.content,
          meta: {
            references: generated.references,
            search_meta: generated.searchMeta
              ? {
                  query_count: generated.searchMeta.queryCount,
                  query_terms: generated.searchMeta.queryTerms,
                }
              : undefined,
          },
        },
      ]);
    } catch {
      // 聊天结果已经在页面展示，持久化失败不阻塞主流程
    }
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
      executeAgentRun(truncated, workflowPayload, signal)
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
          {hydratingSession ? (
            <div className="flex min-h-full flex-1 flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">正在加载最近一周记录...</p>
            </div>
          ) : messages.length === 0 ? (
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
            <AssistantMessageList
              messages={messages}
              loading={loading}
              copiedMessageId={copiedMessageId}
              userBubbleClass={ui.userBubble}
              onCopy={(msg) => void copyMessageCard(msg)}
            onQuote={(msg) => setQuotedMessage(msg)}
              onEdit={(msg) => {
                setInput(msg.content);
                setQuotedMessage(null);
              }}
              onRegenerate={(assistantId) => void regenerateAssistantMessage(assistantId)}
              listEndRef={listEndRef}
            />
          )}
        </div>

        <AssistantComposer
          isXHS={isXHS}
          standardMode={standardMode}
          loading={loading}
          uiColor={uiColor}
          fieldThemeClass={fieldThemeClass}
          checkboxActiveClass={checkboxActiveClass}
          ui={ui}
          input={input}
          topic={topic}
          requirements={requirements}
          autoImage={autoImage}
          quotedMessage={quotedMessage}
          onToggleStandardMode={() => setStandardMode((v) => !v)}
          onInputChange={setInput}
          onTopicChange={setTopic}
          onRequirementsChange={setRequirements}
          onAutoImageChange={setAutoImage}
          onClearQuote={() => setQuotedMessage(null)}
          onSubmit={handleSubmit}
          onStop={stopInFlight}
        />
      </main>
    </div>
  );
}
