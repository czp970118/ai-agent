import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_GATE_COOKIE, readAccessSession } from "@/lib/accessGate";

export async function GET() {
  const jar = await cookies();
  const session = await readAccessSession(jar.get(ACCESS_GATE_COOKIE)?.value);
  return NextResponse.json(session);
}
