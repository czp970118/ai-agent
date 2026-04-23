# ai-Agent

统一仓库，包含前端应用与 Python 网关服务。

## 目录结构

- `next-project`：Next.js 前端项目。
- `mcp_server`：FastAPI 网关与业务服务。
- `n8n-local`：本地工作流与相关依赖配置。

## 快速开始

### 1) 前端（Next.js）

```bash
cd next-project
npm install
npm run dev
```

默认访问：`http://localhost:3000`

### 2) 后端（Python / FastAPI）

```bash
cd mcp_server
uv sync
python main.py --host 127.0.0.1 --port 8000
```

或使用：

```bash
python -m uvicorn main:http_app --host 127.0.0.1 --port 8000
```

## 主要接口

- `POST /chat/stream`：SSE 流式聊天输出。
- `POST /search/poll`：搜索与结果轮询。

## 环境变量

参考 `mcp_server/.env.example`，常用变量包括：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `N8N_PREPROCESS_WEBHOOK_URL`
- `N8N_POSTPROCESS_WEBHOOK_URL`
