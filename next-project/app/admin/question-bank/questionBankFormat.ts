export function isQuestionUsed(usedAt: string | undefined): boolean {
  return Boolean(String(usedAt || "").trim());
}

export function formatQuestionUsedAt(usedAt: string | undefined): string {
  const raw = String(usedAt || "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
