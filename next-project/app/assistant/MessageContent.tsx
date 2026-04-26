"use client";

import DOMPurify from "isomorphic-dompurify";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const richWrapper =
  "max-w-none text-sm leading-relaxed text-slate-800";

const htmlRichClass = `${richWrapper} space-y-2 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_p]:text-slate-800 [&_span]:text-slate-800 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:my-0.5 [&_li]:text-slate-800 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_strong]:font-semibold [&_hr]:my-3 [&_hr]:border-slate-200 [&_hr]:dark:border-slate-600 [&_a]:text-rose-600 [&_a]:underline dark:[&_a]:text-rose-400 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic dark:[&_blockquote]:border-slate-600`;

const mdComponents: Partial<Components> = {
  h1: ({ children, ...rest }) => (
    <h1
      className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-3 mb-2 first:mt-0"
      {...rest}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...rest }) => (
    <h2
      className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-3 mb-2 first:mt-0"
      {...rest}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...rest }) => (
    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-2 mb-1" {...rest}>
      {children}
    </h3>
  ),
  p: ({ children, ...rest }) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-slate-800" {...rest}>
      {children}
    </p>
  ),
  ul: ({ children, ...rest }) => (
    <ul className="list-disc pl-5 mb-2 space-y-1 text-slate-800" {...rest}>
      {children}
    </ul>
  ),
  ol: ({ children, ...rest }) => (
    <ol className="list-decimal pl-5 mb-2 space-y-1 text-slate-800" {...rest}>
      {children}
    </ol>
  ),
  li: ({ children, ...rest }) => (
    <li className="leading-relaxed text-slate-800" {...rest}>
      {children}
    </li>
  ),
  strong: ({ children, ...rest }) => (
    <strong className="font-semibold text-slate-900 dark:text-slate-100" {...rest}>
      {children}
    </strong>
  ),
  hr: () => <hr className="my-3 border-slate-200 dark:border-slate-600" />,
  a: ({ children, href, ...rest }) => (
    <a
      href={href}
      className="text-rose-600 dark:text-rose-400 underline break-all"
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    >
      {children}
    </a>
  ),
  blockquote: ({ children, ...rest }) => (
    <blockquote
      className="border-l-2 border-slate-300 dark:border-slate-600 pl-3 my-2 italic text-slate-600 dark:text-slate-400"
      {...rest}
    >
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-900 p-3 text-xs font-mono border border-slate-200 dark:border-slate-700">
      {children}
    </pre>
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className={`text-xs font-mono ${className ?? ""}`} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-slate-100 dark:bg-slate-700/80 px-1 py-0.5 text-[0.85em] font-mono"
        {...rest}
      >
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto mb-3">
      <table className="min-w-full text-xs border-collapse border border-slate-200 dark:border-slate-600 rounded-md overflow-hidden">
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...rest }) => (
    <thead className="bg-slate-100 dark:bg-slate-800" {...rest}>
      {children}
    </thead>
  ),
  th: ({ children, ...rest }) => (
    <th
      className="border border-slate-200 dark:border-slate-600 px-2 py-1.5 text-left font-semibold whitespace-nowrap"
      {...rest}
    >
      {children}
    </th>
  ),
  td: ({ children, ...rest }) => (
    <td
      className="border border-slate-200 dark:border-slate-600 px-2 py-1.5 align-top break-words"
      {...rest}
    >
      {children}
    </td>
  ),
};

export function isLikelyHtmlFragment(s: string): boolean {
  const t = s.trim();
  if (t.length < 3 || !t.startsWith("<") || !t.includes(">")) return false;
  const head = t.slice(0, 4000);
  return /<\/?(p|div|h[1-6]|ul|ol|li|strong|em|table|thead|tbody|tr|td|th|br|hr|section|article|blockquote|span)\b/i.test(
    head
  );
}

type Props = {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
};

export default function MessageContent({ role, content, isStreaming = false }: Props) {
  if (role === "user") {
    return (
      <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
    );
  }

  if (isLikelyHtmlFragment(content)) {
    const safe = DOMPurify.sanitize(content, { USE_PROFILES: { html: true } });
    return (
      <div
        className={`${htmlRichClass} ${isStreaming ? "thinking-shimmer" : ""}`}
        // 已由 DOMPurify 消毒；内容来自后端服务
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  }

  return (
    <div className={`${richWrapper} ${isStreaming ? "thinking-shimmer" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
