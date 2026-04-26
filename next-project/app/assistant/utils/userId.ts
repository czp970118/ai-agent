const ANON_USER_ID_KEY = "ai_agent_anon_user_id";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const rnd = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${rnd(8)}-${rnd(4)}-4${rnd(3)}-${rnd(4)}-${rnd(12)}`;
}

export function getAnonUserId(): string {
  if (typeof window === "undefined") return "";
  let value = window.localStorage.getItem(ANON_USER_ID_KEY);
  if (!value) {
    value = generateUuid();
    window.localStorage.setItem(ANON_USER_ID_KEY, value);
  }
  return value;
}
