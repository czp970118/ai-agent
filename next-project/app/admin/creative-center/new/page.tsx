import { Suspense } from "react";
import NewWorkClient from "./NewWorkClient";

export default function AdminCreativeCenterNewPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-slate-500 dark:text-slate-400">加载中…</div>
      }
    >
      <NewWorkClient />
    </Suspense>
  );
}
