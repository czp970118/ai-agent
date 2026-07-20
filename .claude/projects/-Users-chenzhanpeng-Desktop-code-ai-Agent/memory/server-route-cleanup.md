---
name: server-route-cleanup
description: 删除了 11 条未使用路由及 store 层配套死代码
metadata:
  type: reference
---

删除了 `mcp_server/` 中 11 条未被前端调用的 FastAPI 路由及对应的 store 层死代码。按模块分布：search 4 条、questions 5 条、chat 2 条。同步清理了 `batch_update_selected`、`list_recent_imports`、`save_scheduler_config`、`list_recent_scheduler_runs`、`update_category`、`delete_category`、`run_task_now`、`mark_task_slot_running` 8 个函数，以及 `SearchPollRequest`、`SchedulerConfigPatchRequest`、`BatchSelectedPatch`、`PromptCategoryPatch` 4 个 Pydantic 模型。提交为 `b5bef11`。

**Why:** 后端定义了路由但前端从未调用，属于死代码，增加维护负担。

**How to apply:** 以后新增路由时确认前端是否有对应调用；如果路由仅供内部逻辑使用，应直接作为 Python 函数调用而非走 HTTP。
