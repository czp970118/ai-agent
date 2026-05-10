import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const base = (process.env.INTERNAL_MCP_URL || "http://localhost:8000").replace(/\/+$/, "");
  const r = await fetch(`${base}/access/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: unknown = { raw: text };
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text in object */
  }
  return NextResponse.json(data as object, { status: r.status });
}
