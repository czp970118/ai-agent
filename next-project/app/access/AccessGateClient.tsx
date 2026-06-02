"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { useGuestMode } from "./GuestModeContext";

export default function AccessGateClient() {
  const sp = useSearchParams();
  const err = sp.get("e");
  const { refresh } = useGuestMode();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [errLocal, setErrLocal] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const busy = loading || guestLoading;

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

  async function enterGuest() {
    setErrLocal(null);
    setGuestLoading(true);
    try {
      const res = await fetch("/api/access/guest", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setErrLocal(data.error || `访客进入失败（${res.status}）`);
        return;
      }
      await refresh();
      window.location.href = "/";
    } catch {
      setErrLocal("网络错误，请稍后重试。");
    } finally {
      setGuestLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06080d] text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        aria-hidden
        style={{
          backgroundImage: `radial-gradient(circle at 20% 18%, rgba(245, 158, 11, 0.14), transparent 45%),
            radial-gradient(circle at 85% 8%, rgba(56, 189, 248, 0.1), transparent 40%),
            linear-gradient(180deg, rgba(15, 23, 42, 0.25), transparent 55%)`,
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-14 sm:px-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-amber-400/90">
          Private access
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50 sm:text-[2rem]">
          访问前请先申请
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          审批通过后邮件会发送激活链接；已通过审核可再次提交同一邮箱，在新设备上收取链接。
          也可使用访客模式预览（AI 可用，后台仅浏览）。
        </p>

        {(errHint || errLocal) && (
          <div
            className="mt-6 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-100"
            role="alert"
          >
            {errLocal || errHint}
          </div>
        )}
        {msg && (
          <div
            className="mt-6 rounded-xl border border-emerald-500/35 bg-emerald-950/35 px-4 py-3 text-sm text-emerald-100"
            role="status"
          >
            {msg}
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className="mt-8 space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm"
        >
          <label htmlFor="access-email" className="block text-xs font-medium uppercase tracking-wider text-slate-500">
            工作邮箱
          </label>
          <input
            id="access-email"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[15px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-500/15 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "提交中…" : "发送申请 / 收取激活邮件"}
          </button>

          <div className="flex items-center gap-3 py-0.5 text-xs text-slate-500">
            <span className="h-px flex-1 bg-white/10" aria-hidden />
            或
            <span className="h-px flex-1 bg-white/10" aria-hidden />
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void enterGuest()}
            className="w-full rounded-xl border border-slate-500/50 bg-slate-800/50 px-4 py-3 text-sm font-medium text-slate-100 transition hover:border-slate-400 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {guestLoading ? "进入中…" : "访客模式进入"}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-slate-600">
          换设备时，用同一邮箱再提交一次即可收到新激活链接。
        </p>
        <p className="mt-4 text-center">
          <Link
            href="/"
            className="text-xs text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline"
          >
            返回首页（需已通过并激活）
          </Link>
        </p>
      </div>
    </div>
  );
}
