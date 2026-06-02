"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { GUEST_USER_ID } from "@/lib/accessGate";

const GUEST_MODE_KEY = "ai_agent_guest_mode";
const LOGIN_USER_ID_KEY = "ai_agent_login_user_id";

export type GuestModeState = {
  loading: boolean;
  gateEnabled: boolean;
  isGuest: boolean;
  refresh: () => Promise<void>;
};

const GuestModeContext = createContext<GuestModeState>({
  loading: true,
  gateEnabled: false,
  isGuest: false,
  refresh: async () => {},
});

export function GuestModeProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [gateEnabled, setGateEnabled] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/access/session", { cache: "no-store" });
      const data = (await res.json()) as {
        gateEnabled?: boolean;
        role?: string | null;
      };
      const enabled = Boolean(data.gateEnabled);
      const guest = enabled && data.role === "guest";
      setGateEnabled(enabled);
      setIsGuest(guest);
      if (typeof window !== "undefined") {
        if (guest) {
          window.localStorage.setItem(GUEST_MODE_KEY, "1");
          window.localStorage.setItem(LOGIN_USER_ID_KEY, GUEST_USER_ID);
        } else {
          window.localStorage.removeItem(GUEST_MODE_KEY);
        }
      }
    } catch {
      setGateEnabled(false);
      setIsGuest(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ loading, gateEnabled, isGuest, refresh }),
    [loading, gateEnabled, isGuest, refresh],
  );

  return <GuestModeContext.Provider value={value}>{children}</GuestModeContext.Provider>;
}

export function useGuestMode(): GuestModeState {
  return useContext(GuestModeContext);
}
