import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

const COOKIE = "access_gate";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (!token?.trim()) {
    return NextResponse.redirect(new URL("/access?e=missing", req.url));
  }

  const base = (process.env.INTERNAL_MCP_URL || "http://localhost:8000").replace(/\/+$/, "");
  const r = await fetch(`${base}/access/consume-activation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token.trim() }),
  });
  if (!r.ok) {
    return NextResponse.redirect(new URL("/access?e=invalid", req.url));
  }
  const body = (await r.json()) as { email?: string };
  const email = body.email;
  if (!email) {
    return NextResponse.redirect(new URL("/access?e=invalid", req.url));
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

  const res = NextResponse.redirect(new URL("/", req.url));
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
