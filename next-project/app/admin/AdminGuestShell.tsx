"use client";

import { useGuestMode } from "@/app/access/GuestModeContext";
import Link from "next/link";
import { ReactNode, useEffect, useRef } from "react";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function shouldDisable(el: Element, allowNav: boolean): boolean {
  if (el.closest("[data-guest-allow]")) return false;
  if (allowNav && el.closest("[data-guest-nav]")) return false;
  return true;
}

export default function AdminGuestShell({ children }: { children: ReactNode }) {
  const { isGuest } = useGuestMode();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isGuest) return;
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (
        init?.method ??
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (MUTATION_METHODS.has(method)) {
        return new Response(
          JSON.stringify({ error: "访客模式下不可修改后台数据" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      return origFetch(input, init);
    };
    return () => {
      window.fetch = origFetch;
    };
  }, [isGuest]);

  useEffect(() => {
    const root = mainRef.current;
    if (!isGuest || !root) return;

    const syncDisabled = () => {
      root
        .querySelectorAll("button, input, select, textarea, [contenteditable='true']")
        .forEach((node) => {
          if (!shouldDisable(node, false)) return;
          const el = node as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          el.disabled = true;
          if (el instanceof HTMLElement && el.getAttribute("contenteditable") === "true") {
            el.setAttribute("contenteditable", "false");
          }
        });
      root.querySelectorAll("form").forEach((form) => {
        if (!shouldDisable(form, false)) return;
        form.setAttribute("data-guest-blocked", "1");
      });
    };

    const onSubmit = (e: Event) => {
      const target = e.target;
      if (target instanceof HTMLFormElement && target.closest("main") === root) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    syncDisabled();
    const obs = new MutationObserver(syncDisabled);
    obs.observe(root, { childList: true, subtree: true });
    root.addEventListener("submit", onSubmit, true);

    return () => {
      obs.disconnect();
      root.removeEventListener("submit", onSubmit, true);
    };
  }, [isGuest]);

  return (
    <>
      <div className="flex min-h-screen w-full">
        <aside
          data-guest-nav
          className="w-44 border-r border-slate-200 bg-white/80 px-3 py-4 md:w-48 lg:w-52 dark:border-slate-800 dark:bg-slate-900/60"
        >
          <div className="mb-5 px-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">后台管理</p>
            <Link
              href="/"
              data-guest-allow
              className="mt-1 inline-block text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              ← 返回首页
            </Link>
          </div>
          <AdminNav />
        </aside>
        <main ref={mainRef} className="min-w-0 flex-1 p-8">
          {children}
        </main>
      </div>
    </>
  );
}

const MENUS = [
  { href: "/admin/creative-center", label: "创作中心" },
  { href: "/admin/question-bank", label: "考公题库" },
  { href: "/admin/xiaohongshu-posts", label: "小红书帖子" },
  { href: "/admin/scheduler", label: "定时任务" },
  { href: "/admin/prompts", label: "提示词管理" },
] as const;

function AdminNav() {
  return (
    <nav className="flex flex-col gap-1" aria-label="后台菜单" data-guest-nav>
      {MENUS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          data-guest-allow
          className="rounded-lg px-2.5 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
