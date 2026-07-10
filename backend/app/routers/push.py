"""push.py — Web Push (VAPID) subscription registration for the teacher."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import PushSubscription
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
