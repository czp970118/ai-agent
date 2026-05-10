import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col p-8 sm:p-12">
      <header className="w-full text-center mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          欢迎使用
        </h1>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
          请选择要进入的功能
        </p>
      </header>

      <div className="w-full max-w-md ml-auto">
        <nav className="flex flex-col gap-2.5" aria-label="功能入口">
          <Link
            href="/assistant/xiaohongshu"
            className="group flex items-center gap-3 rounded-xl border border-black/[.08] dark:border-white/[.145] bg-background py-3 px-4 transition-colors hover:border-transparent hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-base"
              aria-hidden
            >
              📕
            </span>
            <div className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-medium text-foreground leading-snug">
                小红书自动生成
              </span>
              <span className="mt-0.5 block text-xs text-neutral-600 dark:text-neutral-400 truncate">
                AI 生成小红书风格内容
              </span>
            </div>
            <span
              className="shrink-0 text-sm font-medium text-foreground group-hover:underline underline-offset-2"
              aria-hidden
            >
              →
            </span>
          </Link>

          <Link
            href="/assistant/cases"
            className="group flex items-center gap-3 rounded-xl border border-black/[.08] dark:border-white/[.145] bg-background py-3 px-4 transition-colors hover:border-transparent hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-base"
              aria-hidden
            >
              🔎
            </span>
            <div className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-medium text-foreground leading-snug">
                法律案例查询
              </span>
              <span className="mt-0.5 block text-xs text-neutral-600 dark:text-neutral-400 truncate">
                检索并解读法律案例要点
              </span>
            </div>
            <span
              className="shrink-0 text-sm font-medium text-foreground group-hover:underline underline-offset-2"
              aria-hidden
            >
              →
            </span>
          </Link>

          <Link
            href="/admin"
            className="group flex items-center gap-3 rounded-xl border border-black/[.08] dark:border-white/[.145] bg-background py-3 px-4 transition-colors hover:border-transparent hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-base"
              aria-hidden
            >
              ⚙️
            </span>
            <div className="min-w-0 flex-1 text-left">
              <span className="block text-[15px] font-medium text-foreground leading-snug">
                后台管理
              </span>
              <span className="mt-0.5 block text-xs text-neutral-600 dark:text-neutral-400 truncate">
                管理小红书帖子与提示词
              </span>
            </div>
            <span
              className="shrink-0 text-sm font-medium text-foreground group-hover:underline underline-offset-2"
              aria-hidden
            >
              →
            </span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
