# ai-agent

当前仓库已同步两套能力：
- `next-project` 风格的 Next.js 前端（根目录 `app/`、`app/api/assistant` 等）
- `mcp_server` 风格的 Python 网关（根目录 `main.py`、`server/`、`integrations/` 等）

## 前端（Next.js）

```bash
npm install
npm run dev
```

默认启动后访问 [http://localhost:3000](http://localhost:3000)。

## 后端（Python / FastAPI）

```bash
uv sync
python main.py --host 127.0.0.1 --port 8000
```

或使用 uvicorn：

```bash
python -m uvicorn main:http_app --host 127.0.0.1 --port 8000
```

## 核心接口

- `POST /chat/stream`：SSE 流式聊天输出
- `POST /search/poll`：搜索与结果轮询

## 环境变量

- **Next**：统一使用 `next-project/env.compose`（`npm run dev` 与 `compose.yml` 中 next 服务均依赖；由 `next.config.ts` 在存在时加载）。门禁邮件里若链接为本站 `/access/admin`，Next 会按 `INTERNAL_MCP_URL` 反代到 MCP。
- **MCP**：`mcp_server/.env`（与 Next 分离）。
- 重点：`NEXT_PUBLIC_MCP_SERVER_URL`、`INTERNAL_MCP_URL`、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`；启用门禁时配置 `ACCESS_GATE_*`。
- 线上激活重定向：在 `env.compose` 设 **`SITE_ORIGIN=https://www.你的域名`**（与邮件、浏览器一致；勿用 `0.0.0.0`）。
