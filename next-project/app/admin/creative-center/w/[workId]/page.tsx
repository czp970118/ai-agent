import { Suspense } from "react";
import WorkEditorClient from "./WorkEditorClient";

export default function CreativeWorkPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-slate-500 dark:text-slate-400">加载中…</div>
      }
    >
      <WorkEditorClient />
    </Suspense>
  );
}
