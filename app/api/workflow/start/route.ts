import { NextRequest, NextResponse } from "next/server";
import { startWorkflow } from "../_lib/n8n";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const started = await startWorkflow(body);
    return NextResponse.json(started, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "启动工作流失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
