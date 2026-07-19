"use client";

import Link from "next/link";
import { useGuestMode } from "@/app/access/GuestModeContext";

export default function GuestFormalAccessEntry() {
  const { loading, gateEnabled, isGuest } = useGuestMode();
  if (loading || !gateEnabled || !isGuest) return null;

  return (
    <p className="mx-auto mt-6 w-full max-w-3xl text-center sm:mt-8">
      <Link
        href="/access"
        className="inline-flex items-center gap-1 text-sm text-amber-700 underline-offset-4 transition hover:underline dark:text-amber-400"
      >
        申请正式访问
        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
            clipRule="evenodd"
          />
        </svg>
      </Link>
    </p>
  );
}
