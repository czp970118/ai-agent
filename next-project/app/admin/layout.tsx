import AdminGuestShell from "./AdminGuestShell";
import { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AdminGuestShell>{children}</AdminGuestShell>
    </div>
  );
}
