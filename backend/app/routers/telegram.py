"""telegram.py router — link a teacher's Telegram chat so notifications also
arrive as Telegram messages (works even with every browser closed)."""
import secrets
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import delete, select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..security import CurrentTeacher, get_current_teacher
from ..telegram import bot_username, esc, is_configured, register_webhook, send_message

router = APIRouter(prefix="/api/telegram", tags=["telegram"])

DDL = """
CREATE TABLE IF NOT EXISTS telegram_links (
    teacher_id uuid PRIMARY KEY,
    chat_id text NOT NULL UNIQUE,
    first_name text,
    created_at timestamptz NOT NULL DEFAULT now()
)
"""

# One-time /start codes: code -> {"teacher_id": str, "ts": float}
_pending_codes: dict = {}
_CODE_TTL_S = 600


async def ensure_table(db: AsyncSession):
    await db.execute(sa_text(DDL))
    await db.commit()


async def link_for_teacher(db: AsyncSession, teacher_id: str):
    res = await db.execute(
        sa_text("SELECT chat_id, first_name FROM telegram_links WHERE teacher_id = :tid").bindparams(tid=teacher_id)
    )
    row = res.first()
    return {"linked": bool(row), "chat_id": row[0] if row else None, "first_name": row[1] if row else None}


@router.get("/status")
async def status(teacher: CurrentTeacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    await ensure_table(db)
    link = await link_for_teacher(db, teacher.id)
    return {
        "configured": is_configured(),
        "linked": link["linked"],
        "first_name": link["first_name"],
        "bot_username": await bot_username(),
    }


@router.post("/link")
async def link(teacher: CurrentTeacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    if not is_configured():
        return {"configured": False, "url": None}
    await ensure_table(db)
    existing = await link_for_teacher(db, teacher.id)
    if existing["linked"]:
        return {"configured": True, "already_linked": True, "url": None}
    code = secrets.token_hex(8)
    _pending_codes[code] = {"teacher_id": teacher.id, "ts": time.monotonic()}
    username = await bot_username()
    if not username:
        return {"configured": True, "url": None}
    return {"configured": True, "url": f"https://t.me/{username}?start={code}"}


@router.post("/unlink")
async def unlink(teacher: CurrentTeacher = Depends(get_current_teacher), db: AsyncSession = Depends(get_db)):
    await ensure_table(db)
    await db.execute(sa_text("DELETE FROM telegram_links WHERE teacher_id = :tid").bindparams(tid=teacher.id))
    await db.commit()
    return {"ok": True}


@router.post("/webhook/{token}")
async def webhook(token: str, request: dict, db: AsyncSession = Depends(get_db)):
    """Telegram calls this with every update (path carries the bot token)."""
    if not is_configured() or token != settings.TELEGRAM_BOT_TOKEN:
        return {"ok": False, "error": "bad token"}
    await ensure_table(db)
    message = (request.get("message") or {}).get("text") or ""
    chat = (request.get("message") or {}).get("chat") or {}
    chat_id = str(chat.get("id") or "")
    first_name = chat.get("first_name") or chat.get("title") or None
    if not message or not chat_id:
        return {"ok": True}

    if message.startswith("/start"):
        code = message.replace("/start", "", 1).strip()
        pending = _pending_codes.get(code)
        if not pending or time.monotonic() - pending["ts"] > _CODE_TTL_S:
            _pending_codes.pop(code, None)
            await send_message(chat_id, "This link has expired. Click \"Link Telegram\" again in the teacher panel.")
            return {"ok": True}
        await db.execute(
            sa_text(
                "INSERT INTO telegram_links (teacher_id, chat_id, first_name) VALUES (:tid, :cid, :fn) "
                "ON CONFLICT (teacher_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, first_name = EXCLUDED.first_name"
            ).bindparams(tid=pending["teacher_id"], cid=chat_id, fn=first_name)
        )
        await db.execute(sa_text("DELETE FROM telegram_links WHERE chat_id = :cid AND teacher_id != :tid").bindparams(cid=chat_id, tid=pending["teacher_id"]))
        await db.commit()
        _pending_codes.pop(code, None)
        await send_message(chat_id, "✅ Linked! From now on you'll get a message here whenever a facilitator submits attendance or scores.")
        return {"ok": True}

    await send_message(chat_id, "This bot only handles the \"Link\" flow from the teacher panel (send the /start link from the panel).")
    return {"ok": True}
