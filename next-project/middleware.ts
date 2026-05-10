import { type NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE = "access_gate";

export async function middleware(request: NextRequest) {
  if (process.env.ACCESS_GATE_ENABLED !== "1") {
    return NextResponse.next();
  }
  const secret = process.env.ACCESS_GATE_JWT_SECRET;
  if (!secret || secret.length < 16) {
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

  const raw = request.cookies.get(COOKIE)?.value;
  if (!raw) {
    return NextResponse.redirect(new URL("/access", request.url));
  }

  try {
    const { payload } = await jwtVerify(raw, new TextEncoder().encode(secret));
    if (!payload.sub || typeof payload.sub !== "string") {
      throw new Error("missing sub");
    }
    return NextResponse.next();
  } catch {
    const res = NextResponse.redirect(new URL("/access?e=session", request.url));
    res.cookies.delete(COOKIE);
    return res;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
