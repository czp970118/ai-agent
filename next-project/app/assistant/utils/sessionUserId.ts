import { GUEST_USER_ID } from "@/lib/accessGate";
import { getAnonUserId } from "./userId";

const LOGIN_USER_ID_KEY = "ai_agent_login_user_id";
const GUEST_MODE_KEY = "ai_agent_guest_mode";

export function getSessionUserId(): string {
  if (typeof window === "undefined") return "";
  if (window.localStorage.getItem(GUEST_MODE_KEY) === "1") {
    return GUEST_USER_ID;
  }
  const fromStorage = window.localStorage.getItem(LOGIN_USER_ID_KEY)?.trim();
  if (fromStorage) return fromStorage;
  return getAnonUserId();
}
