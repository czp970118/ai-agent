import { Suspense } from "react";
import DailyQuizClient from "./DailyQuizClient";

export default function AdminDailyQuizPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500 dark:text-slate-400">加载中…</div>}>
      <DailyQuizClient />
    </Suspense>
  );
}
