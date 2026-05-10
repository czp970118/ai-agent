import { Suspense } from "react";
import AccessGateClient from "./AccessGateClient";

export const dynamic = "force-dynamic";

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#06080d] text-slate-400">
      加载…
    </div>
  );
}

export default function AccessGatePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <AccessGateClient />
    </Suspense>
  );
}
