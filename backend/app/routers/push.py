"""push.py — Web Push (VAPID) subscription registration + webhook dispatcher."""
import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import and_, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import SessionLocal, get_db
from ..models import Facilitator, PushSubscription, Section
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


async def _send_one(sub: PushSubscription, payload: dict):
    """Send a single push WITH NO DATABASE SESSION. The network push can take up
    to 10s per subscription, so it must never run while holding a pooled
    connection — that's what starves the API's connection pool (QueuePool
    exhaustion → "connection timed out" 500s) under bursts of saves + push
    fan-out. Returns True when sent, "stale" when the push server reports the
    subscription is gone (404/410, callers should clean it up), or False on any
    other failure."""
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
            return "stale"
        return False
    except Exception:
        return False


async def _delete_stale_subscriptions(stale_ids):
    """Remove push subscriptions the push server no longer accepts. Uses a fresh,
    short-lived session so callers are never holding a connection while sending."""
    if not stale_ids:
        return
    try:
        async with SessionLocal() as db:
            await db.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(stale_ids))
            )
            await db.commit()
    except Exception:
        pass


async def notify_facis_of_section(teacher_id: str, section_title: str, title: str, body: str, url: str):
    """Teacher → facilitator direction: push every facilitator subscribed to a
    section when the teacher updates attendance or class records. Scoped to the
    owning teacher (by teacher_id) so identically-named sections belonging to a
    different teacher are never notified. Runs in a background task so API
    responses are never slowed by push delivery. The DB session is closed BEFORE
    the network pushes so a slow push never holds a pooled connection (that
    would starve the API pool and cause QueuePool 500s)."""
    stale_ids = []
    try:
        async with SessionLocal() as db:
            facis = (
                await db.execute(
                    select(Facilitator).where(
                        Facilitator.section == section_title,
                        Facilitator.teacher_id == UUID(teacher_id),
                    )
                )
            ).scalars().all()
            faci_ids = [str(f.id) for f in facis if f.id]
            if not faci_ids:
                return
            subs = (
                await db.execute(
                    select(PushSubscription).where(
                        PushSubscription.user_type == "faci",
                        PushSubscription.user_id.in_(faci_ids),
                    )
                )
            ).scalars().all()
        # Session closed above — push OUTSIDE the session context manager.
        if not subs:
            return
        payload = {"title": title, "body": body, "tag": "teacher:" + section_title, "url": url}
        for sub in subs:
            if await _send_one(sub, payload) == "stale":
                stale_ids.append(sub.id)
    except Exception:
        pass
    await _delete_stale_subscriptions(stale_ids)


async def _flush_batch(batch_key: str):
    info = _pending.pop(batch_key, None)
    if not info:
        return
    target_ids = list(info.get("targets", {}).values())  # [(user_type, user_id)]
    if not target_ids:
        return
    stale_ids = []
    try:
        async with SessionLocal() as db:
            subs = []
            for user_type, user_id in target_ids:
                res = await db.execute(
                    select(PushSubscription).where(
                        PushSubscription.user_type == user_type,
                        PushSubscription.user_id == user_id,
                    )
                )
                subs.extend(res.scalars().all())
        # Session closed — push OUTSIDE the session so network latency never
        # holds a pooled connection (prevents QueuePool exhaustion / 500s).
        if not subs:
            return

        if info["table"] == "attendance":
            title = f"Attendance Submitted — {info['section_label']}"
            body = (info["faci_name"] or "A facilitator") + " marked " + str(info["count"]) + " student" + ("s" if info["count"] != 1 else "") + " as " + (info["status"] or "updated")
        else:
            title = f"Class Record Submitted — {info['section_label']}"
            body = (info["faci_name"] or "A facilitator") + " submitted scores for " + str(info["count"]) + " student" + ("s" if info["count"] != 1 else "")
            if info.get("subject"):
                body += " · " + info["subject"]

        payload = {
            "title": title,
            "body": body,
            "submitted_at": info.get("submitted_at"),
            "tag": f"{info['table']}:{batch_key}",
            "url": info["url"] or "/",
        }
        ok = 0
        for sub in subs:
            result = await _send_one(sub, payload)
            if result is True:
                ok += 1
            elif result == "stale":
                stale_ids.append(sub.id)
        print(f"[push] {payload['title']} — {payload['body']} → {ok}/{len(subs)} sent")
    except Exception:
        pass
    await _delete_stale_subscriptions(stale_ids)


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
                "submitted_at": entry.get("submitted_at"),
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
            if not info.get("submitted_at") and entry.get("submitted_at"):
                info["submitted_at"] = entry["submitted_at"]
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
                await _flush_batch(batch_key)
                return
    # More rows arrived — schedule another flush for the remaining window.
    await asyncio.sleep(_COALESCE_WINDOW_S)
    async with _pending_lock:
        if batch_key in _pending:
            await _flush_batch(batch_key)


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
            if section.teacher_id:
                from ..cache import cache_invalidate
                await cache_invalidate(f"tp:{section.teacher_id}:*")
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
                "submitted_at": record.get("created_at"),
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
            if section.teacher_id:
                from ..cache import cache_invalidate
                await cache_invalidate(f"tp:{section.teacher_id}:*")
            targets = {"teacher": ("teacher", str(section.teacher_id))} if section.teacher_id else {}
            batch_key = f"cr:{section.id}:{record.get('quarter') or ''}"
            await _collect({
                "batch_key": batch_key,
                "table": "class_records",
                "section_label": section.title,
                "subject": section.subject,
                "faci_name": None,
                "date": record.get("date"),
                "submitted_at": record.get("created_at"),
                "url": f"/class-record/{section.id}",
                "targets": dict(targets),
            })
            return {"queued": True}
    except Exception as exc:
        return {"error": str(exc)}

    return {"skipped": "unhandled table: " + str(table)}
