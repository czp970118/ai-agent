"""访问门禁 HTTP：申请、管理员审批、消费激活令牌。"""

from __future__ import annotations

import html as html_module
import hashlib
import hmac
import logging
import os
import re
import secrets
import time
import uuid
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from ..notify.email_sender import send_mail_to
from . import gate_store

logger = logging.getLogger(__name__)

access_router = APIRouter(prefix="/access", tags=["access"])


def _html_page(title: str, body: str, *, status_code: int = 200) -> HTMLResponse:
    """显式前景/背景色，避免在邮件内置浏览器或深色系统下看起来像空白页。"""
    t = html_module.escape(title)
    b = html_module.escape(body)
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{t}</title>
  <style>
    body {{ margin:0; font-family: ui-sans-serif, system-ui, sans-serif;
      background:#f8fafc; color:#0f172a; padding:2rem; line-height:1.6; }}
    h1 {{ font-size:1.35rem; margin:0 0 0.75rem; }}
    p {{ margin:0; color:#334155; max-width:36rem; }}
  </style>
</head>
<body>
  <h1>{t}</h1>
  <p>{b}</p>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=status_code)

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_last_apply_ts: dict[str, float] = {}


def _admin_secret() -> str:
    return str(os.getenv("ACCESS_GATE_ADMIN_HMAC_SECRET", "") or "").strip()


def _admin_email() -> str:
    return str(os.getenv("ACCESS_GATE_ADMIN_EMAIL", "") or "").strip()


def _public_origin() -> str:
    return str(os.getenv("PUBLIC_SITE_ORIGIN", "https://www.diandeng.online")).rstrip("/")


def _admin_link_origin() -> str:
    """审批页由 MCP 提供；本地 Next 与 MCP 不同端口时必须指向 MCP（如 http://localhost:8000）。"""
    raw = str(os.getenv("ACCESS_GATE_MCP_PUBLIC_ORIGIN", "") or "").strip().rstrip("/")
    return raw or _public_origin()


def _sign_admin(pending_id: str, action: str, exp: int) -> str:
    msg = f"{pending_id}|{action}|{exp}"
    return hmac.new(_admin_secret().encode(), msg.encode(), hashlib.sha256).hexdigest()


def _verify_admin(pending_id: str, action: str, exp: int, sig: str) -> bool:
    if not _admin_secret() or len(_admin_secret()) < 8:
        return False
    if exp < int(time.time()):
        return False
    expect = _sign_admin(pending_id, action, exp)
    return hmac.compare_digest(expect, sig)


class ApplyBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=120)


@access_router.post("/apply")
async def post_apply(body: ApplyBody) -> JSONResponse:
    gate_store.init_db()
    email = gate_store.normalize_email(body.email)
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="邮箱格式无效")

    now = time.time()
    last = _last_apply_ts.get(email, 0)
    if now - last < 60:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    _last_apply_ts[email] = now

    st = gate_store.get_status(email)
    if st == "approved":
        act = secrets.token_urlsafe(32)
        gate_store.add_activation_token(act, email, ttl_seconds=48 * 3600)
        origin = _public_origin()
        activate_url = f"{origin}/api/access/activate?t={quote(act, safe='')}"
        try:
            send_mail_to(
                [email],
                "[访问申请] 新设备 — 激活链接",
                (
                    "你的邮箱已通过访问审核。若要在新浏览器或新设备上使用站点，请点击下方链接完成激活"
                    "（链结 48 小时内有效，每条仅可使用一次）：\n\n"
                    f"{activate_url}\n"
                ),
            )
        except Exception as exc:
            logger.exception("access_resend_activation_failed email=%s", email)
            raise HTTPException(status_code=500, detail=f"发送邮件失败: {exc}") from exc
        return JSONResponse(
            {
                "ok": True,
                "message": "已向你的邮箱发送新的激活链接，请在需要访问的那台设备浏览器中打开。",
            }
        )
    if st == "denied":
        raise HTTPException(status_code=403, detail="该邮箱已被拒绝访问")
    if st == "pending":
        return JSONResponse({"ok": True, "message": "已提交申请，请等待管理员处理。"})

    if not _admin_email():
        raise HTTPException(status_code=503, detail="服务器未配置 ACCESS_GATE_ADMIN_EMAIL")

    rid = str(uuid.uuid4())
    if not gate_store.add_pending(rid, email):
        return JSONResponse({"ok": True, "message": "已提交申请，请等待管理员处理。"})

    exp = int(time.time()) + 7 * 24 * 3600
    origin = _admin_link_origin()
    approve_sig = _sign_admin(rid, "approve", exp)
    deny_sig = _sign_admin(rid, "deny", exp)
    approve_url = f"{origin}/access/admin?action=approve&pid={quote(rid)}&exp={exp}&sig={approve_sig}"
    deny_url = f"{origin}/access/admin?action=deny&pid={quote(rid)}&exp={exp}&sig={deny_sig}"

    text = (
        f"有新的访问申请。\n\n"
        f"申请邮箱：{email}\n"
        f"请求 ID：{rid}\n\n"
        f"同意（请整行复制到浏览器，勿在换行处截断）：\n{approve_url}\n\n"
        f"拒绝：\n{deny_url}\n"
    )
    try:
        send_mail_to([_admin_email()], f"[访问申请] {email}", text)
    except Exception as exc:
        logger.exception("access_apply_send_mail_failed email=%s", email)
        gate_store.remove_pending_by_email(email)
        raise HTTPException(status_code=500, detail=f"发送邮件失败: {exc}") from exc

    return JSONResponse({"ok": True, "message": "申请已提交，管理员将收到邮件。"})


@access_router.get("/admin", response_class=HTMLResponse)
async def get_admin(
    action: str = Query(..., min_length=3, max_length=10),
    pid: str = Query(..., min_length=8, max_length=48),
    exp: int = Query(...),
    sig: str = Query(..., min_length=16, max_length=128),
) -> HTMLResponse:
    gate_store.init_db()
    if action not in ("approve", "deny"):
        return _html_page("参数错误", "链接不完整或 action 无效。", status_code=400)
    if not _verify_admin(pid, action, exp, sig):
        return _html_page(
            "无效或已过期",
            "签名不匹配或链接已超过有效期（7 天）。请让对方重新提交申请。",
            status_code=400,
        )

    applicant = gate_store.remove_pending_by_id(pid)
    if not applicant:
        return _html_page(
            "已处理或不存在",
            "该申请可能已被处理，或链接中的请求 ID 不正确。",
            status_code=404,
        )

    origin = _public_origin()

    if action == "deny":
        gate_store.deny_email(applicant)
        try:
            send_mail_to(
                [applicant],
                "[访问申请] 未通过",
                "管理员已拒绝你的访问申请。如有疑问请联系站点管理员。\n",
            )
        except Exception as exc:
            logger.warning("access_deny_notify_applicant_failed error=%s", exc)
        return _html_page("已拒绝", "已向申请人发送「未通过」通知邮件（若 SMTP 正常）。")

    gate_store.approve_email(applicant)
    act = secrets.token_urlsafe(32)
    gate_store.add_activation_token(act, applicant, ttl_seconds=48 * 3600)
    activate_url = f"{origin}/api/access/activate?t={quote(act, safe='')}"
    try:
        send_mail_to(
            [applicant],
            "[访问申请] 已通过 — 请完成激活",
            f"管理员已通过你的访问申请。\n\n"
            f"请在 48 小时内点击下方链接，在同一浏览器中打开以完成激活（之后该浏览器可正常访问站点）：\n\n"
            f"{activate_url}\n",
        )
    except Exception as exc:
        logger.exception("access_approve_send_activation_failed email=%s", applicant)
        return _html_page(
            "已通过但激活邮件发送失败",
            f"请检查 SMTP 配置。错误信息：{exc}",
            status_code=500,
        )

    return _html_page("已通过", "已向申请人邮箱发送「激活链接」。请让对方在常用浏览器中打开该链接完成激活。")


class ConsumeBody(BaseModel):
    token: str = Field(..., min_length=8, max_length=200)


@access_router.post("/consume-activation")
async def post_consume_activation(body: ConsumeBody) -> JSONResponse:
    gate_store.init_db()
    email = gate_store.consume_activation_token(body.token.strip())
    if not email:
        raise HTTPException(status_code=400, detail="无效或已过期的激活链接")
    if gate_store.get_status(email) != "approved":
        raise HTTPException(status_code=400, detail="该邮箱当前未在通过列表中")
    return JSONResponse({"ok": True, "email": email})
