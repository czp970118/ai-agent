import argparse
import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.chat import chat_router
from server.search import search_router
from server.xhs.xhs_scheduler import xhs_scheduler_service


def _load_env_file() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        k = key.strip()
        if not k or k in os.environ:
            continue
        os.environ[k] = value.strip().strip('"').strip("'")


_load_env_file()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

http_app = FastAPI(title="MCP Server HTTP Gateway")
http_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
http_app.include_router(chat_router)
http_app.include_router(search_router)


@http_app.on_event("startup")
async def _on_startup() -> None:
    xhs_scheduler_service.start()


@http_app.on_event("shutdown")
async def _on_shutdown() -> None:
    await xhs_scheduler_service.stop()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run HTTP gateway")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(http_app, host=args.host, port=args.port, reload=False)
