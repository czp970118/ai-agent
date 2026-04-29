export function getMcpBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://127.0.0.1";
}
