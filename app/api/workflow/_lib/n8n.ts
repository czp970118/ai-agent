type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type WorkflowStartResponse = {
  jobId: string;
  accepted?: boolean;
  [key: string]: JsonValue | undefined;
};

export type WorkflowStatusResponse = {
  jobId: string;
  status: "pending" | "running" | "done" | "failed";
  progress?: number;
  message?: string;
  result?: JsonValue;
  error?: string;
  [key: string]: JsonValue | undefined;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量: ${name}`);
  }
  return value;
}

export function getStartWebhookUrl(): string {
  return requiredEnv("N8N_WEBHOOK_START_URL");
}

export function buildStatusUrl(jobId: string): string {
  const template = requiredEnv("N8N_WEBHOOK_STATUS_URL_TEMPLATE");
  return template.replace("{jobId}", encodeURIComponent(jobId));
}

export async function startWorkflow(payload: unknown): Promise<WorkflowStartResponse> {
  const response = await fetch(getStartWebhookUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    cache: "no-store",
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`启动工作流失败(${response.status}): ${err}`);
  }

  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error("n8n start webhook 返回为空，请检查 Respond Start 节点的 JSON 响应配置");
  }

  let data: Partial<WorkflowStartResponse>;
  try {
    data = JSON.parse(raw) as Partial<WorkflowStartResponse>;
  } catch {
    throw new Error(`n8n start webhook 返回不是有效 JSON: ${raw}`);
  }

  if (!data?.jobId || typeof data.jobId !== "string") {
    throw new Error("n8n start webhook 返回缺少 jobId");
  }
  return { ...data, jobId: data.jobId, accepted: true } as WorkflowStartResponse;
}

export async function fetchWorkflowStatus(jobId: string): Promise<WorkflowStatusResponse> {
  const response = await fetch(buildStatusUrl(jobId), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`查询状态失败(${response.status}): ${err}`);
  }

  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error("n8n status webhook 返回为空，请检查 Respond Status 节点的 JSON 响应配置");
  }

  let data: Partial<WorkflowStatusResponse>;
  try {
    data = JSON.parse(raw) as Partial<WorkflowStatusResponse>;
  } catch {
    throw new Error(`n8n status webhook 返回不是有效 JSON: ${raw}`);
  }

  if (!data?.status || typeof data.status !== "string") {
    throw new Error("n8n status webhook 返回缺少 status");
  }
  return {
    jobId,
    ...data,
  } as WorkflowStatusResponse;
}
