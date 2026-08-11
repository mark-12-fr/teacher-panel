"""telegram.py — Telegram Bot API helpers for the teacher notification fallback."""
import html
import os
from typing import Optional

import httpx

from .config import settings

_API = "https://api.telegram.org"
_bot_username_cache: Optional[str] = None


def bot_token() -> str:
    return (settings.TELEGRAM_BOT_TOKEN or "").strip()


def is_configured() -> bool:
    return bool(bot_token())


def _url(method: str) -> str:
    return f"{_API}/bot{bot_token()}/{method}"


def webhook_url() -> Optional[str]:
    """Public URL Telegram posts updates to, derived from Railway's public domain."""
    token = bot_token()
    if not token:
        return None
    if settings.TELEGRAM_WEBHOOK_URL:
        base = settings.TELEGRAM_WEBHOOK_URL.rstrip("/")
        return f"{base}/api/telegram/webhook/{token}"
    domain = os.getenv("RAILWAY_PUBLIC_DOMAIN") or os.getenv("RAILWAY_STATIC_URL")
    if not domain:
        return None
    return f"https://{domain}/api/telegram/webhook/{token}"


async def register_webhook() -> Optional[str]:
    """Point the bot at this server's webhook endpoint. Returns the URL or None."""
    url = webhook_url()
    if not url:
        return None
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(_url("setWebhook"), params={"url": url, "allowed_updates": '["message"]'})
        data = r.json()
        if not data.get("ok"):
            return None
    return url


async def bot_username() -> Optional[str]:
    global _bot_username_cache
    if _bot_username_cache:
        return _bot_username_cache
    if not is_configured():
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(_url("getMe"))
            data = r.json()
        if data.get("ok"):
            _bot_username_cache = data["result"].get("username")
    except Exception:
        pass
    return _bot_username_cache


async def send_message(chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    if not is_configured():
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                _url("sendMessage"),
                json={"chat_id": chat_id, "text": text, "parse_mode": parse_mode},
            )
        return r.json().get("ok", False)
    except Exception:
        return False


def esc(text: Optional[str]) -> str:
    return html.escape(str(text or ""), quote=False)
