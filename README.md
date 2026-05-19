# ai-Agent

全栈工作区：**Next.js 15** 前端与 **FastAPI（uv / Python 3.12+）** HTTP 网关同仓维护，通过环境变量串联；可选 **Docker Compose** 一键拉起前后端。

## 系统架构

**前后端分离**架构图（左侧 Next 功能面、右侧 FastAPI 路由与调用关系）见本机 **[`docs/system-architecture.md`](docs/system-architecture.md)**（`docs/` 已 gitignore，不随远程仓库分发）。可单独维护，或复制到 [Mermaid Live](https://mermaid.live) 导出 PNG/SVG。

> [!NOTE]
> **本机开发**：通常不经过 Nginx，浏览器直连 `:3000`，`env.compose` 指向本机 `:8000` 的 MCP。**Docker Compose**：`INTERNAL_MCP_URL` 多为 `http://mcp:8000`。

---

## 能力概览

| 区域 | 说明 |
|------|------|
| **聊天** | `POST /chat/stream`（SSE）：多 agent 流式输出，对接 DeepSeek 等模型。 |
| **搜索** | `POST /search/poll`：小红书等场景的搜索与结果轮询。 |
| **访问门禁** | 申请邮箱、管理员审批、激活链接；Next 中间件与 MCP `/access/*` 协同。 |
| **定时任务** | 小红书相关调度在 MCP 进程内启动（见 `main.py` startup）。 |

更细的 API、agent 与封面图 workflow 说明见 [`mcp_server/README.md`](mcp_server/README.md)。Next 侧环境约定见 [`next-project/README.md`](next-project/README.md)。

---

## 仓库结构

```text
.
├── next-project/          # Next.js 应用（App Router、API 路由、门禁中间件）
├── mcp_server/            # FastAPI 网关：chat / search / access / xhs 等
├── scripts/               # 本地开发、部署、数据库同步等 Shell
├── compose.yml            # mcp + next 服务定义
├── compose.cn.yml         # 国内镜像覆盖（与 compose.yml 组合使用）
└── deploy/nginx/          # 生产 Nginx 示例配置
```

---

## 前置要求

- **Node.js 20**（与 `compose.yml` 中 next 镜像一致）
- **Python 3.12+**、[uv](https://docs.astral.sh/uv/)
- 使用 Playwright 相关能力时需按官方文档安装浏览器依赖

---

## 快速开始（本机）

在仓库根目录：

```bash
npm install
npm run dev:local
```

`dev:local` 会并行启动 Next（默认 `http://localhost:3000`）与 MCP（`http://127.0.0.1:8000`）；若缺少 `next-project/env.compose`，脚本会生成模板（含 `NEXT_PUBLIC_MCP_SERVER_URL` / `INTERNAL_MCP_URL`）。

等价命令也可使用根目录 `package.json` 中的 `dev:combined` 或分别执行 `dev:next` / `dev:mcp`。

> [!NOTE]
> 首次使用 MCP 请在 `mcp_server/` 下执行 `uv sync`，并在 **`mcp_server/.env`** 中配置密钥（例如 `DEEPSEEK_API_KEY`）。该文件勿提交版本库。

---

## Docker Compose

```bash
docker compose up -d --build
```

国内网络拉镜像较慢时，可与 `compose.cn.yml` 叠加：

```bash
docker compose -f compose.yml -f compose.cn.yml build
docker compose -f compose.yml -f compose.cn.yml up -d
```

Next 容器读取 **`next-project/env.compose`**；Compose 内 MCP 服务名为 `mcp`，`INTERNAL_MCP_URL` 通常设为 `http://mcp:8000`。

---

## 环境变量（摘要）

### Next（`next-project/env.compose`）

由 `next.config.ts` 在存在时加载；本地与 Compose 共用此文件。

| 变量 | 作用 |
|------|------|
| `NEXT_PUBLIC_MCP_SERVER_URL` | 浏览器访问 MCP 的公网或本机地址 |
| `INTERNAL_MCP_URL` | 服务端反代 MCP（如 `/access/*`） |
| `ACCESS_GATE_ENABLED` | `1` 时启用站点门禁 |
| `ACCESS_GATE_JWT_SECRET` | 门禁 JWT 签名密钥 |
| `SITE_ORIGIN` | 激活重定向站点根（与邮件/公网域名一致，勿用 `0.0.0.0`） |

### MCP（`mcp_server/.env`）

| 变量 | 作用 |
|------|------|
| `DEEPSEEK_API_KEY` | `/chat/stream` 所需 |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-chat` |
| `PUBLIC_SITE_ORIGIN` | 邮件与对外链接使用的站点根 |
| `ACCESS_GATE_*` | 门禁：管理员邮箱、HMAC 密钥、MCP 对外 origin 等 |
| `DASHSCOPE_API_KEY` | 小红书 agent 封面图 workflow 等能力 |

> [!WARNING]
> `env.compose` 与 `.env` 常含密钥与站点配置，请加入 `.gitignore` 并仅在安全渠道分发。

---

## 主要 HTTP 接口（MCP）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/chat/stream` | SSE：`connected` / `delta` / `error` / `end` |
| `POST` | `/search/poll` | 搜索轮询，JSON |
| `POST` | `/access/apply` 等 | 门禁申请与审批（详见 MCP 路由） |

自检示例：

```bash
curl -N -X POST "http://localhost:8000/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"agent":"cases","messages":[{"role":"user","content":"你好"}]}'
```

未配置 `DEEPSEEK_API_KEY` 时会收到 `error` 与 `end` 事件，属预期行为。

---

## 部署与运维

根目录 `scripts/` 提供生产拉代码、Docker 重建、仅 Next/MCP、强制清缓存等脚本，默认远程主机与目录可通过环境变量覆盖（见各脚本内注释）。

示例：`npm run deploy:prod` 调用 `scripts/deploy-prod.sh`。

---

## 延伸阅读

`docs/` 目录已写入 [.gitignore](.gitignore)，仅保留在本地，不会进入远程仓库；下列链接在克隆后的本机 `docs/` 中存在时有效。

- [`docs/interview-prep.md`](docs/interview-prep.md) — 面试口述：架构、SSE/门禁链路、STAR 占位与追问要点  
- [`docs/interview-qna-10.md`](docs/interview-qna-10.md) — 10 道项目面试题与参考答案  
- [`mcp_server/README.md`](mcp_server/README.md) — 路由树、agent、`workflow` 封面图、环境变量与 curl 示例  
- [`next-project/README.md`](next-project/README.md) — Next 与 MCP 环境拆分、门禁与 `SITE_ORIGIN` 说明
