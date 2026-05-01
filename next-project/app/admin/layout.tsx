import Link from "next/link";
import { ReactNode } from "react";

const MENUS = [
  { href: "/admin/xiaohongshu-posts", label: "小红书帖子" },
  { href: "/admin/scheduler", label: "定时任务" },
  { href: "/admin/prompts", label: "提示词管理" },
] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="flex min-h-screen w-full">
        <aside className="w-44 border-r border-slate-200 bg-white/80 px-3 py-4 md:w-48 lg:w-52 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-5 px-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">后台管理</p>
            <Link
              href="/"
              className="mt-1 inline-block text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              ← 返回首页
            </Link>
          </div>
          <nav className="flex flex-col gap-1" aria-label="后台菜单">
            {MENUS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-2.5 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
