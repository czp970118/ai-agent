import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

const COOKIE = "access_gate";

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

  const secret = process.env.ACCESS_GATE_JWT_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "ACCESS_GATE_JWT_SECRET not set" }, { status: 500 });
  }

  const jwt = await new SignJWT({ sub: email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));

  const res = NextResponse.redirect(new URL("/", root));
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(COOKIE, jwt, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
