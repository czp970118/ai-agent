import { type NextRequest, NextResponse } from "next/server";
import {
  ACCESS_GATE_COOKIE,
  isAccessGateEnabled,
  verifyAccessJwt,
} from "@/lib/accessGate";

export async function middleware(request: NextRequest) {
  if (!isAccessGateEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/access") ||
    pathname.startsWith("/api/access") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const raw = request.cookies.get(ACCESS_GATE_COOKIE)?.value;
  if (!raw) {
    return NextResponse.redirect(new URL("/access", request.url));
  }

  const payload = await verifyAccessJwt(raw);
  if (!payload) {
    const res = NextResponse.redirect(new URL("/access?e=session", request.url));
    res.cookies.delete(ACCESS_GATE_COOKIE);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
