---
name: architecture-streaming-refactor
description: Refactors frontend-backend-workflow boundaries for streaming chat architecture. Use when the user asks to move text generation to mcp_server, keep n8n for orchestration, or implement SSE typing responses.
---

# Architecture Streaming Refactor

## Purpose
Define and execute architecture refactors where:
- frontend directly consumes streaming responses from `mcp_server`
- `n8n` focuses on orchestration and lightweight non-blocking tasks
- LLM summarization and text generation run in `mcp_server`

## Default Workflow
1. Identify current responsibilities of frontend, `mcp_server`, and `n8n`.
2. Design interface contracts first:
   - frontend -> `mcp_server` stream API
   - optional `mcp_server` -> `n8n` preprocess hook
   - optional `mcp_server` -> `n8n` postprocess hook
3. Move generation logic to `mcp_server` with SSE token events.
4. Keep `n8n` limited to formatting, routing, and asynchronous side effects.
5. Verify stop/cancel behavior and error propagation in streaming path.

## Streaming Contract (Recommended)
- `event: connected` for handshake metadata
- `event: delta` for token chunks
- `event: error` for user-facing failures
- `event: end` for final completion payload

## Guardrails
- Do not block user-visible stream on slow postprocess tasks.
- Keep preprocess fast and deterministic; set strict timeout.
- Provide fallback behavior when n8n hooks are unavailable.
- Prefer explicit JSON payload schemas between services.

## Acceptance Checklist
- Frontend shows typing effect from real token deltas.
- Aborting request stops server-side stream cleanly.
- n8n is not in the critical path of token delivery.
- Final response quality remains stable after migration.
