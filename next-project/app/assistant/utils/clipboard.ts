import DOMPurify from "isomorphic-dompurify";
import { isLikelyHtmlFragment } from "../MessageContent";
import type { Message } from "./types";

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
      // Fallback for permission-denied or embedded webviews.
    }
  }
  return copyPlainTextViaExecCommand(text);
}

export async function copyMessageToClipboard(msg: Message): Promise<boolean> {
  let text = messageContentAsPlainText(msg).trim();
  if (!text) {
    text = msg.content.trim();
  }
  if (!text) return false;
  return writePlainTextToClipboard(text);
}
