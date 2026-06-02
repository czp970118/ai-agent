import { NextResponse } from "next/server";
import {
  ACCESS_GATE_COOKIE,
  GUEST_SUB,
  cookieOptions,
  isAccessGateEnabled,
  signAccessJwt,
} from "@/lib/accessGate";

export async function POST() {
  if (!isAccessGateEnabled()) {
    return NextResponse.json({ ok: true, gateEnabled: false });
  }

  try {
    const jwt = await signAccessJwt(GUEST_SUB, "guest");
    const res = NextResponse.json({ ok: true, gateEnabled: true, role: "guest" });
    res.cookies.set(ACCESS_GATE_COOKIE, jwt, cookieOptions());
    return res;
  } catch {
    return NextResponse.json({ error: "ACCESS_GATE_JWT_SECRET not set" }, { status: 500 });
  }
}
