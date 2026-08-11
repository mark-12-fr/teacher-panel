"""push.py — Web Push (VAPID) subscription registration + webhook dispatcher."""
import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import and_, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import SessionLocal, get_db
from ..models import PushSubscription, Section
from ..schemas import PushSubscribeIn
from ..security import CurrentTeacher, get_current_teacher

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public-key")
async def vapid_public_key():
    return {"key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def subscribe(
    body: PushSubscribeIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    stmt = pg_insert(PushSubscription).values(
        user_type="teacher",
        user_id=teacher.id,
        endpoint=body.endpoint,
        subscription=body.subscription,
        updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["endpoint"],
        set_={"user_type": "teacher", "user_id": teacher.id, "subscription": body.subscription, "updated_at": now},
    )
    await db.execute(stmt)
    await db.execute(
        delete(PushSubscription).where(
            and_(
                PushSubscription.user_type == "teacher",
                PushSubscription.user_id == teacher.id,
                PushSubscription.endpoint != body.endpoint,
            )
        )
    )
    await db.commit()
    return {"ok": True}


# ── Webhook dispatcher (Supabase Database Webhooks → Web Push) ────────────────
# Supabase fires this endpoint on every row INSERT/UPDATE/DELETE of the
# `attendance` and `class_records` tables (i.e. when a facilitator submits).
# A faci submit is typically MANY rows at once, so rows are coalesced per
# section/date/submitter in memory for a few seconds and delivered as ONE
# notification instead of spamming one per student.

_COALESCE_WINDOW_S = 6
_pending: dict = {}  # key -> {ts, table, section_label, subject, faci_name, status, date, count, url, teacher_id}
_pending_lock = asyncio.Lock()


async def _send_one(db: AsyncSession, sub: PushSubscription, payload: dict) -> bool:
    """Send a single push; drop the subscription on 404/410. Returns True on success."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info=sub.subscription,
            data=json.dumps(payload),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_SUBJECT},
            timeout=10,
        )
        return True
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            await db.execute(delete(PushSubscription).where(PushSubscription.id == sub.id))
            await db.commit()
        return False


async def _flush_batch(db: AsyncSession, batch_key: str):
    info = _pending.pop(batch_key, None)
    if not info:
        return
    target_ids = list(info.get("targets", {}).values())  # [(user_type, user_id)]
    if not target_ids:
        return
    try:
        subs = []
        for user_type, user_id in target_ids:
            res = await db.execute(
                select(PushSubscription).where(
                    PushSubscription.user_type == user_type,
                    PushSubscription.user_id == user_id,
                )
            )
            subs.extend(res.scalars().all())
    except Exception:
        return
    if not subs:
        return

    if info["table"] == "attendance":
        title = f"Attendance — {info['section_label']}"
        body = (info["faci_name"] or "A facilitator") + " marked " + str(info["count"]) + " student" + ("s " if info["count"] != 1 else " ") + "as " + (info["status"] or "updated") + (" on " + info["date"] if info["date"] else "")
    else:
        title = f"Class Record — {info['section_label']}"
        body = (info["faci_name"] or "A facilitator") + " updated scores for " + str(info["count"]) + " student" + ("s" if info["count"] != 1 else "") + (f" — {info['subject']}" if info["subject"] else "")

    payload = {
        "title": title,
        "body": body,
        "tag": f"{info['table']}:{batch_key}",
        "url": info["url"] or "/",
    }
    ok = 0
    for sub in subs:
        if await _send_one(db, sub, payload):
            ok += 1
    print(f"[push] {payload['title']} — {payload['body']} → {ok}/{len(subs)} sent")


async def _collect(entry: dict):
    """Merge a row event into the pending batch, then schedule its flush."""
    async with _pending_lock:
        now = time.monotonic()
        batch_key = entry["batch_key"]
        info = _pending.get(batch_key)
        if info is None:
            info = {
                "ts": now,
                "table": entry["table"],
                "section_label": entry["section_label"],
                "subject": entry.get("subject"),
                "faci_name": entry.get("faci_name"),
                "status": entry.get("status"),
                "date": entry.get("date"),
                "count": 0,
                "url": entry.get("url"),
                "targets": entry["targets"],
            }
            _pending[batch_key] = info
        else:
            info["faci_name"] = info["faci_name"] or entry.get("faci_name")
            info["status"] = info["status"] or entry.get("status")
            info["date"] = info["date"] or entry.get("date")
            info["url"] = info["url"] or entry.get("url")
            if entry.get("targets"):
                info["targets"].update(entry["targets"])
        info["count"] += 1
        delay = max(0.5, _COALESCE_WINDOW_S - (now - info["ts"]))
        asyncio.get_running_loop().create_task(_flush_after(batch_key, delay))


async def _flush_after(batch_key: str, delay: float):
    await asyncio.sleep(delay)
    async with _pending_lock:
        if batch_key in _pending:
            entry = _pending[batch_key]
            elapsed = time.monotonic() - entry["ts"]
            if elapsed >= _COALESCE_WINDOW_S:
                async with SessionLocal() as db:
                    await _flush_batch(db, batch_key)
                return
    # More rows arrived — schedule another flush for the remaining window.
    await asyncio.sleep(_COALESCE_WINDOW_S)
    async with _pending_lock:
        if batch_key in _pending:
            async with SessionLocal() as db:
                await _flush_batch(db, batch_key)


def _pretty_field(key: str) -> str:
    if key.startswith("module_"):
        return "Module " + key[7:]
    if key.startswith("activity_"):
        return "Activity " + key[9:]
    if key.startswith("pt_"):
        return "Performance Task " + key[3:]
    if key == "qe":
        return "Quarterly Exam"
    if key == "at":
        return "Attendance/Talent"
    return key.replace("_", " ")


def _changed_fields(record: dict, old: Optional[dict]):
    SKIP = {"id", "created_at", "updated_at", "section_id", "student_id", "date",
            "section", "subject", "facilitator_id", "teacher_id", "quarter"}
    if not old:
        return []
    changed = []
    for k, v in (record or {}).items():
        if k in SKIP:
            continue
        a, b = v, old.get(k)
        if (a is None and b is None) or a == b:
            continue
        changed.append((k, b, a))
    return changed


@router.post("/webhook")
async def webhook(
    request: Request,
    x_mjr_secret: Optional[str] = Header(default=None, alias="X-Mjr-Secret"),
    db: AsyncSession = Depends(get_db),
):
    if settings.PUSH_WEBHOOK_SECRET:
        secret_ok = bool(x_mjr_secret) and x_mjr_secret == settings.PUSH_WEBHOOK_SECRET
        if not secret_ok:
            print(f"[webhook] BAD SECRET received={x_mjr_secret!r} len={len(x_mjr_secret or '')}")
            return {"skipped": "bad secret"}
    try:
        body = await request.json()
    except Exception:
        return {"skipped": "no payload"}
    if not isinstance(body, dict):
        return {"skipped": "no payload"}

    table = body.get("table")
    etype = body.get("type") or body.get("eventType")
    record = body.get("record") or body.get("new") or {}
    old = body.get("old_record") or body.get("old")
    print(f"[webhook] {etype} {table} record_keys={list(record.keys()) if isinstance(record, dict) else type(record).__name__}")
    if not table or not record:
        return {"skipped": "no payload"}

    try:
        if table == "attendance":
            section = None
            if record.get("section"):
                res = await db.execute(select(Section).where(Section.title == record["section"]))
                section = res.scalars().first()
            if not section:
                return {"skipped": "unknown section"}
            targets = {"teacher": ("teacher", str(section.teacher_id))} if section.teacher_id else {}
            faci_name = None
            if record.get("facilitator_id"):
                f = await db.execute(select(Facilitator).where(Facilitator.id == record["facilitator_id"]))
                faci_row = f.scalars().first()
                faci_name = faci_row.full_name if faci_row else None
            batch_key = f"att:{section.id}:{record.get('date') or ''}:{record.get('facilitator_id') or ''}"
            await _collect({
                "batch_key": batch_key,
                "table": "attendance",
                "section_label": section.title,
                "subject": section.subject,
                "faci_name": faci_name,
                "status": record.get("status"),
                "date": record.get("date"),
                "url": f"/attendance/{section.id}",
                "targets": dict(targets),
            })
            return {"queued": True}

        if table == "class_records":
            section = None
            if record.get("section_id"):
                res = await db.execute(select(Section).where(Section.id == record["section_id"]))
                section = res.scalars().first()
            if not section:
                return {"skipped": "unknown section_id"}
            targets = {"teacher": ("teacher", str(section.teacher_id))} if section.teacher_id else {}
            batch_key = f"cr:{section.id}:{record.get('quarter') or ''}"
            await _collect({
                "batch_key": batch_key,
                "table": "class_records",
                "section_label": section.title,
                "subject": section.subject,
                "faci_name": None,
                "date": record.get("date"),
                "url": f"/class-record/{section.id}",
                "targets": dict(targets),
            })
            return {"queued": True}
    except Exception as exc:
        return {"error": str(exc)}

    return {"skipped": "unhandled table: " + str(table)}
