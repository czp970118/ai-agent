import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_GATE_COOKIE,
  cookieOptions,
  signAccessJwt,
} from "@/lib/accessGate";

/** 重定向用站点根：优先 SITE_ORIGIN（与邮件里公网一致），避免 req.url 在错误 Host（如 0.0.0.0）下拼错。 */
function siteRoot(req: NextRequest): string {
  const explicit = (process.env.SITE_ORIGIN || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const xfHost = req.headers.get("x-forwarded-host");
  const xfProto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  if (xfHost) {
    const host = xfHost.split(",")[0].trim();
    if (host) return `${xfProto}://${host}`;
  }
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const root = siteRoot(req);
  const token = req.nextUrl.searchParams.get("t");
  if (!token?.trim()) {
    return NextResponse.redirect(new URL("/access?e=missing", root));
  }

  const base = (process.env.INTERNAL_MCP_URL || "http://localhost:8000").replace(/\/+$/, "");
  const r = await fetch(`${base}/access/consume-activation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token.trim() }),
  });
  if (!r.ok) {
    return NextResponse.redirect(new URL("/access?e=invalid", root));
  }
  const body = (await r.json()) as { email?: string };
  const email = body.email;
  if (!email) {
    return NextResponse.redirect(new URL("/access?e=invalid", root));
  }

  let jwt: string;
  try {
    jwt = await signAccessJwt(email, "member");
  } catch {
    return NextResponse.json({ error: "ACCESS_GATE_JWT_SECRET not set" }, { status: 500 });
  }

  const res = NextResponse.redirect(new URL("/", root));
  res.cookies.set(ACCESS_GATE_COOKIE, jwt, cookieOptions(60 * 60 * 24 * 30));
  return res;
}
