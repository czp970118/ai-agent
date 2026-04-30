# mcp_server

`mcp_server` 是当前项目的 Python HTTP 网关，负责：
- 暴露对外 API（聊天流式 + 搜索聚合）
- 对接 DeepSeek 流式生成

## 目录结构

```text
mcp_server/
├─ main.py                         # 装配层：创建 FastAPI、挂载路由、启动服务
├─ .env.example                    # 环境变量示例
├─ AGENT_PROMPT/
│  └─ xiaohongshu-content-publish.SKILL.md
├─ server/
│  ├─ constants.py                 # 常量与提示词加载逻辑
│  ├─ chat/
│  │  └─ routes.py                 # /chat/stream（SSE）
│  ├─ search/
│  │  └─ routes.py                 # /search/poll
│  ├─ xhs/                         # 小红书相关抓取与处理实现
│  └─ qcc/                         # 企查查相关实现
└─ json/                           # 本地输出缓存目录
```

## API

### 1) `POST /chat/stream`

流式聊天接口（SSE），用于前端打字机效果。

- 请求体（示例）：

```json
{
  "agent": "xiaohongshu",
  "messages": [
    {"role": "user", "content": "帮我写一篇河内3天旅游攻略"}
  ],
  "workflow": {}
}
```

- 事件流：
  - `connected`：握手成功
  - `delta`：增量 token
  - `error`：错误信息
  - `end`：结束（含最终内容）

### 2) `POST /search/poll`

小红书搜索+详情轮询接口，返回结构化 JSON（若结果为 `output_path` 会自动展开文件内容）。

## 提示词来源

`xiaohongshu` agent 的系统提示词来自：

- `AGENT_PROMPT/xiaohongshu-content-publish.SKILL.md`

加载逻辑在 `server/constants.py`，读取失败时会回退到内置 fallback 提示词。

## 环境变量

参考 `.env.example`，核心项如下：

- `DEEPSEEK_API_KEY`：必填，`/chat/stream` 依赖
- `DEEPSEEK_MODEL`：可选，默认 `deepseek-chat`
- `XHS_STORAGE_STATE`：可选，默认 `server/xhs/xhs_storage_state.json`
- `QCC_STORAGE_STATE`：可选，默认 `server/qcc/qcc_storage_state.json`

## 启动

在仓库根目录执行：

```bash
uv run --directory mcp_server python main.py --host 127.0.0.1 --port 8000
```

或：

```bash
uv run --directory mcp_server python -m uvicorn main:http_app --host 127.0.0.1 --port 8000
```

## 快速自检

```bash
curl -N -X POST "http://127.0.0.1:8000/chat/stream" \
  -H "Content-Type: application/json" \
  -d '{"agent":"cases","messages":[{"role":"user","content":"你好"}]}'
```

如果未配置 `DEEPSEEK_API_KEY`，会收到 `error` + `end` 事件，这是预期行为。

## 小红书文案 + 封面图联动（新增）

`agent=xiaohongshu` 时，可在 `workflow` 里开启封面图生成：

```json
{
  "agent": "xiaohongshu",
  "messages": [{"role": "user", "content": "写一篇考公上岸经验"}],
  "workflow": {
    "generate_cover_image": true,
    "cover": {
      "style": "notion",
      "layout": "sparse",
      "palette": "macaron",
      "title_main": "应届生3个月上岸考公",
      "title_sub": "行测申论双70+｜我的复习路径公开"
    }
  }
}
```

说明：
- 会先写 prompt 到 `image-cards/{slug}/prompts/01-cover-{slug}.md`，再调用 `scripts/z-image-turbo.sh` 出图。
- 出图结果会在 SSE 的 `end` 事件中返回 `cover_image` 字段。
- 需要配置 `DASHSCOPE_API_KEY`。