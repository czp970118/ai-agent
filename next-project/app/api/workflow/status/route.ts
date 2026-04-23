import { NextRequest, NextResponse } from "next/server";
import { fetchWorkflowStatus } from "../_lib/n8n";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
    if (!jobId) {
      return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });
    }

    const status = await fetchWorkflowStatus(jobId);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询工作流状态失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
