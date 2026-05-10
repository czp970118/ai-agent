import os
import smtplib
from email.mime.text import MIMEText


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip()


def send_mail_to(to_addrs: list[str], subject: str, text_body: str) -> None:
    """向指定收件人发送纯文本邮件（与 SMTP_* 使用同一发件账号）。"""
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT", "465") or 465)
    user = _env("SMTP_USER")
    password = _env("SMTP_PASS")
    use_ssl = _env("SMTP_SSL", "1").lower() in ("1", "true", "yes", "on")
    addrs = [x.strip() for x in to_addrs if x.strip()]
    if not host or not user or not password or not addrs:
        raise RuntimeError("SMTP 配置不完整或收件人为空")

    msg = MIMEText(text_body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = ", ".join(addrs)

    if use_ssl:
        with smtplib.SMTP_SSL(host=host, port=port, timeout=20) as client:
            client.login(user, password)
            client.sendmail(user, addrs, msg.as_string())
        return

    with smtplib.SMTP(host=host, port=port, timeout=20) as client:
        client.ehlo()
        client.starttls()
        client.ehlo()
        client.login(user, password)
        client.sendmail(user, addrs, msg.as_string())


def send_digest(subject: str, text_body: str) -> None:
    host = _env("SMTP_HOST")
    port = int(_env("SMTP_PORT", "465") or 465)
    user = _env("SMTP_USER")
    password = _env("SMTP_PASS")
    to_addrs = [x.strip() for x in _env("SMTP_TO").split(",") if x.strip()]
    use_ssl = _env("SMTP_SSL", "1").lower() in ("1", "true", "yes", "on")

    if not host or not user or not password or not to_addrs:
        raise RuntimeError("SMTP 配置不完整，请设置 SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_TO")

    msg = MIMEText(text_body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = ", ".join(to_addrs)

    if use_ssl:
        with smtplib.SMTP_SSL(host=host, port=port, timeout=20) as client:
            client.login(user, password)
            client.sendmail(user, to_addrs, msg.as_string())
        return

    with smtplib.SMTP(host=host, port=port, timeout=20) as client:
        client.ehlo()
        client.starttls()
        client.ehlo()
        client.login(user, password)
        client.sendmail(user, to_addrs, msg.as_string())
