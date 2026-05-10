import type { NextConfig } from "next";
import { existsSync, readFileSync } from "fs";
import path from "path";

/** 与 Docker Compose 共用 next-project/env.compose；不设则不注入。 */
function loadEnvCompose(): void {
  const fp = path.join(process.cwd(), "env.compose");
  if (!existsSync(fp)) return;
  const text = readFileSync(fp, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvCompose();

/** 审批页在 MCP；邮件里用站点根（如 localhost:3000）时由 Next 反代到 INTERNAL_MCP_URL。 */
function mcpBaseUrl(): string {
  return (process.env.INTERNAL_MCP_URL || "http://localhost:8000").replace(/\/+$/, "");
}

const nextConfig: NextConfig = {
  devIndicators: false, // 关闭左下角开发模式 N 图标
  async rewrites() {
    const base = mcpBaseUrl();
    return [
      {
        source: "/access/admin",
        destination: `${base}/access/admin`,
      },
    ];
  },
};

export default nextConfig;
