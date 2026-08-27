"""
notifications.py — the teacher panel's in-app bell feed.
========================================================
Rows are written by the push webhook dispatcher (push.py) whenever a
facilitator submits attendance or class-record scores: one row per coalesced
batch, so a whole-class submission reads as a single notification rather than
one per student.

Nothing here is cached — the badge has to reflect a submission that landed
seconds ago, and the queries are a single indexed lookup per teacher
(notifications_teacher_created_idx / notifications_teacher_unread_idx).
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Notification
from ..security import CurrentTeacher, get_current_teacher

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# How many entries the bell's panel shows. The feed is a "what happened
# recently" list, not an archive, so it is capped rather than paginated.
_MAX_ITEMS = 50


def _public(row: Notification) -> dict:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "title": row.title,
        "body": row.body,
        "url": row.url,
        "section_label": row.section_label,
        "read": row.read_at is not None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("")
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=_MAX_ITEMS),
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Recent notifications (newest first) plus the unread count for the badge.

    `unread` counts every unread row, not just the ones inside `limit`, so the
    badge stays honest when more arrive than the panel can show.
    """
    rows = (
        await db.execute(
            select(Notification)
            .where(Notification.teacher_id == teacher.id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    unread = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.teacher_id == teacher.id, Notification.read_at.is_(None))
        )
    ).scalar_one()
    return {"items": [_public(r) for r in rows], "unread": int(unread or 0)}


@router.post("/read-all")
async def mark_all_read(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Clear the badge — called when the teacher opens the bell panel."""
    await db.execute(
        update(Notification)
        .where(Notification.teacher_id == teacher.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Mark one entry read (the teacher tapped it to open the section)."""
    res = await db.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            # Scoped to the caller so one teacher can never touch another's row.
            Notification.teacher_id == teacher.id,
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    await db.commit()
    return {"ok": True}


@router.delete("")
async def clear_all(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Empty this teacher's feed."""
    await db.execute(delete(Notification).where(Notification.teacher_id == teacher.id))
    await db.commit()
    return {"ok": True}
