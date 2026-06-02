import Link from "next/link";
import GuestFormalAccessEntry from "./components/GuestFormalAccessEntry";

const ENTRIES = [
  {
    href: "/assistant/xiaohongshu",
    icon: "📕",
    iconClass: "bg-rose-100 dark:bg-rose-950/50",
    title: "小红书自动生成",
    desc: "AI 生成小红书风格内容",
  },
  {
    href: "/assistant/cases",
    icon: "🔎",
    iconClass: "bg-teal-100 dark:bg-teal-950/50",
    title: "法律案例查询",
    desc: "检索并解读法律案例要点",
  },
  {
    href: "/admin",
    icon: "⚙️",
    iconClass: "bg-slate-200 dark:bg-slate-800",
    title: "后台管理",
    desc: "管理小红书帖子与提示词",
  },
] as const;

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-50 text-foreground dark:bg-[#06080d] dark:text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-40"
        aria-hidden
        style={{
          backgroundImage: `radial-gradient(circle at 15% 10%, rgba(244, 63, 94, 0.08), transparent 42%),
            radial-gradient(circle at 88% 12%, rgba(20, 184, 166, 0.07), transparent 38%),
            radial-gradient(circle at 50% 100%, rgba(148, 163, 184, 0.12), transparent 50%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-0 dark:opacity-100"
        aria-hidden
        style={{
          backgroundImage: `radial-gradient(circle at 20% 18%, rgba(245, 158, 11, 0.1), transparent 45%),
            radial-gradient(circle at 85% 8%, rgba(56, 189, 248, 0.08), transparent 40%)`,
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-5 py-12 sm:px-8 lg:py-16">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-400 dark:text-amber-400/80">
            Ai-Agent
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
            欢迎使用
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-slate-400 sm:text-base">
            请选择要进入的功能
          </p>
        </header>

        <GuestFormalAccessEntry />

        <nav
          className="mx-auto mt-8 grid w-full max-w-lg grid-cols-1 gap-3 sm:mt-10 md:max-w-3xl md:grid-cols-3 md:gap-4 lg:mt-12"
          aria-label="功能入口"
        >
          {ENTRIES.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 rounded-xl border border-black/[0.08] bg-white/90 px-4 py-3.5 shadow-sm backdrop-blur-sm transition hover:border-black/15 hover:shadow-md dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20 dark:hover:bg-white/[0.07] md:flex-col md:items-start md:gap-4 md:px-5 md:py-5 lg:min-h-[168px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              <span
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg ${item.iconClass}`}
                aria-hidden
              >
                {item.icon}
              </span>
              <div className="min-w-0 flex-1 md:w-full">
                <span className="block text-[15px] font-medium leading-snug sm:text-base">
                  {item.title}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-neutral-600 dark:text-slate-400 sm:text-sm">
                  {item.desc}
                </span>
              </div>
              <span
                className="shrink-0 text-sm font-medium text-neutral-500 transition group-hover:text-foreground group-hover:translate-x-0.5 dark:text-slate-500 dark:group-hover:text-slate-200 md:mt-auto"
                aria-hidden
              >
                →
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
