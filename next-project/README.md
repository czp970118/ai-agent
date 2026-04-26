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

参考 `.env.example`，重点变量：
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
