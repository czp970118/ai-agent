import { getAnonUserId } from "./userId";

const LOGIN_USER_ID_KEY = "ai_agent_login_user_id";

export function getSessionUserId(): string {
  if (typeof window === "undefined") return "";
  const fromStorage = window.localStorage.getItem(LOGIN_USER_ID_KEY)?.trim();
  if (fromStorage) return fromStorage;
  return getAnonUserId();
}
