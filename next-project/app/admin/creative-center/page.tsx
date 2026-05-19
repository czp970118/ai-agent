import { Suspense } from "react";
import CreativeCenterHubClient from "./CreativeCenterHubClient";

export default function AdminCreativeCenterPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-slate-500 dark:text-slate-400">
          加载中…
        </div>
      }
    >
      <CreativeCenterHubClient />
    </Suspense>
  );
}
