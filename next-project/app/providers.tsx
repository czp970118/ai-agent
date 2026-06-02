"use client";

import { GuestModeProvider } from "./access/GuestModeContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return <GuestModeProvider>{children}</GuestModeProvider>;
}
