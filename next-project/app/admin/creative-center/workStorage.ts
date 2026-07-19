import { ccFetch } from "./creativeCenterClient";

export type PlatformId = "xhs" | "douyin";

export type WorkStatus = "draft" | "ready";

export type CreativeWork = {
  id: string;
  title: string;
  prompt: string;
  body: string;
  domain: string;
  status: WorkStatus;
  platform: PlatformId;
  createdAt?: number;
  updatedAt: number;
  coverPath?: string;
  coverSource?: string;
  coverTemplateId?: string;
  coverRefUrls?: string[];
  coverTitleMain?: string;
  coverTitleSub?: string;
};

export const PLATFORM_META: Record<PlatformId, { label: string; chipClass: string }> = {
  xhs: {
    label: "小红书",
    chipClass: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
  },
  douyin: {
    label: "抖音",
    chipClass: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-100",
  },
};

export async function listWorks(): Promise<CreativeWork[]> {
  return ccFetch<CreativeWork[]>("");
}

export async function getWork(workId: string): Promise<CreativeWork | null> {
  try {
    return await ccFetch<CreativeWork>(`/${encodeURIComponent(workId)}`);
  } catch {
    return null;
  }
}

export async function createWork(input: {
  id?: string;
  title: string;
  prompt?: string;
  body?: string;
  domain?: string;
  status?: WorkStatus;
  platform?: PlatformId;
  coverPath?: string;
  coverSource?: string;
  coverTemplateId?: string;
  coverRefUrls?: string[];
  coverTitleMain?: string;
  coverTitleSub?: string;
}): Promise<CreativeWork> {
  return ccFetch<CreativeWork>("", {
    method: "POST",
    body: JSON.stringify({
      id: input.id,
      title: input.title,
      prompt: input.prompt,
      body: input.body,
      domain: input.domain,
      status: input.status,
      platform: input.platform,
      coverPath: input.coverPath,
      coverSource: input.coverSource,
      coverTemplateId: input.coverTemplateId,
      coverRefUrls: input.coverRefUrls,
      coverTitleMain: input.coverTitleMain,
      coverTitleSub: input.coverTitleSub,
    }),
  });
}

export async function updateWork(
  workId: string,
  patch: Partial<
    Pick<
      CreativeWork,
      | "title"
      | "prompt"
      | "body"
      | "domain"
      | "status"
      | "platform"
      | "coverPath"
      | "coverSource"
      | "coverTemplateId"
      | "coverRefUrls"
      | "coverTitleMain"
      | "coverTitleSub"
    >
  >,
): Promise<CreativeWork> {
  return ccFetch<CreativeWork>(`/${encodeURIComponent(workId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteWork(workId: string): Promise<void> {
  await ccFetch<{ ok: boolean }>(`/${encodeURIComponent(workId)}`, {
    method: "DELETE",
  });
}
