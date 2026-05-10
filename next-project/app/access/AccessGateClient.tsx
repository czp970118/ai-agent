"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export default function AccessGateClient() {
  const sp = useSearchParams();
  const err = sp.get("e");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [errLocal, setErrLocal] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const errHint =
    err === "missing"
      ? "激活链接不完整。"
      : err === "invalid"
        ? "激活链接无效或已使用。"
        : err === "session"
          ? "登录状态已失效，请重新申请或再次打开激活邮件中的链接。"
          : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrLocal(null);
    setMsg(null);
    const v = email.trim().toLowerCase();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setErrLocal("请输入有效邮箱地址。");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/access/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v }),
      });
      const data = (await res.json()) as {
        message?: string;
        detail?: string | unknown;
        error?: string;
      };
      if (!res.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((x) => (typeof x === "object" && x && "msg" in x ? String((x as { msg: string }).msg) : "")).join("; ")
              : "";
        setErrLocal(detail || data.error || `请求失败（${res.status}）`);
        return;
      }
      setMsg(typeof data.message === "string" ? data.message : "已提交申请。");
      setEmail("");
    } catch {
      setErrLocal("网络错误，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06080d] text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 20%, rgba(245, 158, 11, 0.12), transparent 42%),
            radial-gradient(circle at 80% 0%, rgba(56, 189, 248, 0.08), transparent 38%),
            linear-gradient(180deg, rgba(15, 23, 42, 0.2), transparent)`,
        }}
      />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-400/90">
          Private access
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          访问前请先申请
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          提交邮箱后，管理员会收到邮件。通过审批后，你会收到<strong className="text-slate-200">激活链接</strong>
          ，在<strong className="text-slate-200">当前浏览器</strong>中打开一次即可进入站点（Cookie 约 30 天有效）。
          若已通过审核，仍可在下方用<strong className="text-slate-200">同一邮箱</strong>再发一封激活邮件，用于手机、另一台电脑等新设备。
        </p>

        {(errHint || errLocal) && (
          <div
            className="mt-8 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-100"
            role="alert"
          >
            {errLocal || errHint}
          </div>
        )}

        {msg && (
          <div className="mt-8 rounded-xl border border-emerald-500/35 bg-emerald-950/35 px-4 py-3 text-sm text-emerald-100">
            {msg}
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className="mt-10 space-y-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm"
        >
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-500">
            工作邮箱
          </label>
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[15px] text-slate-100 outline-none ring-amber-400/0 transition placeholder:text-slate-600 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/25"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "提交中…" : "发送申请 / 收取激活邮件"}
          </button>
        </form>

        <p className="mt-10 text-center text-xs text-slate-600">
          首次通过审批后，邮件里会有一条激活链接；换设备时在上方再提交一次同一邮箱即可收到<strong className="text-slate-400">新激活链接</strong>。
        </p>
        <p className="mt-6 text-center">
          <Link href="/" className="text-xs text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline">
            返回首页（需已通过并激活）
          </Link>
        </p>
      </div>
    </div>
  );
}
