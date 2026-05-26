import JSZip from "jszip";
import type { DailyQuizSlot } from "./dailyQuizHelpers";
import { toQuizImageDisplayUrl } from "./dailyQuizHelpers";

async function fetchImageBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`无法下载图片 (${res.status})`);
  }
  return res.blob();
}

export async function exportDailyQuizZip(slots: DailyQuizSlot[]): Promise<void> {
  const incomplete = slots.some((s) => !s.questionPath || !s.answerPath);
  if (!slots.length || incomplete) {
    throw new Error("请先生成全部题目的双图后再导出");
  }

  const zip = new JSZip();
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const prefix = String(i + 1).padStart(2, "0");
    const [qBlob, aBlob] = await Promise.all([
      fetchImageBlob(toQuizImageDisplayUrl(slot.questionPath, slot.imageVersion)),
      fetchImageBlob(toQuizImageDisplayUrl(slot.answerPath, slot.imageVersion)),
    ]);
    zip.file(`${prefix}-题目.png`, qBlob);
    zip.file(`${prefix}-答案解析.png`, aBlob);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `每日一题-${stamp}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}
