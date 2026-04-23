import { NextRequest } from "next/server";
import { fetchWorkflowStatus } from "../_lib/n8n";

export const runtime = "nodejs";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const encoder = new TextEncoder();

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return new Response("缺少 jobId", { status: 400 });
  }

  const intervalMs = Number(process.env.WORKFLOW_SSE_POLL_INTERVAL_MS ?? 2000);
  const timeoutMs = Number(process.env.WORKFLOW_SSE_TIMEOUT_MS ?? 10 * 60 * 1000);

  let timer: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        if (timeout) clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // no-op
        }
      };

      const pushStatus = async () => {
        try {
          const payload = await fetchWorkflowStatus(jobId);
          controller.enqueue(encoder.encode(sse("status", payload)));

          if (payload.status === "done" || payload.status === "failed") {
            controller.enqueue(encoder.encode(sse("end", payload)));
            close();
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "SSE 查询状态失败";
          controller.enqueue(encoder.encode(sse("error", { jobId, error: message })));
          close();
        }
      };

      controller.enqueue(
        encoder.encode(
          sse("connected", {
            jobId,
            intervalMs,
            timeoutMs,
          })
        )
      );

      void pushStatus();
      timer = setInterval(() => {
        void pushStatus();
      }, intervalMs);

      timeout = setTimeout(() => {
        controller.enqueue(
          encoder.encode(
            sse("timeout", {
              jobId,
              error: "SSE 订阅超时，请重新订阅",
            })
          )
        );
        close();
      }, timeoutMs);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      if (timer) clearInterval(timer);
      if (timeout) clearTimeout(timeout);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
